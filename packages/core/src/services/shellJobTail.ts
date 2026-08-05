/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import type {
  ShellJobTailOptions,
  ShellJobTailResult,
} from './shellJobTypes.js';

const DEFAULT_TAIL_LINES = 50;
const DEFAULT_TAIL_MAX_BYTES = 4096;

/**
 * Read the tail of a log file from the end, without loading the whole file
 * into memory. Uses fs.read with a bounded buffer starting from EOF.
 */
export function tailOutput(
  logPath: string,
  id: string,
  options?: Partial<ShellJobTailOptions>,
): ShellJobTailResult {
  const lines = options?.lines ?? DEFAULT_TAIL_LINES;
  const maxBytes = options?.maxBytes ?? DEFAULT_TAIL_MAX_BYTES;

  const tail = readFileTail(logPath, maxBytes);
  if (tail === null) {
    return { id, output: '', truncated: false };
  }

  const text = decodeTail(tail.buffer);
  const { trimmed, truncated } = extractLastLines(
    text,
    lines,
    tail.hasEarlierData,
  );
  return { id, output: trimmed, truncated };
}

/**
 * Read the last up to `maxBytes` bytes of a file from the end, without loading
 * the whole file into memory. Returns the bounded buffer plus whether earlier
 * data existed that was not read (so callers can treat the first line as
 * partial). Returns null when the file does not exist or cannot be stat'd.
 *
 * This is the shared bounded reader used by both the POSIX stdout tail and the
 * Windows stderr tail.
 */
function readFileTail(
  filePath: string,
  maxBytes: number,
): { buffer: Buffer; hasEarlierData: boolean } | null {
  const stat = statFile(filePath);
  if (stat === null) {
    return null;
  }

  // Clamp defensively: tailOutput / tailOutputWindows are exported, so a
  // caller can pass a negative, fractional, or NaN maxBytes that would
  // otherwise reach Buffer.alloc. NaN must be screened explicitly because
  // Math.max(0, NaN) is NaN, not 0, and Buffer.alloc(NaN) throws
  // ERR_OUT_OF_RANGE. Infinity needs no special case: it survives floor/max
  // and the Math.min below reduces it to stat.size, i.e. "read the whole file".
  const safeMaxBytes = Number.isNaN(maxBytes)
    ? 0
    : Math.max(0, Math.floor(maxBytes));

  const readSize = Math.min(stat.size, safeMaxBytes);
  const buffer = Buffer.alloc(readSize);
  const position = stat.size - readSize;

  const fd = openForRead(filePath);
  try {
    readBackwards(fd, buffer, position);
  } finally {
    fs.closeSync(fd);
  }

  return { buffer, hasEarlierData: position > 0 };
}

function statFile(logPath: string): { size: number } | null {
  try {
    return fs.statSync(logPath);
  } catch {
    return null;
  }
}

function openForRead(logPath: string): number {
  return fs.openSync(logPath, 'r');
}

function readBackwards(fd: number, buffer: Buffer, position: number): void {
  if (buffer.length === 0) {
    return;
  }
  fs.readSync(fd, buffer, 0, buffer.length, position);
}

function decodeTail(buffer: Buffer): string {
  return buffer.toString('utf8');
}

function extractLastLines(
  text: string,
  maxLines: number,
  hasEarlierData: boolean,
): { trimmed: string; truncated: boolean } {
  const allLines = text.split('\n');
  // Remove a trailing empty entry from a trailing newline
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
    allLines.pop();
  }
  // If we started mid-file, the first line is partial — drop it
  if (hasEarlierData && allLines.length > 1) {
    allLines.shift();
  }

  const start = Math.max(0, allLines.length - maxLines);
  const selected = allLines.slice(start);
  const truncated = start > 0 || hasEarlierData;
  return { trimmed: selected.join('\n'), truncated };
}

/**
 * Decode the CLIXML character escapes used by PowerShell:
 * - `_x000D_` → carriage return
 * - `_x000A_` → line feed
 * - Standard XML entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&apos;`)
 *
 * `&amp;` is decoded last to avoid double-decoding.
 */
function decodeClixmlText(text: string): string {
  let result = text;
  result = result.replace(/_x000D_/g, '\r');
  result = result.replace(/_x000A_/g, '\n');
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&apos;/g, "'");
  result = result.replace(/&amp;/g, '&');
  return result;
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

