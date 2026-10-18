#!/usr/bin/env bash
# Install or update KlikReel on macOS from the latest GitHub release:
#
#   curl -fsSL https://raw.githubusercontent.com/ashafizullah/klikreel/main/install.sh | bash
#
# Env: KLIKREEL_VERSION=x.y.z installs that release instead of the latest.
set -euo pipefail

REPO="ashafizullah/klikreel"
APP_NAME="KlikReel.app"
DEST="/Applications"

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "this installer is for macOS; on Windows download the setup .exe from https://github.com/$REPO/releases/latest"

# Keep in sync with bundle.macOS.minimumSystemVersion in src-tauri/tauri.conf.json.
min="11.0"
os="$(sw_vers -productVersion)"
if [ "$(printf '%s\n%s\n' "$min" "$os" | sort -V | head -1)" != "$min" ]; then
  die "KlikReel needs macOS $min or later (this Mac runs $os)"
fi

if [ -n "${KLIKREEL_VERSION:-}" ]; then
  api="https://api.github.com/repos/$REPO/releases/tags/v${KLIKREEL_VERSION#v}"
else
  api="https://api.github.com/repos/$REPO/releases/latest"
fi
say "finding the release"
release="$(curl -fsSL "$api")" || die "release not found (${KLIKREEL_VERSION:-latest})"
url="$(printf '%s' "$release" | grep -o '"browser_download_url": *"[^"]*_universal\.dmg"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
[ -n "$url" ] || die "no universal DMG found in $api"

tmp="$(mktemp -d)"
mnt="$tmp/mnt"
cleanup() {
  hdiutil detach -quiet "$mnt" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

say "downloading $(basename "$url")"
curl -fL --progress-bar -o "$tmp/KlikReel.dmg" "$url"

mkdir -p "$mnt"
hdiutil attach -nobrowse -readonly -quiet -mountpoint "$mnt" "$tmp/KlikReel.dmg"
[ -d "$mnt/$APP_NAME" ] || die "$APP_NAME not found in the DMG"

if pgrep -xq KlikReel; then
  say "quitting the running KlikReel"
  osascript -e 'quit app "KlikReel"' 2>/dev/null || pkill -x KlikReel || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xq KlikReel || break; sleep 0.5; done
fi

# /Applications is writable for admin users; fall back to sudo for the rest.
sudo=""
[ -w "$DEST" ] || sudo="sudo"
say "installing to $DEST/$APP_NAME"
$sudo rm -rf "$DEST/$APP_NAME"
$sudo ditto "$mnt/$APP_NAME" "$DEST/$APP_NAME"
# Belt and braces: nothing above sets the quarantine flag, but a proxy or MDM tool might.
$sudo xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true

command -v ffmpeg >/dev/null 2>&1 || say "note: KlikReel needs ffmpeg for voiceovers and export: brew install ffmpeg"

say "done, opening KlikReel"
open "$DEST/$APP_NAME"
