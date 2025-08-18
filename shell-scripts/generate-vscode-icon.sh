#!/bin/bash

# Generate VS Code extension icon from SVG
# Usage: ./generate-vscode-icon.sh [size]

# Get the script's directory to find project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

SVG_FILE="${PROJECT_ROOT}/docs/assets/llxprt.svg"
OUTPUT_DIR="${PROJECT_ROOT}/packages/vscode-ide-companion/assets"
OUTPUT_FILE="${OUTPUT_DIR}/icon.png"
SIZE="${1:-256}"

if [[ ! -f "${SVG_FILE}" ]]; then
    echo "Error: SVG file not found: ${SVG_FILE}"
    exit 1
fi

mkdir -p "${OUTPUT_DIR}"

# Try different converters
if command -v rsvg-convert &> /dev/null; then
    echo "Converting with rsvg-convert..."
    # First convert keeping aspect ratio, then pad to square with ImageMagick if available
    if command -v magick &> /dev/null; then
        TEMP_FILE="/tmp/llxprt_temp.png"
        rsvg-convert --keep-aspect-ratio -w "${SIZE}" "${SVG_FILE}" -o "${TEMP_FILE}"
        magick "${TEMP_FILE}" -background transparent -gravity center -extent "${SIZE}x${SIZE}" "${OUTPUT_FILE}"
        rm -f "${TEMP_FILE}"
    else
        rsvg-convert -w "${SIZE}" -h "${SIZE}" "${SVG_FILE}" -o "${OUTPUT_FILE}"
    fi
elif command -v inkscape &> /dev/null; then
    echo "Converting with Inkscape..."
    inkscape -w "${SIZE}" -h "${SIZE}" "${SVG_FILE}" -o "${OUTPUT_FILE}"
elif command -v magick &> /dev/null; then
    echo "Converting with ImageMagick..."
    # Force RGBA output to preserve colors
    magick -background transparent "${SVG_FILE}" -resize "${SIZE}x${SIZE}" -gravity center -extent "${SIZE}x${SIZE}" -define png:color-type=6 "${OUTPUT_FILE}"
else
    echo "No converter found. Install one of these:"
    echo "  brew install inkscape"
    echo "  brew install imagemagick"
    echo "  brew install librsvg"
    exit 1
fi

if [[ -f "${OUTPUT_FILE}" ]]; then
    echo "✅ Icon created: ${OUTPUT_FILE}"
else
    echo "❌ Failed to create icon"
    exit 1
fi