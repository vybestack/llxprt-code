/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isForkBomb } from './destructive-forkbomb.js';
import {
  findCredentialRedirectTargets,
  isCredentialPath,
  isWhitespaceChar,
  stripOneQuoteLayer,
} from './destructive-credentials.js';

/**
 * Sensitive filesystem roots that, when targeted by a recursive deletion or a
 * recursive world-writable chmod, indicate an irreversible destructive action.
 */
const SENSITIVE_ROOTS: ReadonlySet<string> = new Set([
  '/',
  '/usr',
  '/etc',
  '/home',
  '/var',
  '/opt',
  '/root',
  '/boot',
]);

/**
 * Command wrappers that prepend another binary before the real command.
 * When present at the start of a segment they are peeled so the effective
 * command name (and its arguments) are inspected.
 */
const WRAPPERS: ReadonlySet<string> = new Set([
  'sudo',
  'doas',
  'nohup',
  'nice',
  'env',
  'time',
  'timeout',
  'stdbuf',
  'command',
  'exec',
  'xargs',
]);

/** Shell interpreters whose `-c` argument is executed as a command string. */
const INTERPRETERS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
]);

/** Matches a short-flag cluster of only letters, e.g. `-rf`, `-fr`, `-R` (linear, no backtracking). */
const SHORT_FLAG_CLUSTER = /^-[a-zA-Z]+$/;

/** Matches a short-flag cluster of only letters containing `R` for chmod (linear). */
function hasShortFlag(token: string, letter: string): boolean {
  return SHORT_FLAG_CLUSTER.test(token) && token.includes(letter);
}

/** Matches mkfs and its filesystem-type variants, e.g. `mkfs`, `mkfs.ext4`. */
const MKFS_PATTERN = /^mkfs(\.[a-z0-9_-]+)?$/i;

/** Matches `of=/dev/...` for dd. */
const DD_DEVICE_TARGET = /^of=\/dev\//i;

/** Safe pseudo-devices under /dev that are not destructive when written to. */
const SAFE_PSEUDO_DEVICES: ReadonlySet<string> = new Set([
  '/dev/null',
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/tty',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/stdin',
  '/dev/full',
  '/dev/console',
]);

/** Matches a complete symbolic chmod mode token like `+x`, `u+rw`, `ug+rwxs` (anchored so filenames after `--` like `+s_file` do not match). */
const CHMOD_SYMBOLIC_MODE = /^[ugoa]*\+[rwxXst]*$/;

/** True if a token is a symbolic chmod mode that sets the setuid/setgid bit `s`. */
function isSetuidSymbolic(token: string): boolean {
  return CHMOD_SYMBOLIC_MODE.test(token) && token.includes('s');
}

/** Matches octal world-writable-with-special-bit modes: 2777, 3777, 4777, 5777, 6777, 7777 (with arbitrary leading-zero padding). */
const CHMOD_OCTAL_SPECIAL = /^0*[2-7]777$/;

interface CanonicalSegment {
  readonly name: string;
  readonly argTokens: readonly string[];
}

/**
 * Returns true if the raw shell command string contains a canonical destructive
 * pattern that must be hard-denied regardless of approval mode or allowlist.
 * Self-contained: performs its own canonicalization so it is not bypassable by
 * quote-removal, `$IFS` splitting, or command substitution.
 *
 * Known residuals (out of scope): a command name computed via substitution
 * output (e.g. `$(echo rm) -rf /`) cannot be statically resolved; base64
 * piped to an interpreter (e.g. `echo <b64> | base64 -d | sh`) is not
 * decoded-and-reparsed here (Class D — handled by the Layer-1 pipe-destination
 * guard in production); interpreter input read from stdin (beyond the `-c`
 * flag) is not evaluated.
 */
export function isDestructiveCommand(command: string): boolean {
  return isDestructiveCommandDepth(command, 0);
}

/** Maximum recursion depth for interpreter `-c` script re-evaluation. */
const MAX_INTERPRETER_DEPTH = 3;

