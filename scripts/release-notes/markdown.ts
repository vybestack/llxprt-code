/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maximum length for any rendered untrusted field. Prevents oversized
 * content from blowing up release-notes structure.
 */
const MAX_FIELD_LENGTH = 500;

/**
 * Characters and substrings that carry structural meaning in Markdown and
 * must never survive into rendered output from untrusted sources. Curated
 * maintainer Markdown (docs/release-notes/<version>.md) is the ONLY trusted
 * Markdown channel and bypasses this sanitization.
 */
const UNSAFE_CHARACTERS = /[`<>[\]\\#*_~]|!\[|]\(|:\s*\/\//g;

/**
 * URL schemes that must be stripped entirely to prevent link injection.
 */
const URL_SCHEMES = /\b(?:https?:\/\/|www\.)\S+/gi;

/**
 * Emoji and pictograph characters that must be stripped from all untrusted
 * rendered fields. Release notes must be emoji-free per the issue contract
 * and the LLM prompt's "NO EMOJIS" rule.
 */
const EMOJI_PATTERN =
  /[0-9#*]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0F}|\u{200D}|\u{20E3}/gu;

function truncateField(input: string): string {
  return Array.from(input).slice(0, MAX_FIELD_LENGTH).join('');
}

/**
 * Returns true when the character code is a control character that must be
 * collapsed to a space: C0 (0x00–0x1F), DEL (0x7F), C1 (0x80–0x9F),
 * Unicode line/paragraph separators (0x2028, 0x2029), soft hyphen (0x00AD),
 * and BOM (0xFEFF). Uses codepoint comparison instead of a control-character
 * regex to satisfy no-control-regex without suppression.
 */
function isControlCharacter(charCode: number): boolean {
  return (
    isC0Control(charCode) || isC1Control(charCode) || isUnicodeControl(charCode)
  );
}

function isC0Control(charCode: number): boolean {
  return charCode >= 0x00 && charCode <= 0x1f;
}

function isC1Control(charCode: number): boolean {
  return charCode === 0x7f || (charCode >= 0x80 && charCode <= 0x9f);
}

function isUnicodeControl(charCode: number): boolean {
  return charCode === 0x2028 || charCode === 0x2029 || charCode === 0x00ad;
}

const INVISIBLE_FORMAT_CONTROLS = new Set([0x061c, 0x2060, 0xfeff]);

function isInvisibleFormatControl(charCode: number): boolean {
  if (INVISIBLE_FORMAT_CONTROLS.has(charCode)) {
    return true;
  }
  const inZeroWidthRange = charCode >= 0x200b && charCode <= 0x200f;
  const inBidiOverrideRange = charCode >= 0x202a && charCode <= 0x202e;
  const inBidiIsolateRange = charCode >= 0x2066 && charCode <= 0x2069;
  return inZeroWidthRange || inBidiOverrideRange || inBidiIsolateRange;
}

/**
 * Collapses all control characters (C0, DEL, C1, and Unicode control ranges)
 * to a single space using character-level logic. Prevents embedded
 * record/field separators, NULs, and other invisible characters from
 * altering structure.
 */
function stripControlCharacters(input: string): string {
  let result = '';
  for (let index = 0; index < input.length; index++) {
    const charCode = input.charCodeAt(index);
    if (isInvisibleFormatControl(charCode)) {
      continue;
    }
    result += isControlCharacter(charCode) ? ' ' : input[index];
  }
  return result;
}

/**
 * Sanitizes a single untrusted string for safe Markdown rendering.
 *
 * Strips structural Markdown characters (backticks, angle brackets, square
 * brackets, backslashes, headings, emphasis, links, images), collapses
 * control characters and whitespace, and bounds the length. The result is
 * plain text that cannot alter the surrounding Markdown structure.
 */
export function sanitizeMarkdown(input: string): string {
  const stripped = stripControlCharacters(input)
    .replace(URL_SCHEMES, ' ')
    .replace(EMOJI_PATTERN, '')
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateField(stripped);
}

/**
 * Sanitizes an optional string, returning an empty string for null/undefined.
 */
export function sanitizeOptionalMarkdown(
  input: string | undefined | null,
): string {
  if (input === undefined || input === null) {
    return '';
  }
  return sanitizeMarkdown(input);
}

/**
 * Validates a bare GitHub login (without @). GitHub usernames are 1-39 chars,
 * alphanumeric and hyphens, not starting or ending with a hyphen, no
 * consecutive hyphens. Bot accounts use a `name[bot]` suffix. Team mentions
 * use `org/team` format. This validation prevents malformed/injection
 * logins from rendering as live mention links.
 */
const GITHUB_LOGIN_PATTERN =
  /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?$/;

function isValidGitHubLogin(login: string): boolean {
  const accountName = login.endsWith('[bot]') ? login.slice(0, -5) : login;
  if (accountName.length === 0 || accountName.length > 39) {
    return false;
  }
  return GITHUB_LOGIN_PATTERN.test(login);
}

/**
 * Renders a contributor handle safely. The caller supplies the bare login
 * (without @); this function validates it against GitHub login grammar,
 * sanitizes it, and ensures it cannot inject structure. Invalid logins are
 * omitted entirely (returns empty string).
 */
export function renderContributor(login: string): string {
  if (!isValidGitHubLogin(login)) {
    return '';
  }
  return `- @${login}`;
}

/**
 * Renders a bullet item safely, prefixing with "- " after sanitizing the text.
 */
export function renderBullet(text: string): string {
  const sanitized = sanitizeMarkdown(text);
  if (sanitized.length === 0) {
    return '';
  }
  return `- ${sanitized}`;
}

/**
 * Sanitizes a commit subject for the "All Changes" section. Like
 * sanitizeMarkdown, but preserves `#N` PR/issue references (a `#` immediately
 * followed by digits) which are common in commit subjects and carry no
 * Markdown heading risk (headings require `#` at line start followed by
 * whitespace). Heading-style `#` (at start followed by space) is still
 * stripped.
 */
function sanitizeSubjectText(input: string): string {
  const withoutUrls = stripControlCharacters(input)
    .replace(URL_SCHEMES, ' ')
    .replace(EMOJI_PATTERN, '');
  return withoutUrls
    .split(/(#\d+)/g)
    .map((segment) =>
      /^#\d+$/.test(segment)
        ? segment
        : segment.replace(UNSAFE_CHARACTERS, ' '),
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeSubject(input: string): string {
  return truncateField(sanitizeSubjectText(input));
}

export function sanitizeAllChangesLine(input: string): string {
  return sanitizeSubjectText(input);
}
