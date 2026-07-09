/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** True for ASCII whitespace characters (space, tab, newline, etc.). */
const isWhitespaceChar = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/** True for ASCII digit characters. */
const isDigitChar = (ch: string): boolean => ch >= '0' && ch <= '9';

/**
 * Removes a single surrounding pair of quotes from a token, if present.
 * When stripping DOUBLE quotes, also unescapes `\"` → `"` so that escaped
 * quotes inside the original double-quoted string are exposed for re-evaluation.
 */
function stripOneQuoteLayer(token: string): string {
  if (token.length < 2) {
    return token;
  }
  const first = token[0];
  const last = token[token.length - 1];
  const isSingleQuoted = first === "'" && last === "'";
  const isDoubleQuoted = first === '"' && last === '"';
  if (isSingleQuoted) {
    return token.slice(1, -1);
  }
  if (isDoubleQuoted) {
    return unescapeDoubleQuoteInterior(token.slice(1, -1));
  }
  return token;
}

/** Converts `\"` to `"` within a string that was inside double quotes. */
function unescapeDoubleQuoteInterior(inner: string): string {
  let result = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length && inner[i + 1] === '"') {
      result += '"';
      i++;
    } else {
      result += inner[i];
    }
  }
  return result;
}

/** Describes a detected redirection operator's end index. */
interface RedirectOp {
  readonly end: number;
}

/**
 * Returns a RedirectOp describing a redirection operator starting at `i` when
 * the character at `i` begins a bare `>`, `>>`, `>&FILE`, `&>`, `&>>`, or
 * digit-prefixed `N>` / `N>&M` form (all outside quotes). Returns null
 * otherwise. The returned `end` is the index where target extraction begins,
 * so for `>&FILE` it skips both `>` and `&` to land on the filename, and for
 * `N>&M` it skips past `&` and the duplicated fd digits so they are not parsed
 * as a target.
 */
function redirectOpAt(
  rawSegment: string,
  i: number,
  ch: string,
  next: string,
): RedirectOp | null {
  if (ch === '>') {
    if (next === '>') {
      return { end: i + 2 };
    }
    if (next === '&' && !isDigitChar(rawSegment[i + 2] ?? '')) {
      return { end: i + 2 };
    }
    return { end: i + 1 };
  }
  if ((ch === '&' || isDigitChar(ch)) && next === '>') {
    const afterGt = rawSegment[i + 2];
    if (afterGt === '>') {
      return { end: i + 3 };
    }
    if (afterGt === '&' && isDigitChar(rawSegment[i + 3] ?? '')) {
      let j = i + 3;
      while (j < rawSegment.length && isDigitChar(rawSegment[j])) {
        j++;
      }
      return { end: j };
    }
    return { end: i + 2 };
  }
  return null;
}

/** Extracts the redirect target path using ASCII-only whitespace. */
const extractRedirectTarget = (after: string): string => {
  let start = 0;
  while (start < after.length && isWhitespaceChar(after[start])) start++;
  let end = start;
  while (end < after.length && !isWhitespaceChar(after[end])) end++;
  return stripOneQuoteLayer(after.slice(start, end));
};

/** Extracts and records a redirect target if non-empty. */
const addTargetIfPresent = (targets: string[], after: string): void => {
  const target = extractRedirectTarget(after);
  if (target.length > 0) targets.push(target);
};

/**
 * Extracts the target path of every UNQUOTED redirection operator in the raw
 * segment using a linear quote-aware scanner. Supports separated (`> target`),
 * attached (`>target`), fd-prefixed (`2>target`, `1>>target`), and `&>target`
 * forms. Backslash escapes are honored outside single quotes.
 */
export function findCredentialRedirectTargets(
  rawSegment: string,
): readonly string[] {
  const targets: string[] = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < rawSegment.length) {
    const ch = rawSegment[i];
    const next = rawSegment[i + 1];
    if (ch === '\\' && i < rawSegment.length - 1 && !inSingle) {
      i += 2;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i++;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i++;
    } else {
      const op =
        !inSingle && !inDouble ? redirectOpAt(rawSegment, i, ch, next) : null;
      if (op !== null) {
        addTargetIfPresent(targets, rawSegment.slice(op.end));
        i = op.end;
      } else {
        i++;
      }
    }
  }
  return targets;
}

/** Re-exports `stripOneQuoteLayer` for callers (interpreter script unwrap). */
export { stripOneQuoteLayer, isWhitespaceChar };

/** Credential SSH directory prefixes (any file under these is sensitive). */
const CREDENTIAL_SSH_PREFIXES: readonly string[] = [
  '~/.ssh/',
  '$HOME/.ssh/',
  '${HOME}/.ssh/',
];

const CREDENTIAL_AWS_PATHS: readonly string[] = [
  '~/.aws/credentials',
  '$HOME/.aws/credentials',
  '${HOME}/.aws/credentials',
  '~/.aws/config',
  '$HOME/.aws/config',
  '${HOME}/.aws/config',
];

/**
 * Conservative curated subset of well-known SECRET-bearing `~/.config` paths.
 * A blanket `~/.config` match would over-deny benign app config, so only
 * paths that hold OAuth tokens / credential stores are listed.
 */
const CREDENTIAL_CONFIG_PATHS: readonly string[] = [
  '~/.config/gh/hosts.yml',
  '$HOME/.config/gh/hosts.yml',
  '${HOME}/.config/gh/hosts.yml',
  '~/.config/git/credentials',
  '$HOME/.config/git/credentials',
  '${HOME}/.config/git/credentials',
  '~/.config/gcloud/credentials.db',
  '$HOME/.config/gcloud/credentials.db',
  '${HOME}/.config/gcloud/credentials.db',
  '~/.config/gcloud/application_default_credentials.json',
  '$HOME/.config/gcloud/application_default_credentials.json',
  '${HOME}/.config/gcloud/application_default_credentials.json',
];

/** True if `token` equals `base` or is a sibling/backup (`base/...` or `base.<ext>`). */
const matchesExactOrSibling = (token: string, base: string): boolean =>
  token === base ||
  token.startsWith(`${base}/`) ||
  token.startsWith(`${base}.`);

/**
 * Returns true if a path token targets a known credential location: SSH keys
 * (any file under `~/.ssh/`), AWS credentials/config (plus backup siblings),
 * or a conservative curated subset of secret-bearing `~/.config` paths. Only
 * exact paths and their `/`- or `.`-suffixed siblings match, so benign config
 * like `~/.config/gh/config.yml` or `~/.config/nvim/init.vim` stays benign.
 */
export function isCredentialPath(token: string): boolean {
  if (CREDENTIAL_SSH_PREFIXES.some((prefix) => token.startsWith(prefix))) {
    return true;
  }
  return (
    CREDENTIAL_AWS_PATHS.some((base) => matchesExactOrSibling(token, base)) ||
    CREDENTIAL_CONFIG_PATHS.some((base) => matchesExactOrSibling(token, base))
  );
}
