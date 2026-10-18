//! Text-to-speech for scene voiceovers: OpenAI-compatible `/audio/speech`
//! or xAI `/tts`.
use super::check_status;
use crate::error::{AppError, AppResult};
use crate::keys;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    pub profile_id: String,
    #[serde(default)]
    pub base_url: Option<String>,
    /// "openai" (default) or "xai".
    #[serde(default)]
    pub engine: Option<String>,
    pub text: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub voice: Option<String>,
    /// Delivery style (OpenAI gpt-4o-mini-tts).
    #[serde(default)]
    pub instructions: Option<String>,
    /// BCP-47 code or "auto" (xAI).
    #[serde(default)]
    pub language: Option<String>,
    /// Speaking rate multiplier (xAI 0.7–1.5, OpenAI 0.25–4.0).
    #[serde(default)]
    pub speed: Option<f64>,
}

fn some(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

pub fn openai_body(req: &TtsRequest) -> Value {
    let mut body = json!({
        "model": some(&req.model).unwrap_or("gpt-4o-mini-tts"),
        "voice": some(&req.voice).unwrap_or("alloy"),
        "input": req.text,
        "response_format": "mp3",
    });
    if let Some(i) = some(&req.instructions) {
        body["instructions"] = json!(i);
    }
    if let Some(speed) = req.speed.filter(|s| (s - 1.0).abs() > 1e-3) {
        body["speed"] = json!(speed.clamp(0.25, 4.0));
    }
    body
}

/// Whether the text carries xAI speech tags (`[pause]`, `<whisper>…</whisper>`).
pub fn has_speech_tags(text: &str) -> bool {
    let inline = text.find('[').is_some_and(|i| text[i..].find(']').is_some_and(|j| text[i + 1..i + j].chars().all(|c| c.is_ascii_lowercase() || c == '-')));
    let wrap = text.contains("</");
    inline || wrap
}

pub fn xai_body(req: &TtsRequest) -> Value {
    let mut body = json!({
        "text": req.text,
        "voice_id": some(&req.voice).unwrap_or("eve"),
        "language": some(&req.language).unwrap_or("auto"),
        "output_format": { "codec": "mp3", "sample_rate": 44100, "bit_rate": 192000 },
        // Normalization rewrites symbols such as [ ] < > and would break speech tags.
        "text_normalization": !has_speech_tags(&req.text),
    });
    if let Some(speed) = req.speed.filter(|s| (s - 1.0).abs() > 1e-3) {
        body["speed"] = json!(speed.clamp(0.7, 1.5));
    }
    body
}

/// Statuses xAI documents as retryable (with exponential backoff).
fn retryable(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// Sends a request built by `make`, retrying 429/5xx up to 3 times (1 s, 2 s, 4 s).
async fn send_with_retry(make: impl Fn() -> reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
    let mut delay = std::time::Duration::from_secs(1);
    for attempt in 0..4 {
        let resp = make().send().await?;
        if attempt == 3 || !retryable(resp.status()) {
            return check_status(resp).await;
        }
        tokio::time::sleep(delay).await;
        delay *= 2;
    }
    unreachable!()
}

/// xAI may answer with raw audio or with JSON carrying base64 `audio`.
pub fn decode_audio(content_type: &str, bytes: &[u8]) -> AppResult<Vec<u8>> {
    if !content_type.contains("json") {
        return Ok(bytes.to_vec());
    }
    let v: Value = serde_json::from_slice(bytes)?;
    let b64 = v["audio"].as_str().ok_or_else(|| AppError::msg("Empty TTS response"))?;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| AppError::msg(format!("Invalid TTS audio: {e}")))
}

pub async fn synthesize(req: &TtsRequest, out: &Path) -> AppResult<()> {
    if req.text.trim().is_empty() {
        return Err(AppError::msg("Narration script is empty"));
    }
    super::validate_base_url(req.base_url.as_deref())?;
    let base = super::openai::base_url(req.base_url.as_deref());
    let key = keys::get(&req.profile_id)?;
    let client = reqwest::Client::new();
    let (url, body) = match some(&req.engine) {
        Some("xai") => (format!("{base}/tts"), xai_body(req)),
        _ => (format!("{base}/audio/speech"), openai_body(req)),
    };
    let resp = send_with_retry(|| {
        let http = client.post(&url).json(&body);
        match &key {
            Some(k) => http.bearer_auth(k),
            None => http,
        }
    })
    .await?;
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let audio = decode_audio(&content_type, &resp.bytes().await?)?;
    if audio.len() < 256 {
        return Err(AppError::msg("Empty TTS response"));
    }
    tokio::fs::write(out, &audio).await?;
    Ok(())
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct VoiceOption {
    pub id: String,
    pub name: String,
}

/// Reads `GET {base}/tts/voices`; accepts a bare array or `{ "voices": [...] }`.
pub fn parse_voices(v: &Value) -> Vec<VoiceOption> {
    let list = v.as_array().or_else(|| v["voices"].as_array()).or_else(|| v["data"].as_array());
    list.into_iter()
        .flatten()
        .filter_map(|x| {
            let id = x["voice_id"].as_str().or_else(|| x["id"].as_str()).or_else(|| x.as_str())?.to_string();
            let name = x["name"].as_str().unwrap_or(&id).to_string();
            Some(VoiceOption { id, name })
        })
        .collect()
}

/// Voices available to an xAI TTS profile: the account's custom voices first, then built-in ones.
pub async fn list_voices(profile_id: &str, base_url: Option<&str>) -> AppResult<Vec<VoiceOption>> {
    super::validate_base_url(base_url)?;
    let base = super::openai::base_url(base_url);
    let key = keys::get(profile_id)?;
    let client = reqwest::Client::new();
    let fetch = |path: &str| {
        let http = client.get(format!("{base}{path}"));
        let http = match &key {
            Some(k) => http.bearer_auth(k),
            None => http,
        };
        async move { check_status(http.send().await?).await?.json::<Value>().await.map_err(AppError::from) }
    };
    let builtin = parse_voices(&fetch("/tts/voices").await?);
    // Custom voices are optional: an account without any (or without access) still lists built-ins.
    let custom = fetch("/custom-voices").await.map(|v| parse_voices(&v)).unwrap_or_default();
    let mut out: Vec<VoiceOption> = custom.into_iter().map(|v| VoiceOption { name: format!("★ {}", v.name), id: v.id }).collect();
    for v in builtin {
        if !out.iter().any(|o| o.id.eq_ignore_ascii_case(&v.id)) {
            out.push(v);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(engine: &str) -> TtsRequest {
        TtsRequest {
            profile_id: "p".into(),
            base_url: None,
            engine: Some(engine.into()),
            text: "Halo".into(),
            model: Some(" ".into()),
            voice: None,
            instructions: None,
            language: Some("id".into()),
            speed: None,
        }
    }

    #[test]
    fn builds_engine_bodies_with_defaults() {
        let x = xai_body(&req("xai"));
        assert_eq!(x["voice_id"], "eve");
        assert_eq!(x["language"], "id");
        assert_eq!(x["output_format"]["codec"], "mp3");
        let o = openai_body(&req("openai"));
        assert_eq!(o["model"], "gpt-4o-mini-tts");
        assert_eq!(o["input"], "Halo");
    }

    #[test]
    fn sends_speed_only_when_set() {
        let mut r = req("xai");
        assert!(xai_body(&r).get("speed").is_none());
        r.speed = Some(2.0);
        assert_eq!(xai_body(&r)["speed"], 1.5);
        assert_eq!(openai_body(&r)["speed"], 2.0);
    }

    #[test]
    fn disables_normalization_for_tagged_text() {
        let mut r = req("xai");
        assert_eq!(xai_body(&r)["text_normalization"], true);
        r.text = "Halo [pause] dunia".into();
        assert_eq!(xai_body(&r)["text_normalization"], false);
        r.text = "<whisper>rahasia</whisper>".into();
        assert_eq!(xai_body(&r)["text_normalization"], false);
        r.text = "Harga [Rp 50.000]".into();
        assert!(!has_speech_tags(&r.text));
    }

    #[test]
    fn parses_voice_lists() {
        let a = serde_json::json!({"voices":[{"voice_id":"eve","name":"Eve","language":"en"},{"id":"my_clone"}]});
        assert_eq!(parse_voices(&a), vec![
            VoiceOption { id: "eve".into(), name: "Eve".into() },
            VoiceOption { id: "my_clone".into(), name: "my_clone".into() },
        ]);
        assert_eq!(parse_voices(&serde_json::json!(["rex"]))[0].id, "rex");
    }

    #[test]
    fn decodes_raw_and_json_audio() {
        assert_eq!(decode_audio("audio/mpeg", b"abc").unwrap(), b"abc");
        let json = br#"{"audio":"YWJj","content_type":"audio/mpeg"}"#;
        assert_eq!(decode_audio("application/json", json).unwrap(), b"abc");
        assert!(decode_audio("application/json", b"{}").is_err());
    }
}
