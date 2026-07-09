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

/** Characters allowed in a function-name identifier token (includes `:`). */
const NAME_BOUNDARY = '[^A-Za-z0-9_:]';

/** The newline character, preserved through whitespace collapse as a separator. */
const NEWLINE = String.fromCharCode(10);

/** The backslash character (escape operator outside single quotes). */
const BACKSLASH = String.fromCharCode(92);

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
  readonly tail: string;
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
  const posixDefs = scanPosixDefinitions(collapsed);
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
  return tailStartsWithNameToken(def.tail, def.name);
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
      const def = parsePosixAt(collapsed, i);
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
      const nlStart = origIdx;
      while (origIdx < original.length && original[origIdx] === NEWLINE) {
        origIdx++;
      }
      if (origIdx > nlStart) {
        collIdx++;
      }
    } else if (isNonNewlineSpace(ch)) {
      origIdx++;
    } else {
      origIdx++;
      collIdx++;
    }
  }
  return origIdx;
}

/** True iff `ch` is a non-newline whitespace character. */
const isNonNewlineSpace = (ch: string): boolean =>
  ch !== NEWLINE && /\s/.test(ch);

/**
 * Checks whether the original text has a name boundary (whitespace or `(`)
 * at the position corresponding to `collapsedOffset` — i.e. the character
 * immediately following the `function` keyword in the original. Bash requires
 * `function` to be followed by whitespace (or `(` for the hybrid form) to be
 * a keyword; `functionfoo` is a single token, not `function foo`.
 */
function hasKeywordBoundaryAfter(
  original: string,
  collapsedOffset: number,
): boolean {
  const origIdx = collapsedToOriginalOffset(original, collapsedOffset);
  if (origIdx >= original.length) {
    return true;
  }
  const ch = original[origIdx];
  return /\s/.test(ch) || ch === '(';
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
 * Given the index of a closing `}`, returns the tail AFTER the `}` and the full
 * run of command-separator characters (`;`, `&`, `|`, newline) that follow it.
 * This handles `};tail`, `};;tail`, `}&&tail`, `}||tail`, `}&tail`, and
 * `}
tail`. The separator run is strictly AFTER the depth-0 `}`, so a bomb
 * body ending in `&` (e.g. `:|:&`) before the `}` is unaffected.
 */
function sliceTailAfterBrace(collapsed: string, bodyEnd: number): string {
  let tailStart = bodyEnd + 1;
  while (isSeparatorChar(collapsed[tailStart])) {
    tailStart++;
  }
  return collapsed.slice(tailStart);
}

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
  return {
    name,
    body: collapsed.slice(openBrace + 1, bodyEnd),
    tail: sliceTailAfterBrace(collapsed, bodyEnd),
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
      const def = parseKeywordAt(collapsed, nameStart);
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
  return {
    name,
    body: collapsed.slice(braceOpen + 1, bodyEnd),
    tail: sliceTailAfterBrace(collapsed, bodyEnd),
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
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = openBraceIndex; i < s.length; i++) {
    const ch = s[i];
    if (isEscapedChar(s, i, inSingle)) {
      i++;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && ch === '{') {
      depth++;
    } else if (!inSingle && !inDouble && ch === '}') {
      depth--;
      if (depth === 0) {
        return isDefinitionTerminator(s[i + 1]) ? i : -1;
      }
    }
  }
  return -1;
}

/**
 * True iff `ch` is a valid command separator that may terminate a function
 * definition: `;`, `&`, `|`, newline, or end-of-string (undefined). This
 * covers `};tail`, `}&&tail`, `}||tail`, `}&tail`, a newline-terminated
 * definition, and the definition-at-end-of-string case. A real bomb body like
 * `:|:&` ends with `&` INSIDE the braces (before the `}`), so this check on the
 * char AFTER the depth-0 `}` is unaffected by body content.
 */
function isDefinitionTerminator(ch: string | undefined): boolean {
  if (ch === undefined) {
    return true;
  }
  return ch === ';' || ch === '&' || ch === '|' || ch === NEWLINE;
}
