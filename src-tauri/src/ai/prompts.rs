//! System prompt and helpers for generating HTML Frames.
use super::{chat, ChatRequest, Message, Part, Role};
use crate::error::{AppError, AppResult};
use serde::Deserialize;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FrameRequest {
    pub format: String,
    pub profile_id: String,
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub prompt: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    /// When set, the model edits this document instead of writing a new one.
    #[serde(default)]
    pub existing_html: Option<String>,
    /// Full-screen scene of a multi-scene video (opaque background, enter/exit motion).
    #[serde(default)]
    pub scene: bool,
    /// Extra brief: style guide, product facts, narration, available images.
    #[serde(default)]
    pub context: Option<String>,
}

pub fn frame_system_prompt(width: u32, height: u32, duration: f64, scene: bool) -> String {
    let short = width.min(height) as f64;
    let headline = (short * 0.075).round();
    let body = (short * 0.04).round();
    let safe = if height > width {
        format!(
            "- Vertical video for social feeds: the platform UI covers the top ~14% ({top}px) and bottom ~20% ({bottom}px) and the right ~12%. Keep all text and key visuals inside the remaining area; backgrounds may fill the whole canvas.",
            top = (height as f64 * 0.14).round(),
            bottom = (height as f64 * 0.20).round(),
        )
    } else {
        format!("- Keep text and key visuals inside a safe area of about 5% ({}px) from every edge.", (short * 0.05).round())
    };
    let mut prompt = format!(
        r#"You are a senior motion-graphics designer who writes self-contained HTML "frames" for a video editor. Each frame is one HTML document that the editor composites on a {width}x{height} video and renders frame-by-frame.

Return exactly one complete HTML document inside a single ```html code block, with no other commentary.

Hard requirements:
- The canvas is exactly {width}x{height} px. Set html, body {{ margin:0; width:{width}px; height:{height}px; overflow:hidden; }}.
- Animation is driven only by time. Define `window.__seek = function (t) {{ ... }}` where t is seconds from the clip start, 0 to {duration}. The renderer calls __seek for every output frame, possibly out of order (jumping backwards and forwards), so the visual state must be a pure function of t.
- Never use requestAnimationFrame, setTimeout, setInterval, CSS animations (@keyframes) or transitions, Date, performance.now, Math.random (use a seeded PRNG), <video> or <audio>.
- GSAP 3 core is already loaded as the global `gsap` (no plugins). Preferred pattern: `const tl = gsap.timeline({{ paused: true }}); ...; window.__seek = (t) => tl.seek(t, false);`
- Because of out-of-order seeking, use `tl.fromTo()` / `tl.to()` with explicit start and end values and absolute positions (e.g. `tl.fromTo(el, {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.6 }}, 0.3)`). Avoid `.from()` and `gsap.set()` outside the timeline: they cause elements to flash or vanish when seeking backwards. Do not use `repeat: -1`; use a finite repeat that ends by {duration} s.
- No network access: no external fonts, images, scripts or fetch. Use system fonts (-apple-system, "Segoe UI", Inter, Helvetica, Arial), inline SVG, CSS gradients, filters, or canvas 2D.
- `window.__params` is an object with user-editable values (texts, colors). Read from it with sensible defaults, e.g. `const P = Object.assign({{ title: "Hello" }}, window.__params);`
- `window.__assets` is an object of image data URIs keyed by name (e.g. a logo or product screenshot). Only use names that the brief lists, and set them from JavaScript: `img.src = window.__assets.logo`. Size images with `object-fit: contain` (or `cover` inside a device frame) so they are never stretched.
- Keep the background transparent so the frame overlays video, unless the request clearly asks for a full-screen scene or background.
- Keep the document under about 300 lines.

Design and motion:
{safe}
- Legible type: headlines at least {headline}px, supporting text at least {body}px, line-height 1.1-1.3, strong weight contrast. Never let text overflow or wrap into more than 3 lines.
- One focal point at a time with a clear hierarchy; generous whitespace; align elements on a simple grid.
- Easing: `power3.out` or `expo.out` for entrances, `power2.in` for exits, `sine.inOut` for ambient motion; never linear for UI motion. Entrance tweens 0.4-0.8 s; stagger groups by 0.06-0.12 s.
- Keep the frame alive after the entrance with subtle ambient motion (1-3% scale drift, a few px of float, slow gradient shift) so it never looks frozen."#
    );
    if scene {
        prompt.push_str(&format!(
            r#"

This frame is one scene of a product promo video made of consecutive full-screen scenes:
- Paint a full, opaque background that follows the style guide (no transparency), so scenes cut cleanly into each other.
- Animate elements in during the first ~0.8 s and keep them alive with subtle motion; animate out during the last ~0.4 s (from {out:.2} s to {duration} s). Keep every element fully visible until the exit starts, and never let a tween run past {duration} s.
- Follow the style guide's transition notes for the entrance and exit so consecutive scenes feel like one continuous video.
- Show only short on-screen text (headline of at most 6 words plus at most one supporting line). The narration carries the details; when narration timing is given, reveal each element close to when the narration mentions it.
- Write on-screen text in the language the brief specifies; only keep real product UI labels as they are.
- Make product UI feel real: build simplified UI mockups with HTML/CSS (cards, tables, buttons, charts) or show the provided screenshots inside a device frame that matches their aspect ratio."#,
            out = (duration - 0.4).max(0.0)
        ));
    }
    prompt
}

/// Contract violations a generated frame should be repaired for.
pub fn contract_issues(html: &str, truncated: bool) -> Vec<String> {
    let mut issues = Vec::new();
    if truncated || (html.contains("<html") && !html.contains("</html>")) {
        issues.push("The document is cut off; return a shorter, complete document.".to_string());
    }
    if !html.contains("__seek") {
        issues.push("It does not define window.__seek(t).".to_string());
    }
    for (needle, what) in [
        ("requestAnimationFrame", "requestAnimationFrame"),
        ("setTimeout", "setTimeout"),
        ("setInterval", "setInterval"),
        ("Math.random", "Math.random (use a seeded PRNG)"),
        ("@keyframes", "CSS @keyframes animations"),
        ("Date.now", "Date.now"),
        ("new Date", "Date"),
        ("performance.now", "performance.now"),
        ("repeat: -1", "infinite repeats (repeat: -1)"),
        ("repeat:-1", "infinite repeats (repeat: -1)"),
    ] {
        if html.contains(needle) {
            issues.push(format!("It uses {what}, which is not allowed."));
        }
    }
    let external = ["http://", "https://"].iter().any(|scheme| {
        html.match_indices(scheme).any(|(i, _)| !html[i + scheme.len()..].starts_with("www.w3.org"))
    });
    if external {
        issues.push("It loads external URLs; there is no network access.".to_string());
    }
    issues
}

/// Pulls the HTML document out of a model reply.
pub fn extract_html(reply: &str) -> Option<String> {
    let fenced = reply.split("```").collect::<Vec<_>>();
    // Odd indexes are inside fences; prefer the longest html-looking block.
    let mut best: Option<&str> = None;
    for (i, block) in fenced.iter().enumerate() {
        if i % 2 == 1 {
            let body = block.strip_prefix("html").or_else(|| block.strip_prefix("HTML")).unwrap_or(block);
            if body.contains('<') && best.is_none_or(|b| body.len() > b.len()) {
                best = Some(body);
            }
        }
    }
    let html = best.unwrap_or(reply).trim();
    let start = html.find('<')?;
    Some(html[start..].trim().to_string())
}

