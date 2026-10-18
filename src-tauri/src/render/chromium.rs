//! Headless Chrome that renders the HTML composition one frame at a time.
use crate::bin;
use crate::error::{AppError, AppResult};
use base64::Engine;
use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::dom::Rgba;
use chromiumoxide::cdp::browser_protocol::emulation::SetDefaultBackgroundColorOverrideParams;
use chromiumoxide::cdp::browser_protocol::page::{CaptureScreenshotFormat, CaptureScreenshotParams};
use chromiumoxide::cdp::js_protocol::runtime::EvaluateParams;
use chromiumoxide::handler::viewport::Viewport;
use chromiumoxide::Page;
use futures::StreamExt;

fn cdp<E: std::fmt::Display>(e: E) -> AppError {
    AppError::msg(format!("Chrome: {e}"))
}

pub struct FrameRenderer {
    browser: Browser,
    handler: tokio::task::JoinHandle<()>,
    page: Page,
    _profile: std::path::PathBuf,
}

impl FrameRenderer {
    pub async fn launch(html: &str, width: u32, height: u32) -> AppResult<Self> {
        let chrome = bin::chrome().ok_or_else(|| {
            AppError::msg("Google Chrome / Chromium not found. Install Chrome to render HTML scenes.")
        })?;
        let profile = std::env::temp_dir().join(format!("aive-chrome-{}", uuid::Uuid::new_v4().simple()));
        let config = BrowserConfig::builder()
            .chrome_executable(chrome)
            .new_headless_mode()
            .user_data_dir(&profile)
            .window_size(width, height)
            .viewport(Viewport {
                width,
                height,
                device_scale_factor: Some(1.0),
                emulating_mobile: false,
                is_landscape: width >= height,
                has_touch: false,
            })
            .args([
                "--hide-scrollbars",
                "--mute-audio",
                "--force-device-scale-factor=1",
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--font-render-hinting=none",
            ])
            .build()
            .map_err(cdp)?;
        let (browser, mut handler) = Browser::launch(config).await.map_err(cdp)?;
        let handler = tokio::spawn(async move { while handler.next().await.is_some() {} });
        let page = browser.new_page("about:blank").await.map_err(cdp)?;
        page.execute(SetDefaultBackgroundColorOverrideParams {
            color: Some(Rgba { r: 0, g: 0, b: 0, a: Some(0.0) }),
        })
        .await
        .map_err(cdp)?;
        page.set_content(html).await.map_err(cdp)?;
        let renderer = Self { browser, handler, page, _profile: profile };
        renderer.eval("window.__ready").await?;
        Ok(renderer)
    }

    async fn eval(&self, expr: &str) -> AppResult<serde_json::Value> {
        let params = EvaluateParams::builder()
            .expression(expr)
            .await_promise(true)
            .return_by_value(true)
            .build()
            .map_err(cdp)?;
        let res = self.page.evaluate_expression(params).await.map_err(cdp)?;
        Ok(res.value().cloned().unwrap_or(serde_json::Value::Null))
    }

    /// Seeks the composition to `t` and returns a transparent PNG.
    pub async fn frame(&self, t: f64) -> AppResult<Vec<u8>> {
        self.eval(&format!("window.__renderSeek({t})")).await?;
        let shot = self
            .page
            .execute(
                CaptureScreenshotParams::builder()
                    .format(CaptureScreenshotFormat::Png)
                    .from_surface(true)
                    .optimize_for_speed(true)
                    .build(),
            )
            .await
            .map_err(cdp)?;
        let data: &str = shot.result.data.as_ref();
        base64::engine::general_purpose::STANDARD.decode(data).map_err(cdp)
    }

    pub async fn close(mut self) {
        let _ = self.browser.close().await;
        let _ = self.browser.wait().await;
        self.handler.abort();
        let _ = std::fs::remove_dir_all(&self._profile);
    }
}
