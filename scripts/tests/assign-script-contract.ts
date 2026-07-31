/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Diagnostic-message contract between the assign automation bash scripts and
 * the harness diagnosability tests.
 *
 * WHY THIS FILE EXISTS (#2688 / #2698 item 3):
 * The bash scripts (.github/scripts/assign-issue.sh and
 * unassign-stale-issues.sh) print human-readable root-cause diagnostics to
 * stderr. The whole point of #2688 was that those messages were being
 * discarded by the harness, turning every environment-specific breakage into
 * a log-archaeology exercise. The diagnosability tests in
 * assign-harness-diagnostics.test.ts now PIN these exact messages: that
 * pinning IS the contract — it guarantees a failure explains itself rather
 * than producing only a bare "expected 1 to be +0" assertion.
 *
 * This coupling is INTENTIONAL, not incidental. The strings below mirror the
 * `echo … >&2` / `printf … >&2` statements in the scripts. If a script
 * message changes, the corresponding assertion breaks — by design — so the
 * regression is caught instead of silently losing diagnostics again.
 *
 * The bash scripts cannot import this TypeScript module (and that is fine);
 * these constants are the single named source of truth for what the harness
 * expects. Each constant records the script and approximate line that emits
 * it, so both sides can be kept in sync.
 *
 * REGEX INVARIANT: these constants are used as `new RegExp(CONST, 'i')`
 * patterns by the diagnostics tests. Their values MUST NOT contain regex
 * metacharacters (`.`, `(`, `+`, `*`, `[`, …) — they are literal substrings
 * of the scripts' stderr output. Dynamic parts (attempt ordinal, issue
 * number) are intentionally kept OUT of the constants and supplied by the
 * tests; if a constant ever needs a literal metacharacter, escape it at the
 * consumer site instead.
 */

/**
 * Emitted by unassign-stale-issues.sh `discover_candidates` (~line 239) and
 * the top-level discovery fallback (~line 771) when the candidate issue
 * search fails. Exact literal — no dynamic part.
 */
export const CANDIDATE_DISCOVERY_FAILED = 'Candidate discovery failed';

/**
 * Static anchor emitted by unassign-stale-issues.sh retry helpers `retry_gh`
 * (~line 56) and `retry_gh_capture` (~line 106) on each failed attempt. The
 * full message is `Attempt ${attempt} failed, retrying: …` where
 * `${attempt}` is the 1-based ordinal. The harness pins the static text that
 * surrounds the dynamic ordinal.
 */
export const RETRY_FAILED_SUFFIX = 'failed, retrying';

/**
 * Static prefix emitted by assign-issue.sh (~line 771) when the initial
 * issue-state read fails. The full message is
 * `Failed to read issue state for #${ISSUE}` where `${ISSUE}` is the issue
 * number. The harness pins the static text that precedes the dynamic number.
 */
export const READ_ISSUE_STATE_PREFIX = 'Failed to read issue state for #';
