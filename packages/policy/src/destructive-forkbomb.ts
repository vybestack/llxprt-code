/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Matches a single character in the function-name identifier set `[A-Za-z0-9_:]`. */
const NAME_IDENTIFIER = /^[A-Za-z0-9_:]$/;

/** True if a character is in the function-name identifier set. */
function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && ch !== '' && NAME_IDENTIFIER.test(ch);
}

/**
 * A NEGATED character class matching a function-name token BOUNDARY: any
 * character that is NOT part of the function-name identifier set
 * `[A-Za-z0-9_:]`. Used as a left/right boundary anchor in whole-token
 * matching so `log` does not match inside `catalog`.
 */
const NAME_BOUNDARY = '[^A-Za-z0-9_:]';

/** The newline character, preserved through whitespace collapse as a separator. */
const NEWLINE = String.fromCharCode(10);

/** The backslash character (escape operator outside single quotes). */
const BACKSLASH = String.fromCharCode(92);

/** The backtick character (opens/closes a command substitution). */
const BACKTICK = String.fromCharCode(96);

/**
 * True iff the character at `s[i]` is a backslash that escapes the following
 * character, so quote/brace scanners should skip both chars. In POSIX shell a
 * backslash escapes OUTSIDE single quotes (so `\"` is a literal quote, not a
 * toggle) but is literal INSIDE single quotes (no escaping there). Returns
 * false when in single quotes or when the backslash is the last char.
 */
function isEscapedChar(s: string, i: number, inSingle: boolean): boolean {
  if (inSingle) {
    return false;
  }
  return s[i] === BACKSLASH && i + 1 < s.length;
}

/** Parsed components of a fork-bomb function definition. */
interface FunctionDefinition {
  readonly name: string;
  readonly body: string;
  /**
   * The invocation tail extracted from the ORIGINAL (pre-collapse) text,
   * starting at the first token after the `}` that is not a separator or
   * redirection. Whitespace boundaries are preserved so `: foo` is
   * distinguishable from `:foo`. Used by `tailStartsWithNameToken`.
   */
  readonly originalTail: string;
  /** Index of the closing `}` in the collapsed string (-1 if unbalanced). */
  readonly bodyEnd: number;
}

/**
 * Pattern F: detects a self-referential fork bomb anywhere in the raw command.
 * Recognizes BOTH the POSIX `name(){ ... }; name` form and the Korn/Bash
 * `function name { ... }; name` keyword form. The definition may start at ANY
 * position (so a fork bomb preceded by another command like
 * `echo hi; :(){ :|:& }; :` is still detected), but occurrences inside single
 * or double quotes are skipped (shell does not define functions inside quotes,
 * so `echo ":(){ :|:& };:"` is benign). In all cases the body must contain a
 * pipe (`|`) AND a standalone background `&` (not `&&`, not `>&`), must contain
 * the function name (self-recursion guard), and the trailing invocation must
 * start with the name.
 */