pub async fn generate_frame(req: &FrameRequest, on_text: &mut (dyn FnMut(&str) + Send)) -> AppResult<String> {
    let user = match &req.existing_html {
        Some(html) => format!(
            "Here is the current frame:\n```html\n{html}\n```\n\nApply this change and return the full updated document, keeping everything else intact:\n{}",
            req.prompt
        ),
        None => format!("Create a {:.1}-second frame: {}", req.duration, req.prompt),
    };
    let user = match req.context.as_deref().filter(|c| !c.trim().is_empty()) {
        Some(ctx) => format!("{ctx}\n\n{user}"),
        None => user,
    };
    let mut chat_req = ChatRequest {
        format: req.format.clone(),
        profile_id: req.profile_id.clone(),
        model: req.model.clone(),
        base_url: req.base_url.clone(),
        system: Some(frame_system_prompt(req.width, req.height, req.duration, req.scene)),
        messages: vec![Message { role: Role::User, content: vec![Part::Text { text: user }] }],
        tools: vec![],
        max_tokens: None,
    };
    // One repair round if the document breaks the frame contract.
    for attempt in 0..2 {
        let result = chat(&chat_req, on_text).await?;
        if result.stop_reason == "refusal" {
            return Err(AppError::msg("The model declined this request. Try rephrasing the prompt."));
        }
        let reply: String = result
            .message
            .content
            .iter()
            .filter_map(|p| if let Part::Text { text } = p { Some(text.as_str()) } else { None })
            .collect();
        let html = extract_html(&reply).ok_or_else(|| AppError::msg("The AI did not return HTML"))?;
        let issues = contract_issues(&html, result.stop_reason == "max_tokens");
        if issues.is_empty() || attempt == 1 {
            return Ok(html);
        }
        chat_req.messages.push(result.message);
        chat_req.messages.push(Message {
            role: Role::User,
            content: vec![Part::Text {
                text: format!(
                    "The document breaks the frame contract:\n- {}\nFix this and return the full document.",
                    issues.join("\n- ")
                ),
            }],
        });
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_fenced_html() {
        let r = "Here:\n```html\n<!doctype html><html></html>\n```\nDone";
        assert_eq!(extract_html(r).unwrap(), "<!doctype html><html></html>");
    }

    #[test]
    fn flags_contract_issues() {
        let ok = r#"<html><svg xmlns="http://www.w3.org/2000/svg"></svg><script>window.__seek=()=>{}</script></html>"#;
        assert!(contract_issues(ok, false).is_empty());
        let bad = "<html><script>setTimeout(f); Math.random(); fetch('https://x.io')</script>";
        let issues = contract_issues(bad, false);
        assert_eq!(issues.len(), 5);
        assert!(contract_issues(ok, true)[0].contains("cut off"));
    }

    #[test]
    fn extracts_bare_html() {
        assert_eq!(extract_html("  <div>x</div> ").unwrap(), "<div>x</div>");
        assert!(extract_html("no markup").is_none());
    }
}
