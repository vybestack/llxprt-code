/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  sanitizeMarkdown,
  sanitizeOptionalMarkdown,
  sanitizeSubject,
  renderContributor,
  renderBullet,
} from '../../release-notes/markdown.js';

describe('sanitizeMarkdown', () => {
  it('passes through plain text unchanged', () => {
    expect(sanitizeMarkdown('Faster streaming responses')).toBe(
      'Faster streaming responses',
    );
  });

  it('neutralizes bare www autolinks', () => {
    expect(sanitizeMarkdown('Visit www.evil.example for details')).toBe(
      'Visit for details',
    );
  });
  it('strips backticks to prevent inline code injection', () => {
    expect(sanitizeMarkdown('`rm -rf /`')).toBe('rm -rf /');
  });

  it('strips HTML angle brackets', () => {
    expect(sanitizeMarkdown('<script>alert(1)</script>')).toBe(
      'script alert(1) /script',
    );
  });

  it('strips square brackets to prevent link injection', () => {
    const result = sanitizeMarkdown('[click](https://evil.invalid)');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
    expect(result).not.toContain('https');
    expect(result).toContain('click');
  });

  it('strips image syntax', () => {
    const result = sanitizeMarkdown('![alt](https://evil.invalid/x.png)');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
    expect(result).not.toContain('!');
    expect(result).not.toContain('https');
    expect(result).toContain('alt');
  });

  it('strips backslashes', () => {
    expect(sanitizeMarkdown('foo\\bar\\baz')).toBe('foo bar baz');
  });

  it('strips markdown heading hashes', () => {
    expect(sanitizeMarkdown('### All Changes')).toBe('All Changes');
  });

  it('strips emphasis markers', () => {
    expect(sanitizeMarkdown('*bold* and _under_')).toBe('bold and under');
  });

  it('strips strikethrough markers', () => {
    expect(sanitizeMarkdown('~~removed~~')).toBe('removed');
  });

  it('collapses control characters including record separators', () => {
    expect(sanitizeMarkdown('a\x1eb\x1fc')).toBe('a b c');
  });

  it('collapses NUL and other C0 control characters', () => {
    expect(sanitizeMarkdown('a\x00b\x07c')).toBe('a b c');
  });

  it('collapses Unicode line/byte separators', () => {
    expect(sanitizeMarkdown('a\u2028b\u2029c')).toBe('a b c');
  });

  it('strips bidi and zero-width controls without separating visible text', () => {
    const controls =
      '\u061c\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2060\u2066\u2067\u2068\u2069\ufeff';

    expect(sanitizeMarkdown(`safe${controls}text`)).toBe('safetext');
    expect(sanitizeSubject(`fix: safe${controls}text (#42)`)).toBe(
      'fix: safetext (#42)',
    );
  });

  it('collapses whitespace runs', () => {
    expect(sanitizeMarkdown('foo   bar\n\tbaz')).toBe('foo bar baz');
  });

  it('bounds oversized content to 500 characters', () => {
    const long = 'x'.repeat(1000);
    const result = sanitizeMarkdown(long);
    expect(result.length).toBe(500);
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeMarkdown('  hello  ')).toBe('hello');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeMarkdown('   \n\t  ')).toBe('');
  });

  it('strips emoji characters from untrusted text', () => {
    expect(sanitizeMarkdown('Streaming is faster \u{1F680}')).toBe(
      'Streaming is faster',
    );
    expect(sanitizeMarkdown('\u{1F389} New feature added')).toBe(
      'New feature added',
    );
  });

  it('strips pictograph and dingbat characters', () => {
    expect(sanitizeMarkdown('Fix: crashes \u{2705}')).toBe('Fix: crashes');
    expect(sanitizeMarkdown('Test \u{2714} done')).toBe('Test done');
  });
});