/**
 * A character that may legally follow a tag name: `>`, whitespace, or `/`
 * (self-closing). Used to enforce a real tag-name boundary so `<ObjsBogus>`
 * is NOT treated as an `<Objs>` open tag. `charCodeAt` returns NaN past the
 * end of the string, which correctly fails this check.
 */
function isTagNameBoundary(c: number): boolean {
  return c === 62 /* > */ || c === 47 /* / */ || isSpace(c);
}

// ---------------------------------------------------------------------------
// Strict single-pass tag lexer
// ---------------------------------------------------------------------------

interface LexedTag {
  end: number; // index one past the closing '>'
  name: string;
  isClosing: boolean; // '</name ...>'
  isSelfClosing: boolean; // '<name .../>'
  attributes: ReadonlyMap<string, string>;
}

interface LexFailure {
  failedAt: number; // index where the grammar first deviated
}

/**
 * Character classes for XML names, as pre-computed Sets for O(1) lookup.
 * Tag/attribute name: first char [A-Za-z_], subsequent [A-Za-z0-9_.:-].
 */
const TAG_FIRST_CHARS: ReadonlySet<number> = (() => {
  const s = new Set<number>();
  for (let c = 65; c <= 90; c++) s.add(c); // A-Z
  for (let c = 97; c <= 122; c++) s.add(c); // a-z
  s.add(95); // _
  return s;
})();

const TAG_NAME_CHARS: ReadonlySet<number> = (() => {
  const s = new Set(TAG_FIRST_CHARS);
  for (let c = 48; c <= 57; c++) s.add(c); // 0-9
  s.add(46); // .
  s.add(58); // :
  s.add(45); // -
  return s;
})();

function isTagFirstChar(c: number): boolean {
  return TAG_FIRST_CHARS.has(c);
}

function isTagNameChar(c: number): boolean {
  return TAG_NAME_CHARS.has(c);
}

/**
 * Scan a tag/attribute name starting at `i`. Returns the name string and the
 * index just past it. Assumes raw[i] is already confirmed as a first char.
 */
function scanName(
  raw: string,
  i: number,
  len: number,
): { name: string; end: number } {
  const start = i;
  i++;
  while (i < len && isTagNameChar(raw.charCodeAt(i))) {
    i++;
  }
  return { name: raw.slice(start, i), end: i };
}

/**
 * Skip whitespace characters, returning the new index and whether any
 * whitespace was consumed.
 */
function skipWhitespace(
  raw: string,
  i: number,
  len: number,
): { end: number; consumed: boolean } {
  let consumed = false;
  while (i < len && isSpace(raw.charCodeAt(i))) {
    consumed = true;
    i++;
  }
  return { end: i, consumed };
}

/**
 * Result of attempting to parse one attribute at position `i`.
 */
type AttrResult =
  | { ok: true; name: string; value: string; end: number }
  | LexFailure;

/**
 * Parse a single attribute (name='value' or name="value") starting at `i`.
 * The grammar requires: name, exactly '=', a quote, value to matching quote.
 * A '<' inside the value is a failure. EOF before matching quote is a failure.
 */
function parseAttribute(raw: string, i: number, len: number): AttrResult {
  if (!isTagFirstChar(raw.charCodeAt(i))) {
    return { failedAt: i };
  }
  const namePart = scanName(raw, i, len);
  const { name, end: afterName } = namePart;

  // Exactly '=' with no surrounding whitespace.
  if (afterName >= len || raw.charCodeAt(afterName) !== 61 /* = */) {
    return { failedAt: afterName >= len ? len : afterName };
  }
  const afterEq = afterName + 1;
  if (afterEq >= len) {
    return { failedAt: len };
  }
  const quote = raw.charCodeAt(afterEq);
  if (quote !== 34 /* " */ && quote !== 39 /* ' */) {
    return { failedAt: afterEq };
  }
  // Value: scan to matching quote. '<' inside value is a failure.
  let vi = afterEq + 1;
  while (vi < len) {
    const vc = raw.charCodeAt(vi);
    if (vc === quote) {
      return { ok: true, name, value: raw.slice(afterEq + 1, vi), end: vi + 1 };
    }
    if (vc === 60 /* < */) {
      return { failedAt: vi };
    }
    vi++;
  }
  return { failedAt: len };
}

/**
 * Strict, single-pass XML tag lexer. The grammar admits no `<` anywhere inside
 * a tag except at its very start, so a LexFailure's skipped span is safe to
 * emit verbatim (it cannot contain a candidate tag start). Duplicate attribute
 * names are rejected (they are not well-formed XML) so malformed input cannot
 * be silently rewritten or suppressed.
 *
 * Returns {@link LexedTag} on success or {@link LexFailure} at the first
 * deviation. The grammar never scans past a deviation.
 */
