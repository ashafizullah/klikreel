<p align="center">
  <img src="design/icon.png" width="128" alt="KlikReel icon">
</p>

<h1 align="center">KlikReel</h1>

<p align="center">
  A free, open-source desktop app that turns a prompt and your codebase into a narrated product promo video. Bring your own AI keys; projects stay on your machine.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ashafizullah/klikreel?color=blue" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Rust-stable-000000?logo=rust" alt="Rust">
  <a href="https://github.com/ashafizullah/klikreel/actions/workflows/ci.yml"><img src="https://github.com/ashafizullah/klikreel/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ashafizullah/klikreel/releases/latest"><img src="https://img.shields.io/github/v/release/ashafizullah/klikreel?include_prereleases&label=release" alt="Release"></a>
</p>

<p align="center">
  <a href="https://trakteer.id/adamshafizullah/tip"><img src="https://img.shields.io/badge/Buy%20me%20an%20AI%20token-Trakteer-C02E2E?style=for-the-badge" alt="Buy me an AI token on Trakteer"></a>
</p>

## Features

- **Prompt → video**: point it at a project folder, describe the feature to promote, and the AI researches the code (UI labels, brand colors, logo, screenshots) and writes a storyboard
- **Animated scenes** as self-contained HTML + GSAP pages, rendered frame by frame so preview and export match
- **AI voiceover** with OpenAI-compatible TTS or xAI, directed per scene (pauses, emphasis, energy) and fitted to each scene's length
- **Background music**, timeline editing, and an HTML code editor (Monaco) for every scene
- **Revise by chat**: ask the AI to change a scene, its narration or the order, and it edits the storyboard for you
- **Bring your own model**: Anthropic or any OpenAI-compatible API; keys are stored in the OS keychain
- **Export** to MP4 with headless Chrome and ffmpeg
- **English and Bahasa Indonesia** interface

## Download

Get the latest version from **[Releases](https://github.com/ashafizullah/klikreel/releases/latest)**:

| Platform | File |
|---|---|
| macOS 11+ (Apple Silicon & Intel) | `KlikReel_x.y.z_universal.dmg` |
| Windows 10/11 (x64) | `KlikReel_x.y.z_x64-setup.exe` or `.msi` |
| Linux x86_64 | `.deb`, `.rpm` or `.AppImage` |

**macOS:** open the DMG and drag KlikReel into Applications. KlikReel is signed and notarized by Apple, so it opens without a Gatekeeper warning. Or use the install script, which downloads the latest DMG, copies KlikReel into Applications and opens it:

```sh
curl -fsSL https://raw.githubusercontent.com/ashafizullah/klikreel/main/install.sh | bash
```

**Windows:** SmartScreen may warn about an unsigned app. Click **More info → Run anyway**.

## Requirements

- [ffmpeg](https://ffmpeg.org/) (`brew install ffmpeg` on macOS)
- Google Chrome, Chromium, Edge or Brave (used for rendering)
- An API key for a chat model, and one for text-to-speech if you want voiceovers

## Development

Requires [Bun](https://bun.sh/) and stable Rust.

```sh
bun install
bun run tauri dev      # run
bun run tauri build    # bundle
bun run test           # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml
```

## Contributing

Issues and pull requests are welcome. CI runs type checks, tests, `cargo fmt`, `clippy` and `cargo test` on macOS, Windows and Linux. Please run them locally before opening a PR.

### Releasing

Add a `## x.y.z` section to `CHANGELOG.md`, bump `version` in `tauri.conf.json`, `Cargo.toml` and `package.json`, then push a tag. CI builds the signed and notarized macOS DMG, the Windows installers and the Linux packages into a draft release; publish the draft to roll it out.

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Support

KlikReel is free. If it saves you time, **[buy me an AI token on Trakteer](https://trakteer.id/adamshafizullah/tip)** ☕🤖.

## License

[MIT](LICENSE)