/** Depth-aware core so interpreter `-c` scripts can be re-evaluated safely. */
function isDestructiveCommandDepth(command: string, depth: number): boolean {
  if (!command || command.trim().length === 0) {
    return false;
  }

  if (isForkBomb(command)) {
    return true;
  }

  const segments = buildCandidateSegments(command);
  return segments.some((segment) => {
    const canonical = canonicalizeSegment(segment);
    return (
      matchesDestructiveWithCanonical(canonical) ||
      matchesCredentialWriteWithCanonical(segment, canonical) ||
      matchesInterpreterC(segment, depth, canonical) ||
      matchesEnvSplitString(segment, depth)
    );
  });
}

/**
 * Builds the full list of candidate command segments to inspect:
 *  1. split on shell operators (`&&`, `||`, `;`, `|`, `&`, newlines);
 *  2. plus inner commands extracted from command substitutions.
 */
function buildCandidateSegments(command: string): readonly string[] {
  const fromOperators = splitOnOperators(command);
  const fromSubstitutions = extractSubstitutions(command);
  return [...fromOperators, ...fromSubstitutions];
}

/**
 * Splits a command on ALL shell separators (`;`, `&&`, `||`, `|`, standalone
 * `&`, newlines), respecting single and double quotes. Self-contained (does
 * NOT use the shared `splitCommands` helper, whose backslash handling inside
 * single quotes would mis-track quote state for substitution inner text that
 * contains a trailing single-quoted backslash). Backslash escapes are honored
 * only outside single quotes (POSIX).
 */
function splitOnOperators(command: string): readonly string[] {
  return splitOnUnquotedSeparators(command)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/**
 * Splits on unquoted shell separators (`;`, `&&`, `||`, `|`, standalone `&`,
 * newlines), respecting single and double quotes. A `&` only splits as a
 * standalone background operator (not `&&`, not part of `>&`/`&>`). Backslash
 * escapes are honored outside single quotes only (POSIX: backslash is literal
 * inside single quotes).
 */
function splitOnUnquotedSeparators(segment: string): readonly string[] {
  const pieces: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    const next = segment[i + 1];
    if (ch === '\\' && i < segment.length - 1 && !inSingle) {
      current += ch + segment[i + 1];
      i += 2;
    } else if (ch === "'" && !inDouble) {
      current += ch;
      inSingle = !inSingle;
      i++;
    } else if (ch === '"' && !inSingle) {
      current += ch;
      inDouble = !inDouble;
      i++;
    } else {
      const sepLen = separatorLength(current, ch, next, inSingle, inDouble);
      if (sepLen > 0) {
        pieces.push(current);
        current = '';
        i += sepLen;
      } else {
        current += ch;
        i++;
      }
    }
  }
  pieces.push(current);
  return pieces;
}

/** Returns the char-count of the unquoted shell separator at `ch`, or 0 if none. */
function separatorLength(
  current: string,
  ch: string,
  next: string,
  inSingle: boolean,
  inDouble: boolean,
): number {
  if (inSingle || inDouble) return 0;
  if (ch === '\n' || ch === ';') return 1;
  if (ch === '|') return next === '|' ? 2 : 1;
  if (ch === '&') {
    if (next === '&') return 2;
    return isBackgroundSep(current, next) ? 1 : 0;
  }
  return 0;
}

/** True when a standalone `&` is a background separator (not `&&`, not `>&`/`&>`). */
const isBackgroundSep = (current: string, next: string): boolean => {
  if (next === '&') return false;
  const prev = current.length > 0 ? current[current.length - 1] : '';
  return prev !== '>' && next !== '>';
};

/** Maximum nesting depth for substitution extraction. */
const MAX_SUBSTITUTION_DEPTH = 5;

/** Maximum total pieces extracted before bailing out (pathological input guard). */
const MAX_SUBSTITUTION_PIECES = 500;

/** A worklist entry pairing a text snippet with its nesting depth. */
interface WorklistEntry {
  readonly text: string;
  readonly depth: number;
}

/**
 * Extracts the inner commands of command/process substitutions:
 * `$( ... )`, backticks, `<( ... )`, `>( ... )`. Single-quoted regions are
 * treated as literal text (shell does not perform substitution inside single
 * quotes), so their contents are never extracted. Uses a bounded worklist
 * that repeatedly extracts nested substitutions until none are found or the
 * depth/piece cap is reached.
 */