function lexTag(raw: string, start: number): LexedTag | LexFailure {
  const len = raw.length;

  if (start >= len || raw.charCodeAt(start) !== 60 /* < */) {
    return { failedAt: start };
  }

  let i = start + 1;
  let isClosing = false;

  if (i < len && raw.charCodeAt(i) === 47 /* / */) {
    isClosing = true;
    i++;
  }

  // Name: first char [A-Za-z_], subsequent [A-Za-z0-9_.:-].
  if (i >= len || !isTagFirstChar(raw.charCodeAt(i))) {
    return { failedAt: i >= len ? len : i };
  }
  const nameResult = scanName(raw, i, len);
  i = nameResult.end;
  const attributes = new Map<string, string>();

  while (i < len) {
    const ws = skipWhitespace(raw, i, len);
    i = ws.end;

    if (i >= len) {
      return { failedAt: len };
    }
    const c = raw.charCodeAt(i);

    // '>' ends the tag.
    if (c === 62 /* > */) {
      return {
        end: i + 1,
        name: nameResult.name,
        isClosing,
        isSelfClosing: false,
        attributes,
      };
    }
    // '/' handling: '/>' is self-closing (forbidden on closing tags).
    if (c === 47 /* / */) {
      const isSelfClose = i + 1 < len && raw.charCodeAt(i + 1) === 62; /* > */
      if (!isSelfClose) return { failedAt: i };
      if (isClosing) return { failedAt: i };
      return {
        end: i + 2,
        name: nameResult.name,
        isClosing,
        isSelfClosing: true,
        attributes,
      };
    }
    // Must be an attribute requiring preceding whitespace.
    if (!ws.consumed || isClosing) {
      return { failedAt: i };
    }
    const attrNameStart = i;
    const attr = parseAttribute(raw, i, len);
    if (!('ok' in attr)) {
      return attr;
    }
    if (attributes.has(attr.name)) {
      return { failedAt: attrNameStart };
    }
    attributes.set(attr.name, attr.value);
    i = attr.end;
  }
  return { failedAt: len };
}

// ---------------------------------------------------------------------------
// Token recognition on top of the strict lexer
// ---------------------------------------------------------------------------

/**
 * Result of matching a CLIXML construct at a single cursor position.
 *
 * Only a POSITIVELY RECOGNISED, COMPLETE, WELL-FORMED construct (one that the
 * strict lexer accepts) may be rewritten. Everything else is emitted verbatim.
 */
type ClixmlTokenMatch =
  | { kind: 'containerOpen'; end: number }
  | { kind: 'containerClose'; end: number }
  | { kind: 'record'; end: number; textContent: string }
  | { kind: 'emptyRecord'; end: number }
  | { kind: 'verbatimSpan'; end: number }
  | { kind: 'verbatimTag'; end: number }
  | {
      kind: 'recordOpenOnly';
      end: number;
      /**
       * When the closer search was actually performed (not cached), this is the
       * rightmost position searched. undefined when the result came from the
       * noCloserAfterS cache. The caller uses it to update the cache so that
       * subsequent unmatched openers skip the O(n) suffix scan entirely.
       */
      scannedTo: number | undefined;
    }
  | { kind: 'lexFailure'; failedAt: number };

/**
 * Find the next well-formed `</S>` closing tag (no attributes, not
 * self-closing) at or after `from`. Uses the strict lexer so malformed
 * `</S ` candidates cannot trigger repeated suffix rescans.
 */
function findClosingTagS(
  raw: string,
  from: number,
): { start: number; end: number } | null {
  let pos = from;
  while (pos < raw.length) {
    const idx = raw.indexOf('</S', pos);
    if (idx === -1) return null;
    // Tag-name boundary: char after '</S' must be >, /, or whitespace.
    if (!isTagNameBoundary(raw.charCodeAt(idx + 3))) {
      pos = idx + 3;
      continue;
    }
    const tag = lexTag(raw, idx);
    if ('end' in tag) {
      if (
        tag.name === 'S' &&
        tag.isClosing &&
        !tag.isSelfClosing &&
        tag.attributes.size === 0
      ) {
        return { start: idx, end: tag.end };
      }
      pos = tag.end;
    } else {
      // LexFailure: advance to failedAt (monotone, O(n)).
      pos = tag.failedAt > idx ? tag.failedAt : idx + 1;
    }
  }
  return null;
}

