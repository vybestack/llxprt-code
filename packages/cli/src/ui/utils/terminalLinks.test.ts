/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilePathLink, createOsc8Link } from './terminalLinks.js';

const OSC8_OPEN = '\x1b]8;;';
const BEL = '\x07';

/**
 * Extract the visible label from an OSC 8 link string (the text between the
 * opening `ESC ]8;;URL BEL` and the closing `ESC ]8;; BEL`).
 */
function extractOsc8Label(link: string): string {
  const urlEnd = link.indexOf(BEL, OSC8_OPEN.length);
  const closeStart = link.indexOf(OSC8_OPEN, urlEnd + 1);
  return link.slice(urlEnd + 1, closeStart);
}

describe('createOsc8Link', () => {
  it('uses BEL terminators (not ST) for OSC-8 links', () => {
    const link = createOsc8Link('Click', 'https://example.com');

    expect(link).toBe('\x1b]8;;https://example.com\x07Click\x1b]8;;\x07');
    expect(link).not.toContain('\x1b\\');
  });
});

describe('createFilePathLink', () => {
  let tempDirs: string[];
  let tempDir: string;

  beforeEach(() => {
    tempDirs = [];
    tempDir = createTempDir();
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filepath-link-'));
    tempDirs.push(dir);
    return dir;
  }

  function createTempFile(relativePath: string): string {
    const fullPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, 'test content');
    return fullPath;
  }

  it('returns an OSC 8 link for an absolute path that exists', () => {
    const filePath = createTempFile('existing.txt');
    const link = createFilePathLink(filePath, []);

    expect(link).not.toBeNull();
    expect(link).toContain('\x1b]8;;');
    // The label is the path itself
    expect(link).toContain(filePath);
    // The URL is a file:// URI pointing at the absolute path
    expect(link).toContain(pathToFileURL(filePath).href);
  });

  it('returns null for a non-existent absolute path', () => {
    const link = createFilePathLink(
      '/nonexistent/path/to/missing-file-12345.txt',
      [],
    );
    expect(link).toBeNull();
  });

  it('returns null for a plain word with no path separators', () => {
    const link = createFilePathLink('hello', [tempDir]);
    expect(link).toBeNull();
  });

  it('resolves a relative path against a workspace directory that contains the file', () => {
    createTempFile('src/index.ts');
    const link = createFilePathLink('src/index.ts', [tempDir]);

    expect(link).not.toBeNull();
    const resolved = path.resolve(tempDir, 'src/index.ts');
    expect(link).toContain(resolved);
    expect(link).toContain(pathToFileURL(resolved).href);
  });

  it('returns null when the relative path does not exist in any workspace directory', () => {
    const link = createFilePathLink('nope/missing.ts', [tempDir]);
    expect(link).toBeNull();
  });

  it('returns null when workspaceDirectories is empty for a relative path', () => {
    const link = createFilePathLink('src/index.ts', []);
    expect(link).toBeNull();
  });

  it('tries multiple workspace directories and links against the first match', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'other-ws-'));
    tempDirs.push(otherDir);
    const nested = path.join(otherDir, 'config.yaml');
    fs.writeFileSync(nested, 'config');

    const link = createFilePathLink('config.yaml', [tempDir, otherDir]);

    expect(link).not.toBeNull();
    expect(link).toContain(nested);
    expect(link).toContain(pathToFileURL(nested).href);
  });

  it('keeps the ORIGINAL candidate as the visible label for a relative path', () => {
    createTempFile('src/index.ts');
    const link = createFilePathLink('src/index.ts', [tempDir]);

    expect(link).not.toBeNull();
    // The visible label (between the escape sequences) must be the original
    // relative candidate, NOT the absolute resolved path.
    const label = extractOsc8Label(link ?? '');
    expect(label).toBe('src/index.ts');
  });
});
