/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  escapePath,
  unescapePath,
  debugLogger,
} from '@vybestack/llxprt-code-core';

const execAsync = promisify(exec);

type ClipboardImageFormat = {
  class: string;
  extension: string;
};

/**
 * Supported image file extensions based on Gemini API.
 * See: https://ai.google.dev/gemini-api/docs/image-understanding
 */
export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.heic',
  '.heif',
];

/** Matches strings that start with a path prefix (/, ~, ., Windows drive letter, or UNC path) */
const PATH_PREFIX_PATTERN = /^([/~.]|[a-zA-Z]:|\\\\)/;

/**
 * Spawn a command and return stdout/stderr
 */
async function spawnAsync(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Checks if the system clipboard contains an image (macOS and Windows)
 * @returns true if clipboard contains an image
 */
export async function clipboardHasImage(): Promise<boolean> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await spawnAsync('powershell', [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::ContainsImage()',
      ]);
      return stdout.trim() === 'True';
    } catch {
      // Silent fail on Windows clipboard check
      return false;
    }
  }

  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    // Use osascript to check clipboard type
    const { stdout } = await spawnAsync('osascript', ['-e', 'clipboard info']);
    const imageRegex =
      /«class PNGf»|TIFF picture|JPEG picture|GIF picture|«class JPEG»|«class TIFF»/;
    return imageRegex.test(stdout);
  } catch {
    // Silent fail on macOS clipboard check
    return false;
  }
}

async function verifyNonEmptyFile(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > 0) {
      return filePath;
    }
  } catch {
    // File doesn't exist
  }
  return null;
}

function getClipboardTempDir(targetDir: string | undefined): string {
  const baseDir = targetDir ?? process.cwd();
  return path.join(baseDir, '.llxprt-clipboard');
}

async function saveWindowsClipboardImage(
  tempDir: string,
  timestamp: number,
): Promise<string | null> {
  const tempFilePath = path.join(tempDir, `clipboard-${timestamp}.png`);
  const psPath = tempFilePath.replace(/'/g, "''");

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
      $image = [System.Windows.Forms.Clipboard]::GetImage()
      $image.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "success"
    }
  `;

  const { stdout } = await spawnAsync('powershell', [
    '-NoProfile',
    '-Command',
    script,
  ]);

  if (stdout.trim() === 'success') {
    return verifyNonEmptyFile(tempFilePath);
  }
  return null;
}

async function saveMacClipboardFormat(
  tempDir: string,
  timestamp: number,
  format: ClipboardImageFormat,
): Promise<string | null> {
  const tempFilePath = path.join(
    tempDir,
    `clipboard-${timestamp}.${format.extension}`,
  );

  const script = `
    try
      set imageData to the clipboard as «class ${format.class}»
      set fileRef to open for access POSIX file "${tempFilePath}" with write permission
      write imageData to fileRef
      close access fileRef
      return "success"
    on error errMsg
      try
        close access POSIX file "${tempFilePath}"
      end try
      return "error"
    end try
  `;

  const { stdout } = await execAsync(`osascript -e '${script}'`);

  if (stdout.trim() === 'success') {
    return verifyNonEmptyFile(tempFilePath);
  }

  try {
    await fs.unlink(tempFilePath);
  } catch {
    // Ignore cleanup errors
  }
  return null;
}

async function saveMacClipboardImage(
  tempDir: string,
  timestamp: number,
): Promise<string | null> {
  const formats: ClipboardImageFormat[] = [
    { class: 'PNGf', extension: 'png' },
    { class: 'JPEG', extension: 'jpg' },
  ];

  for (const format of formats) {
    const savedPath = await saveMacClipboardFormat(tempDir, timestamp, format);
    if (savedPath !== null) {
      return savedPath;
    }
  }
  return null;
}

/**
 * Saves the image from clipboard to a temporary file (macOS and Windows)
 * @param targetDir The target directory to create temp files within
 * @returns The path to the saved image file, or null if no image or error
 */
export async function saveClipboardImage(
  targetDir?: string,
): Promise<string | null> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return null;
  }

  try {
    const tempDir = getClipboardTempDir(targetDir);
    await fs.mkdir(tempDir, { recursive: true });
    const timestamp = new Date().getTime();

    if (process.platform === 'win32') {
      return await saveWindowsClipboardImage(tempDir, timestamp);
    }

    return await saveMacClipboardImage(tempDir, timestamp);
  } catch (error) {
    debugLogger.error('Error saving clipboard image:', error);
    return null;
  }
}

/**
 * Cleans up old temporary clipboard image files
 * Removes files older than 1 hour
 * @param targetDir The target directory where temp files are stored
 */
export async function cleanupOldClipboardImages(
  targetDir?: string,
): Promise<void> {
  try {
    const baseDir = targetDir ?? process.cwd();
    const tempDir = path.join(baseDir, '.llxprt-clipboard');
    const files = await fs.readdir(tempDir);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (file.startsWith('clipboard-') && IMAGE_EXTENSIONS.includes(ext)) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if (stats.mtimeMs < oneHourAgo) {
          await fs.unlink(filePath);
        }
      }
    }
  } catch {
    // Ignore errors in cleanup
  }
}

/**
 * Splits text into individual path segments, respecting escaped spaces.
 * Unescaped spaces act as separators between paths, while "\ " is preserved
 * as part of a filename.
 *
 * Example: "/img1.png /path/my\ image.png" → ["/img1.png", "/path/my\ image.png"]
 *
 * @param text The text to split
 * @returns Array of path segments (still escaped)
 */
export function splitEscapedPaths(text: string): string[] {
  const paths: string[] = [];
  let current = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === '\\' && i + 1 < text.length && text[i + 1] === ' ') {
      current += '\\ ';
      i += 2;
    } else if (char === ' ') {
      if (current.trim()) {
        paths.push(current.trim());
      }
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }

  if (current.trim()) {
    paths.push(current.trim());
  }

  return paths;
}

/**
 * Processes pasted text containing file paths, adding @ prefix to valid paths.
 * Handles both single and multiple space-separated paths.
 *
 * @param text The pasted text (potentially space-separated paths)
 * @param isValidPath Function to validate if a path exists/is valid
 * @returns Processed string with @ prefixes on valid paths, or null if no valid paths
 */
export function parsePastedPaths(
  text: string,
  isValidPath: (path: string) => boolean,
): string | null {
  if (PATH_PREFIX_PATTERN.test(text) && isValidPath(text)) {
    return `@${escapePath(text)} `;
  }

  const segments = splitEscapedPaths(text);
  if (segments.length === 0) {
    return null;
  }

  const processed = segments.reduce(
    (result, segment) => {
      if (!PATH_PREFIX_PATTERN.test(segment)) {
        result.paths.push(segment);
        return result;
      }

      const unescaped = unescapePath(segment);
      if (isValidPath(unescaped)) {
        result.anyValidPath = true;
        result.paths.push(`@${segment}`);
      } else {
        result.paths.push(segment);
      }
      return result;
    },
    { anyValidPath: false, paths: [] as string[] },
  );

  return processed.anyValidPath ? processed.paths.join(' ') + ' ' : null;
}
