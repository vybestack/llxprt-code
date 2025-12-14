#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

UPDATE_BASELINE=0
if [[ "${1:-}" == "--update-baseline" ]]; then
  UPDATE_BASELINE=1
fi

ARTIFACTS_DIR="${ROOT_DIR}/packages/ui/visual-artifacts"
BASELINES_DIR="${ROOT_DIR}/packages/ui/visual-baselines"
BASELINE_PATH="${BASELINES_DIR}/header.png"

mkdir -p "${ARTIFACTS_DIR}"
mkdir -p "${BASELINES_DIR}"

RAW_PATH="${ARTIFACTS_DIR}/header-raw.png"
CROP_PATH="${ARTIFACTS_DIR}/header-crop.png"
DIFF_PATH="${ARTIFACTS_DIR}/header-diff.png"

# Window size (in points as used by macOS UI scripting).
WINDOW_SIZE="${LLXPRT_UI_VISUAL_WINDOW_SIZE:-1400,650}"
# Crop within the captured window: y,height
CROP_Y="${LLXPRT_UI_VISUAL_CROP_Y:-80}"
CROP_H="${LLXPRT_UI_VISUAL_CROP_H:-220}"
STARTUP_DELAY="${LLXPRT_UI_VISUAL_DELAY_SEC:-2}"

IFS=',' read -r WIN_W WIN_H <<< "${WINDOW_SIZE}"

if [[ -z "${WIN_W}" || -z "${WIN_H}" ]]; then
  echo "Invalid LLXPRT_UI_VISUAL_WINDOW_SIZE: '${WINDOW_SIZE}'" >&2
  exit 2
fi

COMMAND="cd ${ROOT_DIR} && bun run packages/ui/scripts/visual-header-demo.ts"

WINDOW_ID="$(osascript <<APPLESCRIPT
on run
  set winW to ${WIN_W}
  set winH to ${WIN_H}
  set cmd to "${COMMAND}"

  tell application "iTerm2"
    activate
    set demoWindow to (create window with default profile)
    tell current session of demoWindow
      write text cmd
    end tell
    set demoId to id of demoWindow
  end tell

  delay ${STARTUP_DELAY}

  tell application "System Events"
    tell process "iTerm2"
      set frontmost to true
      set size of front window to {winW, winH}
    end tell
  end tell

  return demoId
end run
APPLESCRIPT
)"

cleanup() {
  if [[ -n "${WINDOW_ID:-}" ]]; then
    osascript -e "tell application \"iTerm2\" to close (first window whose id is ${WINDOW_ID})" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${WINDOW_ID}" ]]; then
  echo "Failed to create iTerm2 window for visual capture." >&2
  exit 2
fi

BOUNDS="$(swift - <<SWIFT
import Foundation
import CoreGraphics

let target = ${WINDOW_ID}
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let infoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []

for info in infoList {
  let owner = info[kCGWindowOwnerName as String] as? String ?? ""
  if owner != "iTerm" { continue }
  guard let number = info[kCGWindowNumber as String] as? Int, number == target else { continue }
  guard let bounds = info[kCGWindowBounds as String] as? [String: Any] else { continue }
  let x = bounds["X"] as? Int ?? 0
  let y = bounds["Y"] as? Int ?? 0
  let w = bounds["Width"] as? Int ?? 0
  let h = bounds["Height"] as? Int ?? 0
  print("\\(x),\\(y),\\(w),\\(h)")
  break
}
SWIFT
)"

if [[ -z "${BOUNDS}" ]]; then
  echo "Failed to locate iTerm window bounds for window id ${WINDOW_ID}." >&2
  echo "Make sure iTerm2 is running and Accessibility permissions are granted." >&2
  exit 2
fi

IFS=',' read -r WIN_X WIN_Y WIN_W_FOUND WIN_H_FOUND <<< "${BOUNDS}"
if [[ -z "${WIN_X}" || -z "${WIN_Y}" || -z "${WIN_W_FOUND}" || -z "${WIN_H_FOUND}" ]]; then
  echo "Failed to parse window bounds: '${BOUNDS}'" >&2
  exit 2
fi

# Capture the window region by coordinates (more reliable than -l on some setups).
screencapture -x -R "${WIN_X},${WIN_Y},${WIN_W_FOUND},${WIN_H_FOUND}" "${RAW_PATH}"

magick "${RAW_PATH}" -crop "${WIN_W_FOUND}x${CROP_H}+0+${CROP_Y}" +repage "${CROP_PATH}"

# Sanity-check the capture contains the expected green border (avoid saving wallpaper/blank captures).
GREEN_FRACTION="$(magick "${CROP_PATH}" -alpha off -fuzz 10% -fill white -opaque "#2d7d46" -fill black +opaque "#2d7d46" -colorspace Gray -format "%[fx:mean]" info:)"
if [[ -z "${GREEN_FRACTION}" ]]; then
  echo "Failed to compute capture sanity check metric" >&2
  exit 2
fi
python3 - <<PY
import sys
fraction=float("${GREEN_FRACTION}")
if fraction < 0.0005:
  sys.stderr.write(f"Capture sanity check failed (green border fraction={fraction}).\\n")
  sys.stderr.write("This usually means macOS Screen Recording permission is missing for your terminal/shell.\\n")
  sys.exit(2)
PY

if [[ "${UPDATE_BASELINE}" -eq 1 ]]; then
  cp "${CROP_PATH}" "${BASELINE_PATH}"
  echo "Updated baseline: ${BASELINE_PATH}"
  exit 0
fi

if [[ ! -f "${BASELINE_PATH}" ]]; then
  echo "Baseline not found: ${BASELINE_PATH}" >&2
  echo "Run: LLXPRT_UI_VISUAL_WINDOW_SIZE='${WINDOW_SIZE}' $(basename "${BASH_SOURCE[0]}") --update-baseline" >&2
  exit 2
fi

set +e
METRIC="$(magick compare -metric AE "${BASELINE_PATH}" "${CROP_PATH}" "${DIFF_PATH}" 2>&1)"
STATUS=$?
set -e

if [[ "${STATUS}" -eq 0 ]]; then
  echo "Visual regression passed"
  exit 0
fi

echo "Visual regression failed: ${METRIC} differing pixels"
echo "Artifacts:"
echo "  baseline: ${BASELINE_PATH}"
echo "  current : ${CROP_PATH}"
echo "  diff    : ${DIFF_PATH}"
exit 1
