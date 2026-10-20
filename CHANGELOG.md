# Changelog

## 0.1.5

- Sharp color edges such as text and logos stay crisp on export: color detail is now positioned where video players expect it (left-sited chroma) and the MP4 is tagged accordingly, instead of sitting half a pixel off

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