function extractSubstitutions(command: string): readonly string[] {
  const results: string[] = [];
  const queue: WorklistEntry[] = [{ text: command, depth: 0 }];
  let head = 0;
  while (head < queue.length && results.length < MAX_SUBSTITUTION_PIECES) {
    const entry = queue[head++];
    if (entry.depth <= MAX_SUBSTITUTION_DEPTH) {
      enqueueSubstitutionPieces(entry, queue, results);
    }
  }
  return results.filter((s) => s.trim().length > 0);
}

/** Extracts substitution pieces from an entry, collecting results and enqueuing for deeper extraction. */
function enqueueSubstitutionPieces(
  entry: WorklistEntry,
  queue: WorklistEntry[],
  results: string[],
): void {
  for (const piece of extractAllSubstitutionTypes(entry.text)) {
    queue.push({ text: piece, depth: entry.depth + 1 });
    for (const subPiece of splitOnOperators(piece)) {
      if (results.length >= MAX_SUBSTITUTION_PIECES) return;
      results.push(subPiece);
    }
  }
}

/** Extracts all substitution types (dollar-paren, backtick, process-sub) from one text piece. */
function extractAllSubstitutionTypes(text: string): readonly string[] {
  return [
    ...extractDollarParen(text),
    ...extractBackticks(text),
    ...extractProcessSub(text, '<'),
    ...extractProcessSub(text, '>'),
  ];
}

/** Result of reading a balanced `(...)` span. */
interface BalancedParens {
  readonly inner: string;
  readonly end: number;
}

/** Extracts the content of balanced `$( ... )` substitutions, skipping single-quoted regions. */
function extractDollarParen(text: string): readonly string[] {
  return scanSubstitutions(text, (ch, i, inSingle) => {
    if (inSingle || ch !== '$' || text[i + 1] !== '(') {
      return null;
    }
    return readBalancedParens(text, i + 1);
  });
}

/** Extracts process-sub `<( ... )` / `>( ... )`; unlike $()/backticks, process substitution does NOT execute inside single OR double quotes. */
function extractProcessSub(text: string, opener: string): readonly string[] {
  return scanSubstitutions(text, (ch, i, inSingle, inDouble) => {
    if (inSingle || inDouble || ch !== opener || text[i + 1] !== '(') {
      return null;
    }
    return readBalancedParens(text, i + 1);
  });
}

/** Extracts the content of backtick `` `...` `` substitutions (one level), skipping single-quoted regions. */
function extractBackticks(text: string): readonly string[] {
  return scanSubstitutions(text, (ch, i, inSingle) => {
    if (inSingle || ch !== '`') {
      return null;
    }
    let end = i + 1;
    while (end < text.length) {
      if (text[end] === '\\' && end + 1 < text.length) {
        end += 2;
      } else if (text[end] === '`') {
        break;
      } else {
        end++;
      }
    }
    if (end >= text.length || end <= i + 1) {
      return null;
    }
    return { inner: text.slice(i + 1, end), end };
  });
}

/**
 * Quote-aware scanner that walks `text` tracking single/double quote state,
 * invoking `matcher` at each position outside single quotes. When the matcher
 * returns a span, its inner text is collected and the cursor advances past it.
 */
function scanSubstitutions(
  text: string,
  matcher: (
    ch: string,
    i: number,
    inSingle: boolean,
    inDouble: boolean,
  ) => BalancedParens | null,
): readonly string[] {
  const results: string[] = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i < text.length - 1 && !inSingle) {
      i += 2;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
    } else {
      const span = !inSingle ? matcher(ch, i, inSingle, inDouble) : null;
      if (span !== null) {
        results.push(span.inner);
        i = span.end + 1;
      } else {
        i++;
      }
    }
  }
  return results;
}

/**
 * Starting at the `(` at `start`, reads until the matching `)` respecting
 * nesting. Returns the inner text and the index of the closing `)`, or null
 * if unbalanced.
 */