/**
 * Try to match a CLIXML construct at `pos`, which must point to '<'.
 *
 * Token recognition rules:
 * - Container suppression applies ONLY to a successfully lexed,
 *   non-self-closing `<Objs ...>` opener and a successfully lexed `</Objs>`
 *   with no attributes.
 * - Record suppression applies ONLY to a successfully lexed `<S ...>` opener
 *   that ACTUALLY CARRIES an `S` attribute. A bare `<S>` is NOT a record.
 * - A self-closing `<S S="..."/>` is an EMPTY record: consume the opener,
 *   contribute no text, do NOT pair with any later `</S>`.
 * - Everything the lexer rejects is emitted verbatim (lexFailure).
 */
function matchClixmlToken(
  raw: string,
  pos: number,
  noCloserAfterS: number,
): ClixmlTokenMatch {
  const tag = lexTag(raw, pos);

  if ('failedAt' in tag) {
    return { kind: 'lexFailure', failedAt: tag.failedAt };
  }

  const { name, isClosing, isSelfClosing, attributes, end } = tag;

  // --- <Objs ...> container ---
  if (name === 'Objs') {
    if (!isClosing && !isSelfClosing) {
      return { kind: 'containerOpen', end };
    }
    if (isClosing && !isSelfClosing && attributes.size === 0) {
      return { kind: 'containerClose', end };
    }
    // Self-closing or closing-with-attrs Objs — emit verbatim.
    return { kind: 'verbatimTag', end };
  }

  // --- <S ...> record ---
  if (name === 'S' && !isClosing) {
    // Record suppression requires an actual S attribute.
    if (!attributes.has('S')) {
      // Bare <S> or <S foo="bar"> without S attr — verbatim.
      return { kind: 'verbatimTag', end };
    }

    if (isSelfClosing) {
      // <S S="..."/> — well-formed EMPTY record.
      return { kind: 'emptyRecord', end };
    }

    // Performance: skip the suffix scan when a previous opener already proved
    // no closer exists in the remainder of the input.
    //
    // This is sound, and deliberately so — do not "fix" the comparison:
    //   1. findClosingTagS(raw, X) === null proves there is no well-formed
    //      </S> at ANY position >= X. Searching a SHORTER suffix can never
    //      find a closer that searching a longer one missed.
    //   2. The tokenizer only ever moves forward, so every subsequent opener
    //      begins at a position > X.
    // Together these mean the cached answer (recordOpenOnly) is identical to
    // what a real scan would return, so caching raw.length and skipping via
    // `end <= noCloserAfterS` yields the correct result rather than merely a
    // faster one. It turns an O(n^2) suffix rescan into O(n).
    if (end <= noCloserAfterS) {
      return { kind: 'recordOpenOnly', end, scannedTo: undefined };
    }

    const closer = findClosingTagS(raw, end);
    if (closer === null) {
      return { kind: 'recordOpenOnly', end, scannedTo: raw.length };
    }

    const textContent = raw.slice(end, closer.start);
    // Nested records (content contains '<') — emit verbatim.
    if (textContent.includes('<')) {
      return { kind: 'verbatimSpan', end: closer.end };
    }
    return { kind: 'record', end: closer.end, textContent };
  }

  // Any other successfully lexed tag — emit verbatim.
  return { kind: 'verbatimTag', end };
}

/**
 * Fast gate: if the input has no CLIXML-like markers at all, skip the decoder
 * entirely and return the raw string byte-identical. The decoder itself
 * handles non-CLIXML correctly (emits verbatim), so this is purely an
 * optimisation.
 */
function looksLikeClixml(raw: string): boolean {
  const markers = ['#< CLIXML', '<Objs', '</Objs', '<S', '</S'];
  return markers.some((m) => raw.includes(m));
}

/**
 * Decode a Windows stderr log that may contain CLIXML-serialised PowerShell
 * stream records mixed with native-executable plain text.
 *
 * Single rule (H1): only a POSITIVELY RECOGNISED, COMPLETE, WELL-FORMED
 * construct may be rewritten; every other byte is emitted VERBATIM, in order.
 * Recognised constructs are exactly: the `#< CLIXML` marker (suppressed), a
 * complete `<Objs ...>` / `</Objs>` tag with a real tag-name boundary
 * (suppressed), and a complete `<S S="...">…</S>` record whose content
 * contains no `<` (its CLIXML-unescaped content is emitted). Records of any
 * stream type are recognised — content is preserved over labelling.
 *
 * Consequently: a stray `</S>`, a nested record, an unsupported stream type's
 * raw markup, a truncated trailing opener, and `<ObjsBogus>` are all emitted
 * verbatim. No construct causes a whole-document raw fallback, so this works
 * naturally for tail slices that begin mid-document. The scan is O(n) with a
 * cursor that strictly advances. Non-CLIXML (plain) stderr passes through
 * byte-identical via the `looksLikeClixml` gate.
 */
