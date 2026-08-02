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
import stringWidth from 'string-width';
import {
  createFilePathLink,
  createOsc8Link,
  createUrlLink,
  isLinkableHttpUrl,
  stripControlCharacters,
} from './terminalLinks.js';

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
    expect(extractOsc8Label(link ?? '')).toBe('src/index.ts');
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
    expect(extractOsc8Label(link ?? '')).toBe('config.yaml');
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

describe('isLinkableHttpUrl', () => {
  it.each([
    ['http://example.com', true],
    ['https://example.com', true],
    ['https://claude.ai/oauth/authorize?client_id=abc&redirect_uri=xyz', true],
    ['http://localhost:3000/path', true],
    ['https://example.test/path_(disambiguation)', true],
  ])('accepts %s as linkable', (candidate, expected) => {
    expect(isLinkableHttpUrl(candidate)).toBe(expected);
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>'],
    ['file:///etc/passwd'],
    ['vbscript:msgbox'],
    ['mailto:user@example.com'],
    ['ftp://example.com/file'],
    ['not a url'],
    ['/relative/path'],
    ['example.com'],
    ['www.example.com'],
    [''],
  ])('rejects %s as not linkable', (candidate) => {
    expect(isLinkableHttpUrl(candidate)).toBe(false);
  });

  it('rejects URLs containing ESC (\u001b) control characters', () => {
    expect(isLinkableHttpUrl('https://example.com/\u001b[0m')).toBe(false);
  });

  it('rejects URLs containing BEL (\u0007) control characters', () => {
    expect(isLinkableHttpUrl('https://example.com/\u0007')).toBe(false);
  });

  it('rejects URLs containing newline control characters', () => {
    expect(isLinkableHttpUrl('https://example.com/\n')).toBe(false);
  });

  it('rejects URLs containing C1 control characters (0x7F-0x9F)', () => {
    expect(isLinkableHttpUrl('https://example.com/\u0080')).toBe(false);
  });
});

describe('createUrlLink', () => {
  const LONG_OAUTH_URL =
    'https://claude.ai/oauth/authorize?' +
    'client_id=54d7a297-b7c2-4f57-9bc1-1234567890abcdef&' +
    'redirect_uri=https%3A%2F%2Flocalhost%3A3000%2Fcallback&' +
    'response_type=code&' +
    'scope=openid%20profile%20email%20offline_access&' +
    'state=abc123def456ghi789jkl012mno345pqr678stu901vwx234yz&' +
    'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&' +
    'code_challenge_method=S256';

  it('returns null for non-linkable URLs', () => {
    expect(createUrlLink('javascript:alert(1)')).toBeNull();
    expect(createUrlLink('not a url')).toBeNull();
    expect(createUrlLink('')).toBeNull();
  });

  it('returns a BEL-terminated OSC 8 link for a linkable URL', () => {
    const url = 'https://example.com/page';
    const link = createUrlLink(url);

    expect(link).not.toBeNull();
    expect(link).toContain('\x1b]8;;' + url + '\x07');
    // BEL-terminated, not ST (ESC backslash)
    const ST = '\x1b' + '\\';
    expect(link).not.toContain(ST);
    // Ends with the closing OSC 8 sequence terminated by BEL
    const closingOsc8 = '\x1b]8;;\x07';
    expect(link?.endsWith(closingOsc8)).toBe(true);
  });

  it('contains the full URL as both the target and the default label', () => {
    const url = 'https://example.com/path/to/resource';
    const link = createUrlLink(url);

    expect(link).not.toBeNull();
    expect(link).toContain(url);
    // The label (between first BEL and closing OSC 8) must be the URL
    const label = extractOsc8Label(link ?? '');
    expect(label).toBe(url);
  });

  it('uses a custom label when provided', () => {
    const url = 'https://example.com/very/long/path';
    const link = createUrlLink(url, 'Click here');

    expect(link).not.toBeNull();
    expect(link).toContain(url);
    const label = extractOsc8Label(link ?? '');
    expect(label).toBe('Click here');
  });

  it('adds no display width beyond the visible label for a long OAuth URL (AC-7)', () => {
    expect(LONG_OAUTH_URL.length).toBeGreaterThan(300);
    const link = createUrlLink(LONG_OAUTH_URL);

    expect(link).not.toBeNull();
    expect(stringWidth(link ?? '')).toBe(LONG_OAUTH_URL.length);
  });

  it('adds no display width beyond a custom label (AC-7)', () => {
    const url = 'https://example.com/some/path';
    const link = createUrlLink(url, 'Click here');

    expect(link).not.toBeNull();
    expect(stringWidth(link ?? '')).toBe('Click here'.length);
  });

  it('rejects URLs carrying userinfo, which enables authority confusion (AC-3)', () => {
    // The WHATWG parser reads the segment before '@' as a username, so the
    // host here is evil.com even though a reader scanning the text sees
    // example.com first.
    expect(new URL('https://example.com@evil.com').hostname).toBe('evil.com');

    expect(isLinkableHttpUrl('https://example.com@evil.com')).toBe(false);
    expect(isLinkableHttpUrl('http://user:pw@evil.com/path')).toBe(false);
    expect(createUrlLink('https://example.com@evil.com')).toBeNull();
    expect(
      createUrlLink('https://good.test@attacker.test/x', 'docs'),
    ).toBeNull();

    // A host that merely contains similar text is still linkable
    expect(isLinkableHttpUrl('https://evil.com/example.com')).toBe(true);
  });

  it('keeps percent-encoded control characters encoded rather than decoding them (AC-3)', () => {
    // The WHATWG parser never decodes percent escapes, and the link embeds the
    // candidate as given, so %1B cannot become a live ESC byte in the output.
    const url = 'https://example.com/%1B]8;;evil%07';
    expect(new URL(url).href).toBe(url);

    const link = createUrlLink(url);
    expect(link).not.toBeNull();
    expect(link).toContain('%1B');
    expect(link?.indexOf('\u001b')).toBe(0);
    expect(link?.lastIndexOf('\u001b')).toBe(
      (link?.length ?? 0) - `\u001b]8;;\u0007`.length,
    );
  });

  it('strips control characters from text that failed validation', () => {
    expect(stripControlCharacters('https://evil.test/\u001b[2Jx')).toBe(
      'https://evil.test/[2Jx',
    );
    expect(stripControlCharacters('https://evil.test/\u0007')).toBe(
      'https://evil.test/',
    );
    // Unchanged when there is nothing to strip
    const clean = 'https://example.com/path?q=1';
    expect(stripControlCharacters(clean)).toBe(clean);
    // Non-ASCII text is preserved
    expect(stripControlCharacters('https://例え.テスト/パス')).toBe(
      'https://例え.テスト/パス',
    );
  });

  it('falls back to the URL when the label is empty, so the link is never invisible', () => {
    const url = 'https://example.com/some/path';

    expect(extractOsc8Label(createUrlLink(url, '') ?? '')).toBe(url);
    expect(createUrlLink(url, '')).toBe(createUrlLink(url));
  });

  it('rejects a label containing control characters (AC-3)', () => {
    const url = 'https://example.com/some/path';

    expect(createUrlLink(url, 'evil\u001b]8;;file:///etc/passwd')).toBeNull();
    expect(createUrlLink(url, 'evil\u0007label')).toBeNull();
    expect(createUrlLink(url, 'evil\u000alabel')).toBeNull();
  });
});