function readBalancedParens(
  text: string,
  start: number,
): BalancedParens | null {
  if (text[start] !== '(') {
    return null;
  }
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i < text.length - 1 && !inSingle) {
      i++;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && ch === '(') {
      depth++;
    } else if (!inSingle && !inDouble && ch === ')') {
      depth--;
      if (depth === 0) {
        return { inner: text.slice(start + 1, i), end: i };
      }
    }
  }
  return null;
}

/**
 * Canonicalizes a raw command segment into a structured form for matching:
 * expands `$IFS`, removes backslash escapes and quotes, collapses whitespace,
 * and peels wrapper commands. The effective command name is the first token
 * after wrapper-peeling.
 */
function canonicalizeSegment(segment: string): CanonicalSegment {
  const collapsed = canonicalizeText(segment);
  const tokens = collapsed.length > 0 ? collapsed.split(' ') : [];
  const peeled = peelWrappers(tokens);
  const rawName = peeled.length > 0 ? peeled[0] : '';
  return {
    name: basenameOf(rawName),
    argTokens: peeled.slice(1),
  };
}

/** Returns the basename of a command token, stripping any path prefix. */
const basenameOf = (token: string): string => {
  const slash = token.lastIndexOf('/');
  return slash < 0 ? token : token.slice(slash + 1);
};

/**
 * Canonicalizes raw text: expands `${IFS}`/`$IFS` (but NOT `$IFS` followed by
 * a name char `[A-Za-z0-9_]` which binds as a longer variable per shell rules),
 * unwraps ANSI-C `$'...'` quoting into its literal contents concatenated to
 * adjacent characters, removes backslash escapes and quotes, and collapses
 * whitespace. ANSI-C unwrap runs BEFORE the generic quote/backslash passes so
 * that inner escapes (e.g. `$'\''`) are resolved here rather than corrupted.
 */
function canonicalizeText(segment: string): string {
  return unwrapAnsiCQuotes(
    segment.replace(/\$\{IFS\}/g, ' ').replace(/\$IFS(?![A-Za-z0-9_])/g, ' '),
  )
    .replace(/\\(.)/g, '$1')
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map of single-char ANSI-C escape sequences to their literal expansion. */
const ANSI_C_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['\\', '\\'],
  ["'", "'"],
  ['"', '"'],
]);

/**
 * Replaces every ANSI-C `$'...'` occurrence with its inner contents (escaping
 * resolved via {@link ANSI_C_ESCAPES}), concatenated to adjacent characters.
 * Linear-time hand-written scanner honoring backslash-escaped `\'` inside (so
 * `$'a\'b'` closes at the final quote, inner = `a'b`).
 */
function unwrapAnsiCQuotes(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '$' || text[i + 1] !== "'") {
      result += text[i];
      i++;
      continue;
    }
    i += 2;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        result += ANSI_C_ESCAPES.get(text[i + 1]) ?? text[i + 1];
        i += 2;
      } else if (ch === "'") {
        i++;
        break;
      } else {
        result += ch;
        i++;
      }
    }
  }
  return result;
}

/**
 * Peels leading wrapper commands (sudo, timeout, env, ...) plus their flags,
 * `NAME=value` assignments, and bare numeric arguments, capping at 5 iterations.
 * Operand-taking flags are resolved per-wrapper so e.g. sudo `-s` (run a shell,
 * no operand) is not confused with timeout `-s` (signal, consumes operand).
 */
function peelWrappers(tokens: readonly string[]): readonly string[] {
  let current = tokens;
  for (let iter = 0; iter < 5 && current.length > 0; iter++) {
    const name = basenameOf(current[0]);
    if (!WRAPPERS.has(name)) break;
    current = skipWrapperArgs(
      current.slice(1),
      WRAPPER_OPERAND_FLAGS[name] ?? EMPTY_FLAGS,
    );
  }
  return current;
}