export function decodeClixmlStderr(raw: string): string {
  if (!looksLikeClixml(raw)) return raw;
  try {
    return decodeClixmlInner(raw);
  } catch {
    return raw;
  }
}

/**
 * Match the CLIXML marker whose '<' is at `lt` (the '#' precedes it) and
 * return the index just past the marker and its single following newline, or
 * null when `lt` is not the marker. The marker is recognised ONLY as a
 * complete line marker: the '#' must start at index 0 or immediately after a
 * line feed, AND must be followed by a carriage return, line feed, or
 * end-of-input. Otherwise it is not a marker and the caller emits it verbatim.
 */
function matchClixmlMarker(raw: string, lt: number): number | null {
  const hashPos = lt - 1;
  if (hashPos < 0) return null;
  if (raw.charCodeAt(hashPos) !== 35 /* # */) return null;
  if (!raw.startsWith('#< CLIXML', hashPos)) return null;

  // Line-start boundary: '#' must be at index 0 or immediately after LF.
  if (hashPos > 0 && raw.charCodeAt(hashPos - 1) !== 10) return null;

  // Trailing boundary: marker must be followed by CR, LF, or EOF.
  let end = lt + 8; // one past 'L' of 'CLIXML'
  if (end < raw.length) {
    const after = raw.charCodeAt(end);
    if (after !== 13 && after !== 10) return null;
  }
  if (raw.charCodeAt(end) === 13) end++; // CR
  if (raw.charCodeAt(end) === 10) end++; // LF

  return end;
}

/**
 * Single-cursor forward lexer. At each `<` it emits the preceding verbatim
 * text, then either suppresses a recognised marker/container, decodes a
 * recognised record, or (for anything the strict lexer rejects) emits the
 * span up to the failure point verbatim and jumps past it. The cursor is
 * strictly monotone and each character is inspected O(1) times.
 */
function decodeClixmlInner(raw: string): string {
  const parts: string[] = [];
  let cursor = 0;
  // Mutable cache: once findClosingTagS returns null (no </S> found), all
  // positions up to raw.length are known to have no closer. Subsequent
  // unmatched openers at or before this boundary skip the O(n) suffix scan,
  // keeping the overall decode O(n) instead of O(n²).
  const noCloserAfterSHolder = { value: -1 };

  while (cursor < raw.length) {
    const lt = raw.indexOf('<', cursor);
    if (lt === -1) {
      // No more '<' — emit the remaining tail verbatim and stop.
      parts.push(raw.slice(cursor));
      cursor = raw.length;
    } else {
      cursor = processClixmlAtCursor(
        raw,
        lt,
        cursor,
        parts,
        noCloserAfterSHolder,
      );
    }
  }

  return parts.join('');
}

/**
 * Process a single `<` position. Emits preceding verbatim text, then either
 * suppresses a recognised marker/container, decodes a record, or emits the
 * `<` verbatim. Returns the new cursor position.
 */
