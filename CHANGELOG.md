# Changelog

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