const WRAPPER_OPERAND_FLAGS: Readonly<Record<string, readonly string[]>> = {
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  sudo: ['-u', '--user', '-g', '--group'],
  doas: ['-u', '--user', '-g', '--group'],
  // `env -u VAR`/`--unset VAR` and `-C DIR`/`--chdir DIR` consume the NEXT
  // token as an operand, so the wrapper peeler must skip both the flag and its
  // operand. `-S`/`--split-string` is intentionally NOT listed: its operand is
  // an embedded command string that is executed, so consuming it would hide
  // the payload (a new false negative). The self-contained `--flag=value` form
  // is handled by isWrapperSkipToken (any `-`-prefixed token is skipped whole).
  env: ['-u', '--unset', '-C', '--chdir'],
};
const EMPTY_FLAGS: readonly string[] = [];

function skipWrapperArgs(
  tokens: readonly string[],
  operandFlags: readonly string[],
): readonly string[] {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (operandFlags.includes(token) && i + 1 < tokens.length) {
      i += 2;
    } else if (isWrapperSkipToken(token)) {
      i++;
    } else {
      break;
    }
  }
  return tokens.slice(i);
}

const isWrapperSkipToken = (token: string): boolean =>
  token.startsWith('-') ||
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(token) ||
  /^[0-9]+$/.test(token);

/** Runs destructive matchers A-D on a pre-canonicalized segment. */
const matchesDestructiveWithCanonical = (
  canonical: CanonicalSegment,
): boolean =>
  isRmSensitiveRoot(canonical) ||
  isMkfs(canonical) ||
  isDdToDevice(canonical) ||
  isChmodDangerous(canonical);

/**
 * Partitions argument tokens around the first bare `--` option terminator.
 * Flags are only valid among tokens BEFORE `--`; all tokens AFTER `--` are
 * operands (filenames), even if they start with `-`. The `--` token itself
 * is neither flag nor operand.
 */
interface DashDashPartition {
  readonly flagZone: readonly string[];
  readonly operandZone: readonly string[];
}

/** Splits tokens at the first bare `--`, returning flag-zone and operand-zone. */
function partitionByDoubleDash(
  argTokens: readonly string[],
): DashDashPartition {
  const dashIndex = argTokens.indexOf('--');
  if (dashIndex < 0) {
    return { flagZone: argTokens, operandZone: [] };
  }
  return {
    flagZone: argTokens.slice(0, dashIndex),
    operandZone: argTokens.slice(dashIndex + 1),
  };
}

/** Pattern A: `rm -r`/`-R`/`--recursive` targeting a sensitive root or home dir. */
function isRmSensitiveRoot(segment: CanonicalSegment): boolean {
  if (segment.name !== 'rm') {
    return false;
  }
  const partition = partitionByDoubleDash(segment.argTokens);
  const recursive =
    partition.flagZone.includes('--recursive') ||
    partition.flagZone.some(
      (token) => hasShortFlag(token, 'r') || hasShortFlag(token, 'R'),
    );
  if (!recursive) {
    return false;
  }
  const isSensitive = (token: string): boolean =>
    isSensitiveRootGlob(token) || isHomeRootReference(token);
  return (
    partition.flagZone.some(
      (token) => !token.startsWith('-') && isSensitive(token),
    ) || partition.operandZone.some(isSensitive)
  );
}

/** True if a token normalizes to a sensitive root or the root glob. */
function isSensitiveRootGlob(token: string): boolean {
  const normalized = normalizeAbsolutePath(token);
  const stripped = stripTrailingSlashVariants(normalized);
  return (
    SENSITIVE_ROOTS.has(stripped) || normalized === '/*' || normalized === '/'
  );
}

/**
 * Performs conservative POSIX-style lexical normalization for ABSOLUTE paths
 * (starting with `/`). Collapses `//`→`/`, resolves `.` (drop) and `..` (pop
 * the previous segment, not past root). Relative paths are returned unchanged
 * so benign relative targets like `./build` are unaffected. `$HOME`/`~` are
 * NOT expanded here; home-prefixed paths are handled separately by
 * `isHomeRootReference` via `homePathEscapesToRoot`.
 */