export function isForkBomb(command: string): boolean {
  // Collapse all whitespace EXCEPT newlines to nothing; collapse runs of
  // newlines to a single `\n`. A newline is a valid command separator in shell
  // (like `;`, `&`, `|`), so it must survive collapse so the brace-matcher can
  // recognize a function definition terminated by a newline (e.g.
  // `:(){ :|:& }\n:`). Non-newline whitespace carries no separator semantics
  // and is removed entirely.
  const collapsed = command.replace(/[^\S\n]+/g, '').replace(/\n+/g, '\n');
  if (collapsed.length === 0) {
    return false;
  }
  const posixDefs = scanPosixDefinitions(collapsed, command);
  for (const def of posixDefs) {
    if (isBombDefinition(def)) {
      return true;
    }
  }
  const keywordDefs = scanKeywordDefinitions(collapsed, command);
  for (const def of keywordDefs) {
    if (isBombDefinition(def)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if a parsed function definition is a self-referential fork
 * bomb: body has an UNQUOTED pipe and an UNQUOTED standalone background `&`,
 * contains the function name as a whole token, and the tail invocation starts
 * with the name.
 */
function isBombDefinition(def: FunctionDefinition): boolean {
  const hasPipeAndBg =
    hasUnquotedPipe(def.body) && hasStandaloneBackground(def.body);
  if (!hasPipeAndBg) {
    return false;
  }
  if (!containsNameToken(def.body, def.name)) {
    return false;
  }
  return tailStartsWithNameToken(def.originalTail, def.name);
}

/**
 * True iff `body` contains an unquoted pipe (`|`) operator outside single and
 * double quotes. A quoted `|` (e.g. inside `echo "a | b"`) is not a pipe.
 * Linear-time, single pass.
 */
function hasUnquotedPipe(body: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    if (isEscapedChar(body, i, inSingle)) {
      i++;
    } else if (body[i] === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (body[i] === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && body[i] === '|') {
      return true;
    }
  }
  return false;
}

/**
 * True iff `body` contains an UNQUOTED standalone background `&` operator — a
 * `&` that is NOT part of `&&` (logical AND), NOT part of `>&` (fd-dup/redirect
 * output), NOT part of `<&` (fd-dup input), NOT part of `|&` (pipe-redirect),
 * NOT part of `&>`/`&>>` (redirect stdout+stderr), and NOT inside single or
 * double quotes. In the collapsed fork-bomb body `:|:&` the trailing `&` is
 * standalone; in a body using `&&` or `&>`, or with a quoted `&` (e.g.
 * `echo"a&b"`), the `&`s are not standalone so this returns false.
 */
function hasStandaloneBackground(body: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    if (isEscapedChar(body, i, inSingle)) {
      i++;
    } else if (body[i] === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (body[i] === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (
      !inSingle &&
      !inDouble &&
      isStandaloneBackgroundAmp(body[i], body[i - 1], body[i + 1])
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True iff `ch` is a standalone background `&`: the `&` is not adjacent to
 * another `&` (so not `&&`), not preceded by `>` or `<` (so not `>&`/`<&`
 * fd-duplication), not preceded by `|` (so not `|&` pipe-and-redirect), and
 * not followed by `>` (so not `&>`/`&>>` redirect of stdout+stderr). Extracted
 * so the neighbor checks stay within the expression-complexity budget.
 */
function isStandaloneBackgroundAmp(
  ch: string | undefined,
  prev: string | undefined,
  next: string | undefined,
): boolean {
  if (ch !== '&') {
    return false;
  }
  if (prev === '&' || next === '&') {
    return false;
  }
  if (prev === '>' || prev === '<' || prev === '|') {
    return false;
  }
  return next !== '>';
}

/**
 * Escapes regex metacharacters in a literal string so it can be embedded in a
 * RegExp pattern. Linear-time, character-by-character.
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true iff `name` appears in `text` as a whole token bounded on BOTH
 * sides by either string start/end OR a character NOT in the function-name
 * identifier set `[A-Za-z0-9_:]`. This prevents substring false positives like
 * `log` matching inside `catalog`. Uses a bounded, linear-time regex (no
 * backtracking — simple anchored character-class boundaries).
 */
function containsNameToken(text: string, name: string): boolean {
  const pattern = new RegExp(
    `(^|${NAME_BOUNDARY})${escapeRegex(name)}($|${NAME_BOUNDARY})`,
  );
  return pattern.test(text);
}

/**
 * Returns true iff `tail` STARTS with `name` as a whole token: the name at
 * index 0 followed by string-end or a non-name-identifier char.
 */
function tailStartsWithNameToken(tail: string, name: string): boolean {
  if (!tail.startsWith(name)) {
    return false;
  }
  return !isNameChar(tail[name.length]);
}

/**
 * Scans `collapsed` for POSIX `NAME(){BODY};TAIL` function definitions at any
 * position, skipping occurrences inside single or double quotes. After a
 * successfully parsed definition the scanner jumps past the closing `}` so the
 * parsed body is not re-scanned (avoids pathological O(n²) on nested input).
 * The jump is safe: a definition is only parsed from the unquoted branch (so
 * quote state at the open brace is `(false, false)`), and `findMatchingBraceEnd`
 * returns only at depth 0 outside quotes, so the body region is balanced and
 * quote parity at `bodyEnd + 1` is still `(false, false)`. Linear-time.
 */
function scanPosixDefinitions(
  collapsed: string,
  original: string,
): readonly FunctionDefinition[] {
  const defs: FunctionDefinition[] = [];
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < collapsed.length) {
    const ch = collapsed[i];
    if (isEscapedChar(collapsed, i, inSingle)) {
      i += 2;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
    } else if (isUnquoted(collapsed, i, inSingle, inDouble, isOpenParenBrace)) {
      const def = parsePosixAt(collapsed, i, original);
      if (def !== null) {
        defs.push(def);
        // Advance past the definition's closing brace so the parsed body is
        // not re-scanned. Uses the bodyEnd the parser already computed.
        i = def.bodyEnd + 1;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return defs;
}

/** True iff `collapsed` at index `i` begins a `(){` triple (POSIX function opener). */
function isOpenParenBrace(collapsed: string, i: number): boolean {
  return (
    collapsed[i] === '(' && collapsed[i + 1] === ')' && collapsed[i + 2] === '{'
  );
}

/** True iff `collapsed` at index `i` begins the `function` keyword. */
function isFunctionKeyword(collapsed: string, i: number): boolean {
  return collapsed.startsWith('function', i);
}

/**
 * Maps a collapsed-text offset to the corresponding original-text offset.
 * The collapsed string is produced by removing non-newline whitespace and
 * collapsing newline runs to a single `
`. This function replays that
 * transformation, counting consumed whitespace, so the keyword scanner can
 * verify boundaries in the original (pre-collapse) text. Linear-time.
 */
function collapsedToOriginalOffset(
  original: string,
  collapsedOffset: number,
): number {
  let origIdx = 0;
  let collIdx = 0;
  while (origIdx < original.length && collIdx < collapsedOffset) {
    const ch = original[origIdx];
    if (ch === NEWLINE) {
      origIdx++;
      while (origIdx < original.length && original[origIdx] === NEWLINE) {
        origIdx++;
      }
      collIdx++;
    } else if (isNonNewlineSpace(ch)) {
      origIdx++;
    } else {
      origIdx++;
      collIdx++;
    }
  }
  // Skip any remaining whitespace/newline-run so the returned index points at
  // the original position of the collapsed char at `collapsedOffset`, not at
  // intervening whitespace that was consumed by the collapse.
  while (origIdx < original.length && isNonNewlineSpace(original[origIdx])) {
    origIdx++;
  }
  return origIdx;
}

/** True iff `ch` is a non-newline whitespace character. */
const isNonNewlineSpace = (ch: string): boolean =>
  ch !== NEWLINE && /\s/.test(ch);

/**
 * Checks whether the original text has a name boundary (whitespace or `(`)
 * immediately before the position corresponding to `collapsedOffset` — i.e.
 * between the `function` keyword and the following name in the original. Bash
 * requires `function` to be followed by whitespace (or `(` for the hybrid
 * form) to be a keyword; `functionfoo` is a single token, not `function foo`.
 */
function hasKeywordBoundaryAfter(
  original: string,
  collapsedOffset: number,
): boolean {
  const origIdx = collapsedToOriginalOffset(original, collapsedOffset);
  if (origIdx === 0) {
    return false;
  }
  if (origIdx >= original.length) {
    return true;
  }
  const prev = original[origIdx - 1];
  return isNonNewlineSpace(prev) || prev === NEWLINE || prev === '(';
}

/**
 * Returns true iff `match(collapsed, i)` holds AND the current position is
 * outside single and double quotes. Extracted so each scanner's condition
 * stays within the expression-complexity budget.
 */
function isUnquoted(
  collapsed: string,
  i: number,
  inSingle: boolean,
  inDouble: boolean,
  match: (collapsed: string, i: number) => boolean,
): boolean {
  return !inSingle && !inDouble && match(collapsed, i);
}

/**
 * Extracts the trailing invocation from the ORIGINAL (pre-collapse) text,
 * starting just after the closing `}` at `origBraceEnd`. Repeatedly skips:
 * (a) whitespace, (b) command separators (`;`, `&`, `|`, newline), and
 * (c) redirections (optional leading fd digits, a redirect operator such as
 * `>>`, `>`, `<<<`, `<<`, `<`, `>&`, `<&`, `&>>`, `&>`, then a single target
 * token up to the next separator/whitespace, honoring single/double quotes
 * minimally). The first token that is NOT one of those is the invocation
 * start; the remaining text is returned with whitespace boundaries intact so
 * `: foo` is distinguishable from `:foo`. Linear-time, single pass.
 */
function extractInvocationFromOriginal(
  original: string,
  origBraceEnd: number,
): string {
  let i = origBraceEnd + 1;
  let progressed = true;
  while (i < original.length && progressed) {
    progressed = false;
    i = skipWhitespaceAndSeparators(original, i, () => {
      progressed = true;
    });
    const redir = redirectLengthInOriginal(original, i);
    if (redir > 0) {
      i += redir;
      progressed = true;
    }
  }
  return unwrapInvocationSubstitution(original.slice(i));
}

function unwrapInvocationSubstitution(tail: string): string {
  if (tail.startsWith('$(')) {
    const close = tail.indexOf(')');
    return close > 2 ? tail.slice(2, close) : tail;
  }
  if (tail.startsWith('`')) {
    const close = tail.indexOf('`', 1);
    return close > 1 ? tail.slice(1, close) : tail;
  }
  return tail;
}

/**
 * Skips runs of whitespace and command-separator characters (`;`, `&`, `|`,
 * newline) in `original` starting at `start`. Returns the new index. Invokes
 * `onConsume` whenever at least one character is skipped, so the caller can
 * detect progress and avoid an infinite loop. Linear-time.
 */
function skipWhitespaceAndSeparators(
  original: string,
  start: number,
  onConsume: () => void,
): number {
  let i = start;
  while (i < original.length) {
    const ch = original[i];
    if (isWhitespaceChar(ch) || isSeparatorChar(ch)) {
      i++;
      onConsume();
    } else {
      break;
    }
  }
  return i;
}

/**
 * If `original[start]` begins a redirection, returns the total character count
 * of the redirection (optional fd digits + operator + single target token
 * consuming up to the next whitespace/separator, honoring quotes). Returns 0
 * when `original[start]` does not begin a redirection. Recognized operators:
 * `>>`, `>`, `<<<`, `<<`, `<`, `>&`, `<&`, `&>>`, `&>`, and a digit-run
 * prefix (`N>`, `N>>`, `N>&`, `N<&`). Linear-time.
 */
function redirectLengthInOriginal(original: string, start: number): number {
  const op = matchRedirectOperator(original, start);
  if (op === 0) {
    return 0;
  }
  return op + redirectTargetLength(original, start + op);
}

/**
 * Returns the character length of the redirect OPERATOR at `start` (including
 * any leading fd-digit prefix), or 0 if `start` does not begin a redirection
 * operator. Handles `>>`, `>`, `<<<`, `<<`, `<`, `>&`, `<&`, `&>>`, `&>`,
 * `N>`, `N>>`, `N>&`, `N<&`. Linear-time.
 */
function matchRedirectOperator(s: string, start: number): number {
  let fdLen = 0;
  while (isDigit(s[start + fdLen])) {
    fdLen++;
  }
  const p = start + fdLen;
  if (s[p] === '>') {
    if (s[p + 1] === '>') return fdLen + 2;
    if (s[p + 1] === '&') return fdLen + 2;
    return fdLen + 1;
  }
  if (s[p] === '<') {
    if (s.startsWith('<<<', p)) return fdLen + 3;
    if (s[p + 1] === '<') return fdLen + 2;
    if (s[p + 1] === '&') return fdLen + 2;
    return fdLen + 1;
  }
  if (fdLen > 0) {
    return 0;
  }
  if (s[p] === '&' && s[p + 1] === '>') {
    return s[p + 2] === '>' ? 3 : 2;
  }
  return 0;
}

/**
 * Returns the length of the single redirect TARGET token starting at `start`,
 * consuming characters until unquoted whitespace or a command separator is
 * reached. Single and double quotes are tracked minimally (a quote char toggles
 * state, no escape processing needed for boundary detection). Returns 0 when
 * the target is empty (e.g. `> ;tail` — whitespace right after the operator).
 * Linear-time.
 */
function redirectTargetLength(s: string, start: number): number {
  let end = start;
  let inSingle = false;
  let inDouble = false;
  while (end < s.length) {
    const ch = s[end];
    if (ch === '\\' && !inSingle && isRedirectEscape(s, end, inDouble)) {
      end += 2;
    } else {
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble && isTokenTerminator(ch)) {
        break;
      }
      end++;
    }
  }
  return end - start;
}

function isRedirectEscape(
  s: string,
  index: number,
  inDouble: boolean,
): boolean {
  const next = s[index + 1];
  return !inDouble || ['$', '`', '"', '\\', NEWLINE].includes(next);
}

/** True if `ch` terminates a redirect target token (whitespace or separator). */
function isTokenTerminator(ch: string): boolean {
  return isWhitespaceChar(ch) || isSeparatorChar(ch);
}

/** Carriage return character. */
const CARRIAGE_RETURN = String.fromCharCode(13);

/** True if `ch` is a whitespace char (space, tab, carriage-return, newline). */
const isWhitespaceChar = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === CARRIAGE_RETURN || ch === NEWLINE;
/** True iff `ch` is one of the command separators `; & |` or a newline. */
function isSeparatorChar(ch: string | undefined): boolean {
  if (ch === undefined) {
    return false;
  }
  return ch === ';' || ch === '&' || ch === '|' || ch === NEWLINE;
}

/**
 * Given the `(` index of a `(){` sequence in `collapsed`, walks backward to
 * collect the maximal trailing name-identifier run as the function NAME (the
 * walk stops at the first non-name-identifier char, so the character before
 * `nameStart` is necessarily a non-name boundary or string start by
 * construction — no separate boundary check is needed), then reads the body via
 * `findMatchingBraceEnd` and returns the definition. Returns null when the name
 * is empty, the first name char is a digit, or the braces are unbalanced/not
 * followed by a valid command separator.
 */
function parsePosixAt(
  collapsed: string,
  parenIndex: number,
  original: string,
): FunctionDefinition | null {
  let nameStart = parenIndex;
  while (nameStart > 0 && isNameChar(collapsed[nameStart - 1])) {
    nameStart--;
  }
  if (nameStart === parenIndex) {
    return null;
  }
  const name = collapsed.slice(nameStart, parenIndex);
  if (!/^[A-Za-z_:]/.test(name)) {
    return null;
  }
  const openBrace = parenIndex + 2;
  const bodyEnd = findMatchingBraceEnd(collapsed, openBrace);
  if (bodyEnd < 0) {
    return null;
  }
  const origBraceEnd = collapsedToOriginalOffset(original, bodyEnd);
  return {
    name,
    body: collapsed.slice(openBrace + 1, bodyEnd),
    originalTail: extractInvocationFromOriginal(original, origBraceEnd),
    bodyEnd,
  };
}

/**
 * Scans `collapsed` for `function NAME {BODY};TAIL` or hybrid
 * `function NAME() {BODY};TAIL` keyword definitions at any position preceded by
 * a non-name boundary (or string start), skipping occurrences inside quotes.
 * After a successfully parsed definition the scanner jumps past the closing `}`
 * so the parsed body is not re-scanned (avoids pathological O(n²) on nested
 * input). The jump is safe for the same reason as in `scanPosixDefinitions`: a
 * definition is parsed only from the unquoted branch and `findMatchingBraceEnd`
 * returns at depth 0 outside quotes, preserving quote parity. Linear-time.
 */
function scanKeywordDefinitions(
  collapsed: string,
  original: string,
): readonly FunctionDefinition[] {
  const defs: FunctionDefinition[] = [];
  const keyword = 'function';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < collapsed.length) {
    const ch = collapsed[i];
    if (isEscapedChar(collapsed, i, inSingle)) {
      i += 2;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
    } else if (
      isUnquoted(collapsed, i, inSingle, inDouble, isFunctionKeyword) &&
      !isNameChar(i > 0 ? collapsed[i - 1] : undefined) &&
      hasKeywordBoundaryAfter(original, i + keyword.length)
    ) {
      const nameStart = i + keyword.length;
      const def = parseKeywordAt(collapsed, nameStart, original);
      if (def !== null) {
        defs.push(def);
        // Advance past the definition's closing brace so the parsed body is
        // not re-scanned. Uses the bodyEnd the parser already computed.
        i = def.bodyEnd + 1;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return defs;
}

/**
 * Given the index immediately after the `function` keyword, collects the
 * maximal name-identifier run as the NAME, tolerates an optional `()` hybrid
 * pair, then reads the body via `findMatchingBraceEnd` and returns the
 * definition. Returns null when the name is empty, the first name char is a
 * digit, the brace is absent, or the braces are unbalanced.
 */
function parseKeywordAt(
  collapsed: string,
  nameStart: number,
  original: string,
): FunctionDefinition | null {
  let nameEnd = nameStart;
  while (nameEnd < collapsed.length && isNameChar(collapsed[nameEnd])) {
    nameEnd++;
  }
  if (nameEnd === nameStart) {
    return null;
  }
  const name = collapsed.slice(nameStart, nameEnd);
  if (!/^[A-Za-z_:]/.test(name)) {
    return null;
  }
  let braceOpen = nameEnd;
  if (collapsed[braceOpen] === '(' && collapsed[braceOpen + 1] === ')') {
    braceOpen += 2;
  }
  if (collapsed[braceOpen] !== '{') {
    return null;
  }
  const bodyEnd = findMatchingBraceEnd(collapsed, braceOpen);
  if (bodyEnd < 0) {
    return null;
  }
  const origBraceEnd = collapsedToOriginalOffset(original, bodyEnd);
  return {
    name,
    body: collapsed.slice(braceOpen + 1, bodyEnd),
    originalTail: extractInvocationFromOriginal(original, origBraceEnd),
    bodyEnd,
  };
}

/**
 * Scans from an opening `{` at `openBraceIndex`, tracking `{`/`}` nesting
 * depth (only OUTSIDE quotes), and returns the index of the `}` that returns
 * to depth 0 IF it is immediately followed by a command separator (`;`, `&`,
 * `|`, newline) OR end-of-string. Single and double quote state is tracked so a
 * brace inside quotes does not affect nesting. A definition terminated by
 * end-of-string (no trailing invocation) is accepted here but later rejected by
 * `isBombDefinition` because the empty tail cannot start with the name.
 * Returns -1 when the braces are unbalanced or the closing `}` is followed by
 * any other character (e.g. a quoted `}` or a merged token). Linear-time.
 */
function findMatchingBraceEnd(s: string, openBraceIndex: number): number {
  const state: BraceScanState = { depth: 0, inSingle: false, inDouble: false };
  let i = openBraceIndex;
  while (i < s.length) {
    // Command substitutions (`$( … )` and backticks) are active outside single
    // quotes. Skipping the whole span keeps braces INSIDE a substitution — even
    // unquoted ones like `$(printf })` — from affecting the function-body depth.
    const span = state.inSingle ? 0 : substitutionSpanLength(s, i);
    if (isEscapedChar(s, i, state.inSingle)) {
      i += 2;
    } else if (span > 0) {
      i += span;
    } else {
      const closedAtDepthZero = advanceBraceScan(s[i], state);
      if (closedAtDepthZero) {
        return isDefinitionTerminator(s, i + 1) ? i : -1;
      }
      i++;
    }
  }
  return -1;
}

/** Mutable quote/brace-depth state threaded through the brace scanner. */
interface BraceScanState {
  depth: number;
  inSingle: boolean;
  inDouble: boolean;
}

/**
 * Applies a single character `ch` to the brace-scan `state`: toggles single/
 * double quote parity and tracks `{`/`}` nesting depth, all OUTSIDE quotes.
 * Returns true iff `ch` is the `}` that returns depth to 0 (the function-body
 * close), so the caller can validate the following terminator. A brace inside
 * the opposite quote context is ignored. Mirrors the mutable-state scanner
 * pattern used by `splitCommands` in shell-utils.
 */
function advanceBraceScan(ch: string, state: BraceScanState): boolean {
  if (ch === "'" && !state.inDouble) {
    state.inSingle = !state.inSingle;
  } else if (ch === '"' && !state.inSingle) {
    state.inDouble = !state.inDouble;
  } else if (!state.inSingle && !state.inDouble && ch === '{') {
    state.depth++;
  } else if (!state.inSingle && !state.inDouble && ch === '}') {
    state.depth--;
    return state.depth === 0;
  }
  return false;
}

/**
 * If a command substitution begins at `s[i]` — either `$( … )` or a
 * backtick-delimited `` ` … ` `` span — returns the character length of the
 * whole span (including both delimiters). Returns 0 when `s[i]` does not open a
 * substitution or the span is unterminated. Callers use this to treat a
 * substitution as an opaque unit so shell metacharacters inside it (braces,
 * separators) are ignored. Linear-time.
 */
function substitutionSpanLength(s: string, i: number): number {
  if (s[i] === '$' && s[i + 1] === '(') {
    return dollarParenSpanLength(s, i);
  }
  if (s[i] === BACKTICK) {
    return backtickSpanLength(s, i);
  }
  return 0;
}

/**
 * Length of a `$( … )` substitution starting at the `$` in `s[start]`, tracking
 * nested parentheses and inner quotes so a `)` inside a quoted string does not
 * close the span prematurely. Returns 0 if the closing `)` is never found.
 * Linear-time.
 */
function dollarParenSpanLength(s: string, start: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let j = start + 1; j < s.length; j++) {
    if (isEscapedChar(s, j, inSingle)) {
      j++;
    } else if (s[j] === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (s[j] === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && s[j] === '(') {
      depth++;
    } else if (!inSingle && !inDouble && s[j] === ')') {
      depth--;
      if (depth === 0) {
        return j - start + 1;
      }
    }
  }
  return 0;
}

/**
 * Length of a backtick substitution `` ` … ` `` starting at `s[start]`. A
 * backslash escapes the following character (so `` ` `` does not close the
 * span). Returns 0 if the closing backtick is never found. Linear-time.
 */
function backtickSpanLength(s: string, start: number): number {
  for (let j = start + 1; j < s.length; j++) {
    if (isEscapedChar(s, j, false)) {
      j++;
    } else if (s[j] === BACKTICK) {
      return j - start + 1;
    }
  }
  return 0;
}

/**
 * True iff `s[i+1]` (the char immediately after a depth-0 `}`) is a valid
 * terminator for a function definition. Accepts: (a) a command separator
 * (`;`, `&`, `|`, newline); (b) end-of-string; (c) a redirect operator
 * (`>`/`<`) — POSIX allows redirections immediately after `}` before the
 * separator (e.g. `:(){ :|:& }>/dev/null;:`); (d) an fd-redirect — one or
 * more digits immediately followed by `>`/`<` (e.g. `}2>&1`); or (e) `&>`/
 * `&>>` (redirect stdout+stderr). A bare digit NOT followed by `>`/`<` after
 * `}` is a bash syntax error and is rejected (returns false), so
 * `:(){ :|:& }5;:` stays non-matching. Linear-time (peeks ahead a bounded
 * number of chars).
 */
function isDefinitionTerminator(s: string, afterBrace: number): boolean {
  if (afterBrace >= s.length) {
    return true;
  }
  const ch = s[afterBrace];
  if (ch === ';' || ch === '&' || ch === '|' || ch === NEWLINE) {
    return true;
  }
  if (ch === '>' || ch === '<') {
    return true;
  }
  if (ch === '&' && s[afterBrace + 1] === '>') {
    return true;
  }
  return isFdRedirectPrefix(s, afterBrace);
}

/**
 * True iff `s[start]` begins a run of one-or-more digits immediately followed
 * by a redirect operator (`>`/`<`), e.g. `2>`, `10<`. A bare digit run with no
 * trailing redirect is NOT an fd-redirect (it is a syntax error after `}`).
 * Linear-time (scans a digit run, then peeks one char).
 */
function isFdRedirectPrefix(s: string, start: number): boolean {
  if (!isDigit(s[start])) {
    return false;
  }
  let j = start;
  while (j < s.length && isDigit(s[j])) {
    j++;
  }
  return j < s.length && (s[j] === '>' || s[j] === '<');
}

/** True for ASCII digit characters `0`-`9`. */
const isDigit = (ch: string | undefined): boolean =>
  ch !== undefined && ch >= '0' && ch <= '9';
