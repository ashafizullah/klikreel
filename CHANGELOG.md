# Changelog

## 0.1.17

- Settings has a GitHub button, next to Open-source licenses

## 0.1.16

- The local MCP server now works with any AI agent, not only Claude Code: pick Claude Code, Codex, Gemini CLI or another MCP client under **Connect AI agent** in the terminal and copy its setup (a command, a `~/.codex/config.toml` block or an `mcpServers` JSON entry)
- The terminal's *Type* button starts the agent you picked, and the badge and activity log show which agent is connected

## 0.1.15

- The command that loads audio into the player follows the same rule as the asset protocol, so the interface can only read KlikReel's own media and the files you choose

## 0.1.14

- The webview's asset protocol can now only load KlikReel's own media and the music files you choose, instead of any file on disk

## 0.1.13

- Third-party notices now include every license and notice text for packages under more than one license, and a source link for the MPL-2.0 crates
- The macOS DMG itself is now notarized and stapled, not only the app inside it
- The app's copyright line now names its author

## 0.1.12

- Settings → Open-source licenses now lists every Rust crate compiled into the app with its license text, alongside the interface packages
- GSAP's full license is shown there too, with a note that it is free to use but not open source
- Includes the changes from 0.1.11, which wasn't released on its own: a Content Security Policy for the app window, so the interface and scene previews can't load scripts, fonts or images from the internet or send data anywhere except to KlikReel itself, and security updates for the TLS libraries (rustls, rustls-webpki, webpki-root-certs) and for DOMPurify in the code editor

## 0.1.11

- The app window now has a Content Security Policy: the interface and scene previews can't load scripts, fonts or images from the internet or send data anywhere except to KlikReel itself
- Security updates for the TLS libraries used for AI, voice and update requests (rustls, rustls-webpki, webpki-root-certs) and for DOMPurify in the code editor

## 0.1.10

- Settings, AI and voice profiles and API keys are now stored under the KlikReel name only. Ones saved by earlier versions are not read anymore: set up your profiles and enter your API keys again
- Updating straight from 0.1.8 or earlier: projects and workspaces don't show up either. They are still on disk; to bring them back, quit KlikReel and copy the old folder's contents into the new one: on macOS `~/Library/Application Support/com.ashafizullah.aivideoeditor` → `com.ashafizullah.klikreel`, on Windows `%APPDATA%\com.ashafizullah.aivideoeditor` → `com.ashafizullah.klikreel`, on Linux `~/.local/share/com.ashafizullah.aivideoeditor` → `com.ashafizullah.klikreel`

## 0.1.9

- App identifier changed from `com.ashafizullah.aivideoeditor` to `com.ashafizullah.klikreel`, matching the other Klik apps. Settings, AI and voice profiles and the project library move over on first launch. On macOS, the keychain may ask once per saved API key; choose Always Allow.
- Settings → Open-source licenses shows the license of every bundled package, the fonts included

## 0.1.8

- New Darkroom look: warm charcoal surfaces, tungsten-amber accents, new typography (Fraunces, IBM Plex Sans and IBM Plex Mono, bundled so they work offline), film-style project cards and new timeline clip colors

## 0.1.7

- Built-in terminal (Ctrl+` or the terminal button in the top bar), opened in your project folder
- Works with Claude Code: turn on the local MCP server (terminal → Connect Claude Code), add it to your own Claude Code once, and ask Claude to edit scenes, write their animations, record voiceovers, set music, take snapshots and export. Changes show up live and can be undone, and a green badge shows when Claude Code is connected
- Without an API key for the app's AI, resizing a scene or recording a voiceover no longer fails: the new length is kept and the scene is marked for retiming, which Claude Code can do. AI-only actions now say what's missing before changing anything

## 0.1.6

- New "Full color (4:4:4)" export option: colored text and logo edges no longer bleed into their surroundings. Off by default, because many phones, TVs and browsers can't play 4:4:4 video

## 0.1.5

- Color detail on export is now positioned where video players expect it (left-sited chroma) and the MP4 is tagged accordingly, so sharp color edges no longer sit half a pixel off to one side. Some color bleed around colored text remains in standard exports; 0.1.6 adds a full-color option that removes it

## 0.1.4

- Google Gemini works with tools again: the AI no longer fails with "Function call is missing a thought_signature" after reading your project folder, including in projects started with another AI provider

## 0.1.3

- Screenshots and images with a color profile (such as Display P3 screenshots from macOS) are converted to sRGB on export, so they look the same as in the preview instead of washed out
- Videos without color information are read as BT.709 when they are HD, like video players do, so their colors no longer shift on export
- Scene frames are always captured in sRGB, whatever color profile your display uses

## 0.1.2

- Exported videos keep your brand colors exact: scenes are converted with the BT.709 matrix and the MP4 is tagged as BT.709 with sRGB transfer, so players no longer shift colors (by up to 18 RGB levels before, at most 2 now)

## 0.1.1

- The AI can now read your project folder everywhere in a project: in the revise chat and in scene prompts, not only when the storyboard is first written
- Ask for a photo by name (e.g. "use the photo of our therapist") and the AI finds it in the project folder, attaches it to the scene and rebuilds the scene with it
- The first storyboard now also considers photos of people, products and places in the project folder, not only logos and screenshots

## 0.1.0

First public release.

- Prompt → video: researches your codebase, writes a storyboard, records voiceovers and builds animated HTML scenes
- AI voiceover with OpenAI-compatible TTS or xAI, fitted to each scene
- Timeline, background music, scene code editor and revise-by-chat
- MP4 export with headless Chrome and ffmpeg
- Project cards show a preview of the first scene; select several projects to delete them at once
- Right-click a workspace or project to open, rename, show in Finder or delete it
- Each workspace shows how many projects it has and how much disk space they use
- First-launch check for ffmpeg and Chrome, with a one-click Homebrew install on macOS
- Checks for updates once a day (or from "Check for updates" on the home screen) and installs them in-app
- English and Bahasa Indonesia