function normalizeAbsolutePath(token: string): string {
  if (!token.startsWith('/')) return token;
  const resolved: string[] = [];
  for (const seg of token.split('/')) {
    if (!isNonRedundantSeg(seg)) continue;
    if (seg === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return '/' + resolved.join('/');
}

function stripTrailingSlashVariants(token: string): string {
  let result =
    token.endsWith('/*') || token.endsWith('/.') ? token.slice(0, -2) : token;
  // Collapse any number of trailing slashes to none (handles /etc//, ///, etc.).
  while (result.endsWith('/') && result.length > 1) {
    result = result.slice(0, -1);
  }
  if (result.length === 0 && token.includes('/')) {
    return '/';
  }
  return result;
}

/** True for a path segment that is neither empty nor `.`. */
const isNonRedundantSeg = (seg: string): boolean => seg !== '' && seg !== '.';

/**
 * True for a token that resolves to the home root or an ancestor of it: `~`,
 * `$HOME`, or `${HOME}` optionally followed by a subpath. The home root itself
 * (empty/`.` remainder) and the home-contents glob `*` match. Additionally, a
 * remainder whose net depth is <= 0 — i.e. it traverses up to (or above) the
 * home directory such as `~/..`, `~/../..`, or `~/foo/..` (== home) — also
 * matches because it resolves to a sensitive root (`/home`, `/Users`, or `/`).
 * `${HOME}` is tested before `$HOME` so a brace-enclosed prefix is never
 * partially consumed.
 */
function isHomeRootReference(token: string): boolean {
  const prefix = ['${HOME}', '$HOME', '~'].find((p) => token.startsWith(p));
  if (prefix === undefined) return false;
  // Word-boundary guard: `$HOME` must NOT be followed by a name char (so
  // `$HOMEDIR` does not match). `${HOME}` is safely `}`-terminated and `~` has
  // no variable-binding semantics, so only `$HOME` needs this check.
  if (prefix === '$HOME' && isHomeNameChar(token[prefix.length])) {
    return false;
  }
  const rest = token.slice(prefix.length).split('/').filter(isNonRedundantSeg);
  return (
    rest.length === 0 ||
    (rest.length === 1 && rest[0] === '*') ||
    homePathEscapesToRoot(rest)
  );
}

/** True for characters that extend a shell variable name `[A-Za-z0-9_]`. */
const isHomeNameChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/**
 * Walks the non-redundant segments of a home-path remainder computing net
 * depth: `.`/empty (already filtered) and `..` decrement; any other segment
 * increments. A net depth <= 0 means the path resolves to the home directory
 * itself or a parent/ancestor — all of which are sensitive roots (`/home`,
 * `/Users`, or `/`). Linear-time, no backtracking.
 */
function homePathEscapesToRoot(segments: readonly string[]): boolean {
  let depth = 0;
  for (const seg of segments) {
    depth += seg === '..' ? -1 : 1;
  }
  return depth <= 0;
}

/** Pattern B: any `mkfs` or `mkfs.<type>` command. */
const isMkfs = (segment: CanonicalSegment): boolean =>
  MKFS_PATTERN.test(segment.name);

/** Pattern C: `dd` writing to a device via `of=/dev/...` (excluding safe pseudo-devices). */
function isDdToDevice(segment: CanonicalSegment): boolean {
  if (segment.name !== 'dd') {
    return false;
  }
  return segment.argTokens.some((token) => {
    if (!DD_DEVICE_TARGET.test(token)) return false;
    const target = token.slice(token.indexOf('=') + 1);
    return !SAFE_PSEUDO_DEVICES.has(target) && !target.startsWith('/dev/fd/');
  });
}

/** Pattern D: dangerous chmod (setuid/setgid, special-bit world-writable, or recursive 777 on root). */
function isChmodDangerous(segment: CanonicalSegment): boolean {
  if (segment.name !== 'chmod') {
    return false;
  }
  const partition = partitionByDoubleDash(segment.argTokens);
  if (
    partition.flagZone.some(isSetuidSymbolic) ||
    partition.flagZone.some((token) => CHMOD_OCTAL_SPECIAL.test(token))
  ) {
    return true;
  }
  const recursive =
    partition.flagZone.includes('--recursive') ||
    partition.flagZone.some((token) => hasShortFlag(token, 'R'));
  if (!recursive) return false;
  const allOperands = [...partition.flagZone, ...partition.operandZone];
  return (
    allOperands.some((token) => /^0*777$/.test(token)) &&
    allOperands.some(isSensitiveRootGlob)
  );
}

/** Pattern E: best-effort detection of writes to credential paths (.ssh, .aws/credentials). */
function matchesCredentialWriteWithCanonical(
  rawSegment: string,
  canonical: CanonicalSegment,
): boolean {
  if (
    findCredentialRedirectTargets(rawSegment).some((target) =>
      isCredentialPath(canonicalizeText(target)),
    )
  ) {
    return true;
  }
  if (canonical.name === 'tee' || canonical.name === 'truncate') {
    return canonical.argTokens.some(isCredentialPath);
  }
  if (canonical.name === 'dd') {
    return canonical.argTokens.some(
      (token) => token.startsWith('of=') && isCredentialPath(token.slice(3)),
    );
  }
  return false;
}

/**
 * Pattern C3: detects an interpreter (`sh`/`bash`/`zsh`/`dash`/`ksh`) invoked
 * with `-c <script>`. The script string is executed by the interpreter, so it
 * is stripped of ONE quote layer and re-evaluated recursively (bounded by
 * MAX_INTERPRETER_DEPTH to avoid unbounded recursion).
 */
function matchesInterpreterC(
  rawSegment: string,
  depth: number,
  canonical: CanonicalSegment,
): boolean {
  if (depth >= MAX_INTERPRETER_DEPTH) {
    return false;
  }
  if (!INTERPRETERS.has(canonical.name)) {
    return false;
  }
  const scriptArg = extractScriptArgFromRaw(rawSegment);
  if (scriptArg === null) {
    return false;
  }
  return isDestructiveCommandDepth(scriptArg, depth + 1);
}

/**
 * Pattern C4: detects `env -S`/`--split-string` which embeds and executes a
 * command string. The embedded payload is extracted from the canonical tokens
 * and re-evaluated recursively (bounded by MAX_INTERPRETER_DEPTH). Handles
 * the separate-arg form (`-S CMD`), the `=`-attached form (`--split-string=CMD`),
 * and the clustered short form (`-SCMD`). Because canonicalization already
 * split quoted strings into separate tokens, the payload is reconstructed by
 * joining the flag's attached value (if any) with all remaining tokens.
 *
 * Wrapper-aware: `env` may sit behind leading wrapper commands (`sudo`,
 * `doas`, etc.) and their flags, so the `env` token is located after peeling
 * wrappers rather than requiring it at index 0.
 */
function matchesEnvSplitString(rawSegment: string, depth: number): boolean {
  if (depth >= MAX_INTERPRETER_DEPTH) {
    return false;
  }
  const tokens = canonicalizeText(rawSegment)
    .split(' ')
    .filter((t) => t.length > 0);
  const envIndex = findEnvTokenIndex(tokens);
  if (envIndex < 0) {
    return false;
  }
  for (let i = envIndex + 1; i < tokens.length; i++) {
    const payload = extractSplitStringPayload(tokens, i);
    if (payload !== null && isDestructiveCommandDepth(payload, depth + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the index of the first token whose basename is `env`, after peeling
 * leading wrapper commands (`sudo`, `doas`, `nohup`, etc.) and their flags /
 * `NAME=value` assignments / bare numerics — but STOPPING at `env` itself
 * (which is also a wrapper, so `peelWrappers` would consume it). Returns -1
 * when no `env` token is found behind a (possibly empty) wrapper prefix. This
 * makes split-string detection wrapper-aware so `sudo env --split-string=...`
 * is still inspected while a bare `sudo ls` (no env) returns -1.
 */
function findEnvTokenIndex(tokens: readonly string[]): number {
  let i = 0;
  for (let iter = 0; iter < 5 && i < tokens.length; iter++) {
    const name = basenameOf(tokens[i]);
    if (name === 'env') {
      return i;
    }
    if (!WRAPPERS.has(name)) {
      return -1;
    }
    const rest = skipWrapperArgs(
      tokens.slice(i + 1),
      WRAPPER_OPERAND_FLAGS[name] ?? EMPTY_FLAGS,
    );
    i = tokens.length - rest.length;
  }
  return -1;
}

/**
 * If `tokens[k]` is an `env` split-string flag, returns the reconstructed
 * command payload (the flag's attached value plus remaining tokens joined by
 * space). Returns null when `tokens[k]` is not a split-string flag.
 */
function extractSplitStringPayload(
  tokens: readonly string[],
  k: number,
): string | null {
  const token = tokens[k];
  let attachedValue: string | null = null;
  if (token === '-S' || token === '--split-string') {
    attachedValue = '';
  } else if (token.startsWith('--split-string=')) {
    attachedValue = token.slice('--split-string='.length);
  } else if (token.startsWith('-S') && token.length > 2) {
    attachedValue = token.slice(2);
  }
  if (attachedValue === null) {
    return null;
  }
  const remainder = tokens.slice(k + 1);
  const parts =
    attachedValue.length > 0 ? [attachedValue, ...remainder] : remainder;
  return parts.join(' ');
}

/**
 * Scans the raw segment for an interpreter `-c` flag (or a clustered short
 * option ending in `c` like `-lc`, `-ec`) and returns the script argument that
 * follows it (with ONE quote layer removed). Uses a quote-aware tokenizer so a
 * quoted script string like `"rm -rf /"` stays intact as one argument. In POSIX
 * shells, after a bare `--` token all further args are operands, so `-c` after
 * a bare `--` is NOT the execute flag (e.g. `bash -- -c "rm -rf /"` does NOT
 * execute the script). A `--` that appears INSIDE a quoted token (e.g. the
 * script string `"foo -- bar"`) is NOT a bare `--` because the tokenizer keeps
 * it as a single quoted token. Returns null when no `-c`/cluster exists before
 * `--`, or no following argument exists.
 */
function extractScriptArgFromRaw(segment: string): string | null {
  const tokens = tokenizeRespectingQuotes(segment);
  const limit = indexOfBareDoubleDash(tokens);
  const effectiveTokens = limit < 0 ? tokens : tokens.slice(0, limit);
  const cIndex = effectiveTokens.findIndex(
    (token) => token === '-c' || isClusteredCOption(token),
  );
  if (cIndex < 0 || cIndex + 1 >= effectiveTokens.length) {
    return null;
  }
  return unwrapScriptArg(effectiveTokens[cIndex + 1]);
}

/**
 * Returns the index of the first bare `--` token (exactly `--`, not inside
 * quotes) among the tokenized args, or -1 when none exists. A bare `--` is the
 * POSIX end-of-options terminator: all tokens after it are operands.
 */
function indexOfBareDoubleDash(tokens: readonly string[]): number {
  return tokens.indexOf('--');
}

/**
 * Removes ONE quoting layer from a script-argument token. ANSI-C `$'...'`
 * strings are unwrapped via {@link unwrapAnsiCQuotes} (resolving escapes like
 * backslash-n) so their inner contents are re-evaluated; all other quotes use
 * {@link stripOneQuoteLayer}.
 */
function unwrapScriptArg(token: string): string {
  if (token.length >= 3 && token.startsWith("$'") && token.endsWith("'")) {
    return unwrapAnsiCQuotes(token);
  }
  return stripOneQuoteLayer(token);
}

/** True for a single-dash short-option cluster ending in `c`, e.g. `-lc`, `-ec`. */
function isClusteredCOption(token: string): boolean {
  if (token.length < 3 || token[0] !== '-' || token[1] === '-') {
    return false;
  }
  if (token[token.length - 1] !== 'c') {
    return false;
  }
  for (let i = 1; i < token.length - 1; i++) {
    if (!isAlphaChar(token[i])) {
      return false;
    }
  }
  return true;
}

/** True for ASCII alphabetic characters. */
const isAlphaChar = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');

/**
 * Splits a segment into whitespace-delimited tokens while keeping quoted
 * substrings (single or double) as single tokens that retain their quotes.
 */
function tokenizeRespectingQuotes(segment: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '\\' && i < segment.length - 1 && !inSingle) {
      current += ch + segment[i + 1];
      i++;
    } else if (ch === "'" && !inDouble) {
      current += ch;
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      current += ch;
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && isWhitespaceChar(ch)) {
      if (current.length > 0) {
        tokens.push(current);
      }
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}