describe('sanitizeOptionalMarkdown', () => {
  it('returns empty string for undefined', () => {
    expect(sanitizeOptionalMarkdown(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(sanitizeOptionalMarkdown(null)).toBe('');
  });

  it('sanitizes provided value', () => {
    const result = sanitizeOptionalMarkdown('[link](https://x.invalid)');
    expect(result).not.toContain('[');
    expect(result).not.toContain(']');
    expect(result).not.toContain('https');
    expect(result).toContain('link');
  });
});

describe('renderContributor', () => {
  it('renders a sanitized contributor handle with @ prefix', () => {
    expect(renderContributor('alice')).toBe('- @alice');
  });

  it('rejects login with injected markdown', () => {
    expect(renderContributor('alice`code`')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(renderContributor('   ')).toBe('');
  });

  it('renders a valid bot login', () => {
    expect(renderContributor('dependabot[bot]')).toBe('- @dependabot[bot]');
  });

  it('rejects a login starting with a hyphen', () => {
    expect(renderContributor('-evil')).toBe('');
  });

  it('rejects a login ending with a hyphen', () => {
    expect(renderContributor('evil-')).toBe('');
  });
  it('rejects a login with newline (injection attempt)', () => {
    expect(renderContributor('alice\n- @admin')).toBe('');
  });

  it('rejects a login with consecutive hyphens', () => {
    expect(renderContributor('a--b')).toBe('');
  });

  it('rejects a team mention as a contributor login', () => {
    expect(renderContributor('org/team')).toBe('');
  });

  it('rejects a malformed login with special characters', () => {
    expect(renderContributor('user;rm -rf')).toBe('');
  });
});

describe('renderBullet', () => {
  it('renders a sanitized bullet', () => {
    expect(renderBullet('Fixed streaming hang')).toBe('- Fixed streaming hang');
  });

  it('strips injected heading from bullet text', () => {
    expect(renderBullet('### All Changes')).toBe('- All Changes');
  });

  it('returns empty string for empty input', () => {
    expect(renderBullet('')).toBe('');
  });
});

describe('sanitizeSubject', () => {
  it('preserves PR/issue references like #42', () => {
    expect(sanitizeSubject('Merge pull request #42 from feature')).toBe(
      'Merge pull request #42 from feature',
    );
  });

  it('preserves terminal PR marker (#N)', () => {
    expect(sanitizeSubject('feat: add streaming (#100)')).toBe(
      'feat: add streaming (#100)',
    );
  });

  it('strips markdown heading hash at line start', () => {
    expect(sanitizeSubject('### All Changes')).toBe('All Changes');
  });

  it('strips backticks and code injection', () => {
    const result = sanitizeSubject('feat: `rm -rf /` malicious');
    expect(result).not.toContain('`');
  });

  it('strips link syntax but preserves the text', () => {
    const result = sanitizeSubject('feat: [click](https://evil.invalid)');
    expect(result).not.toContain('https');
    expect(result).not.toContain('[');
    expect(result).toContain('click');
  });

  it('strips HTML injection', () => {
    const result = sanitizeSubject('feat: <script>alert(1)</script>');
    expect(result).not.toContain('<script>');
  });

  it('strips control characters including 0x1e/0x1f', () => {
    const result = sanitizeSubject('feat: inject\x1erecord\x1fsep');
    expect(result).not.toContain('\x1e');
    expect(result).not.toContain('\x1f');
  });

  it('collapses whitespace including newlines', () => {
    expect(sanitizeSubject('feat: multiline\n  thing')).toBe(
      'feat: multiline thing',
    );
  });

  it('preserves multiple PR references', () => {
    expect(sanitizeSubject('fix: thing Fixes #1 Closes #2 (#100)')).toBe(
      'fix: thing Fixes #1 Closes #2 (#100)',
    );
  });

  it('strips image syntax', () => {
    const result = sanitizeSubject('feat: ![alt](https://evil.invalid/x.png)');
    expect(result).not.toContain('https');
    expect(result).not.toContain('!');
    expect(result).toContain('alt');
  });

  it('bounds oversized content to 500 characters', () => {
    const long = 'x'.repeat(1000);
    const result = sanitizeSubject(long);
    expect(result.length).toBe(500);
  });

  it('strips emoji characters while preserving PR references', () => {
    expect(sanitizeSubject('feat: add streaming \u{1F680} (#100)')).toBe(
      'feat: add streaming (#100)',
    );
  });

  it.each(['🇺🇸', '🏽', '1️⃣'])(
    'strips complete emoji forms from subjects: %s',
    (emoji) => {
      expect(sanitizeSubject(`feat: ready ${emoji} (#100)`)).toBe(
        'feat: ready (#100)',
      );
    },
  );

  it('does not split supplementary characters at the field boundary', () => {
    const result = sanitizeSubject(`${'x'.repeat(499)}𠮷tail`);
    expect(Array.from(result)).toHaveLength(500);
    expect(result.endsWith('𠮷')).toBe(true);
  });
});