function processClixmlAtCursor(
  raw: string,
  lt: number,
  cursor: number,
  parts: string[],
  noCloserAfterSHolder: { value: number },
): number {
  // The marker `#< CLIXML` starts with `#` at lt-1. Check BEFORE emitting
  // verbatim text so the `#` (part of the marker) is not emitted.
  const markerEnd = matchClixmlMarker(raw, lt);
  if (markerEnd !== null) {
    if (lt - 1 > cursor) parts.push(raw.slice(cursor, lt - 1));
    return markerEnd;
  }

  // Emit verbatim text between the cursor and this '<'.
  if (lt > cursor) parts.push(raw.slice(cursor, lt));

  const match = matchClixmlToken(raw, lt, noCloserAfterSHolder.value);
  switch (match.kind) {
    case 'containerOpen':
    case 'containerClose':
    case 'emptyRecord':
      // Suppressed: advance past the tag.
      return match.end;

    case 'record':
      parts.push(decodeClixmlText(match.textContent));
      return match.end;

    case 'verbatimSpan':
    case 'verbatimTag':
      // Successfully lexed but unrecognised or nested: emit verbatim.
      parts.push(raw.slice(lt, match.end));
      return match.end;

    case 'recordOpenOnly':
      // Well-formed opener with no closer: emit verbatim, advance PAST it.
      parts.push(raw.slice(lt, match.end));
      if (match.scannedTo !== undefined) {
        noCloserAfterSHolder.value = match.scannedTo;
      }
      return match.end;

    case 'lexFailure': {
      // SOUNDNESS ARGUMENT (load-bearing): the strict grammar admits no '<'
      // anywhere inside a tag except at its very start. So the span
      // [lt, failedAt) provably contains no candidate tag start — it is safe
      // to emit it verbatim and jump the cursor to failedAt. The cursor is
      // strictly monotone and each character is inspected O(1) times, giving
      // O(n) total. When failedAt === lt (defensive fallback for raw[lt]
      // not being '<'), emit just '<' and advance by 1.
      if (match.failedAt > lt) {
        parts.push(raw.slice(lt, match.failedAt));
        return match.failedAt;
      }
      parts.push('<');
      return lt + 1;
    }

    default:
      // Exhaustive — no other kinds remain.
      return lt + 1;
  }
}

/**
 * Read the merged tail of a Windows job: stdout log content, then decoded
 * stderr content when non-empty. Both logs are read with the bounded tail
 * primitive (never the whole file), and the merged result is capped to the
 * caller's lines / maxBytes budget so appending stderr can never exceed it.
 */
export function tailOutputWindows(
  logPath: string,
  errLogPath: string | undefined,
  id: string,
  options?: Partial<ShellJobTailOptions>,
): ShellJobTailResult {
  const lines = options?.lines ?? DEFAULT_TAIL_LINES;
  const maxBytes = options?.maxBytes ?? DEFAULT_TAIL_MAX_BYTES;

  const stdoutResult = tailOutput(logPath, id, options);

  if (errLogPath === undefined) {
    return stdoutResult;
  }

  // Bounded tail read of the stderr log: never loads the whole file. CLIXML
  // decoding happens AFTER this bounded read, so the decoder must tolerate a
  // slice that begins mid-CLIXML-document (no `#< CLIXML` marker).
  const stderrTail = readFileTail(errLogPath, maxBytes);
  if (stderrTail === null) {
    return stdoutResult;
  }

  const rawStderr = decodeTail(stderrTail.buffer);
  const decodedStderr = decodeClixmlStderr(rawStderr);
  if (decodedStderr.length === 0) {
    // Only genuinely empty decoded stderr (e.g. all-CLIXML suppressed) is
    // skipped. Whitespace-only output is genuine content and is preserved.
    // Even when the decoded stderr is empty, if the raw stderr was truncated
    // (hasEarlierData), the original output WAS truncated.
    return {
      id,
      output: stdoutResult.output,
      truncated: stdoutResult.truncated || stderrTail.hasEarlierData,
    };
  }

  const merged =
    stdoutResult.output.length > 0
      ? `${stdoutResult.output}\n[stderr]\n${decodedStderr}`
      : decodedStderr;

  // The merged stdout+stderr result must still respect the caller's budget.
  const { text: capped, truncated: cappedTruncated } = capMergedToBudget(
    merged,
    maxBytes,
    lines,
  );

  return {
    id,
    output: capped,
    truncated:
      stdoutResult.truncated || stderrTail.hasEarlierData || cappedTruncated,
  };
}

/**
 * Cap a merged stdout+stderr string to the caller's byte and line budget,
 * keeping the tail (most-recent content). Used so that appending stderr can
 * never make the merged result exceed roughly the requested budget.
 */
function capMergedToBudget(
  text: string,
  maxBytes: number,
  maxLines: number,
): { text: string; truncated: boolean } {
  let result = text;
  let truncated = false;

  if (Buffer.byteLength(result, 'utf8') > maxBytes) {
    truncated = true;
    result = sliceTailToUtf8ByteBudget(result, maxBytes);
  }

  const allLines = result.split('\n');
  if (allLines.length > maxLines) {
    truncated = true;
    result = allLines.slice(allLines.length - maxLines).join('\n');
  }

  return { text: result, truncated };
}

/**
 * Keep the tail of `text` whose UTF-8 encoding fits within `maxBytes`,
 * advancing past any continuation bytes so the result never starts mid-codepoint.
 */
function sliceTailToUtf8ByteBudget(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
    start++;
  }
  if (start >= buf.length) return '';
  return buf.subarray(start).toString('utf8');
}
