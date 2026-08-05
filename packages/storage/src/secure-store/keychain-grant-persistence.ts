/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Heuristic detector for the discarded macOS Keychain "Always Allow" grant
 * (issue #3020).
 *
 * ## What the source chain establishes (and what it does not)
 *
 * Every LLxprt credential item on macOS is created through
 * `SecKeychainAddGenericPassword`, which takes no `SecAccess` parameter, so
 * the item's ACL is whatever macOS synthesizes by default. That default ACL
 * carries the required owner entry authorizing `change_acl` with an **empty**
 * trusted-application list. Per Apple's documentation an empty list means no
 * application is trusted to amend the ACL **without user confirmation**
 * (as distinct from a null list, which means any application may). The
 * fully-proven, load-bearing finding is that **no layer of the dependency
 * chain** (`@napi-rs/keyring` 1.3.0 → `keyring-core` →
 * `apple-native-keyring-store` 1.0.1 → `security-framework` 3.7.0) **exposes
 * any way to supply a different `SecAccess`**, so LLxprt cannot construct or
 * repair the ACL of these items from TypeScript.
 *
 * The exact securityd mechanism by which the observed "Always Allow" grant is
 * discarded is **NOT** established by this work. Confirming it would require a
 * native ACL inspection of the item immediately before and after a grant.
 * This module does not assert that mechanism; it observes a symptom.
 *
 * ## The signal, and why it is the only in-process observable
 *
 * The only in-process observable that distinguishes "authorized without
 * interaction" from "a human was made to authorize this read" is the duration
 * of a read that nonetheless **succeeded**: an interactive authorization
 * prompt blocks for well over a second, while a pre-authorized read returns in
 * milliseconds. The binding erases `OSStatus` (see issue #3011), `securityd`
 * handles any ACL amendment internally and returns the secret regardless of
 * whether the grant was stored, and the ACL is not readable through the
 * binding. A read that returns `null` or throws is never an authorization
 * event — absence and failure are not a granted authorization.
 *
 * ## This is a heuristic with a known false-positive envelope, not proof
 *
 * A single slow successful read is the normal first-time authorization and
 * proves nothing. A **second** slow successful read of the **same** credential
 * that **began after** the first completed is a symptom consistent with a
 * discarded grant — a pathologically slow but non-interactive keychain could
 * also produce it. What narrows the envelope: the detector is darwin-only,
 * requires the duration to be strictly greater than the threshold, correlates
 * by the same credential, only counts non-overlapping reads (the second must
 * have begun at or after the first completed), and requires two such events
 * rather than one.
 *
 * ## The consequence is bounded
 *
 * The predicate flips to a terminal broken state at most once per process and
 * emits a single stderr notice. Credential access is **never** blocked and no
 * data is changed: the read that triggered the notice still returns its value
 * to the caller.
 *
 * @plan PLAN-20260805-ISSUE3020
 */

/**
 * Monotonic-clock duration above which a successful keyring read is treated as
 * an interactive authorization event. Module constant, not configuration: it
 * is the contract, not a tunable. The detector requires the duration to be
 * strictly greater than this value (a read exactly at the threshold does not
 * count).
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export const INTERACTIVE_AUTH_THRESHOLD_MS = 1500;

/**
 * The diagnosis emitted when the grant is not persisting. Describes the
 * observation and its consequence; it does not assert a proven cause.
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export const GRANT_NOT_PERSISTING_MESSAGE =
  'LLxprt has been asked to authorize the same macOS Keychain credential again after it was already authorized this session, so the grant is not persisting and the password prompt will keep recurring (see #3020).';

/**
 * Both remedies. Installing an Oven-signed Bun clears the symptom in practice;
 * setting the opt-out routes LLxprt's own SecureStore credentials to the
 * encrypted file fallback. MCP server OAuth tokens still require the OS
 * keyring (see the troubleshooting guide).
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export const GRANT_NOT_PERSISTING_REMEDIATION =
  "Installing an Oven-signed Bun (a build with a stable team identity) clears this in practice: `brew uninstall bun && brew install oven-sh/bun/bun` (or `curl -fsSL https://bun.com/install | bash`). To recover now without changing your Bun, set LLXPRT_DISABLE_OS_KEYRING=1: LLxprt's own SecureStore credentials route to the encrypted file fallback and existing Keychain items are left untouched (MCP server OAuth tokens still require the OS keyring; see the troubleshooting guide).";

/**
 * Observation of a single successful keyring read, used to detect a discarded
 * "Always Allow" grant.
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export interface KeyringReadObservation {
  /**
   * Opaque correlation key for the credential. Never logged, never put in a
   * message, never interpolated into any text. It is a `Map` key only.
   */
  readonly credentialKey: string;
  /** Monotonic milliseconds (from `performance.now()`) when the native read started. */
  readonly startedAt: number;
  /** Monotonic milliseconds (from `performance.now()`) when the native read completed. */
  readonly endedAt: number;
}

// ─── Process-wide state ──────────────────────────────────────────────────────
//
// Mirrors runtime-replaced-errors.ts: a small amount of process-wide state and
// a once-per-process stderr warning. The state is terminal once set.

let broken = false;

/**
 * Injectable effective platform so the darwin-only behavior is testable on
 * every CI platform. `null` means "use process.platform".
 */
let effectivePlatform: NodeJS.Platform | null = null;

function currentPlatform(): NodeJS.Platform {
  return effectivePlatform ?? process.platform;
}

/**
 * Upper bound on the number of distinct credentials the tracker remembers.
 * The tracker only holds credentials that had exactly one interactive read,
 * and entries are only useful for short-range correlation, so this bound is
 * generous. Clearing at worst loses a first observation, which biases toward
 * NOT warning — the safe direction.
 */
const MAX_TRACKED_CREDENTIALS = 256;

/**
 * Holds the `endedAt` of each credential's last interactive read, keyed by an
 * opaque correlation key. Used only to detect a SECOND non-overlapping
 * interactive read of the SAME credential. Cleared once the broken state is
 * reached (no longer needed) and on reset.
 */
const lastInteractiveReadEndedAt = new Map<string, number>();

/**
 * Records a successful keyring read, with its monotonic-clock start and end
 * times, so a repeatedly slow read of the SAME credential surfaces the
 * discarded "Always Allow" grant. Called ONLY for reads that returned a
 * non-null value.
 *
 * Does nothing unless the effective platform is `darwin`, and counts only
 * durations strictly greater than {@link INTERACTIVE_AUTH_THRESHOLD_MS}. The
 * discarded-grant event is counted only on a SECOND non-overlapping
 * interactive read of the same credential; on that transition the process
 * enters the terminal broken state and the warning is emitted exactly once.
 * Nothing in this module throws.
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export function recordAuthorizedKeyringRead(
  observation: KeyringReadObservation,
): void {
  // 1. darwin-only.
  if (currentPlatform() !== 'darwin') {
    return;
  }
  // 2. Terminal state: stop doing work.
  if (broken) {
    return;
  }
  // 3. Strictly greater than the threshold (a read exactly at it is not an
  //    event).
  const duration = observation.endedAt - observation.startedAt;
  if (!(duration > INTERACTIVE_AUTH_THRESHOLD_MS)) {
    return;
  }
  // 4. Correlate by credential.
  const previousEndedAt = lastInteractiveReadEndedAt.get(
    observation.credentialKey,
  );
  if (previousEndedAt === undefined) {
    // First interactive authorization for this credential — the normal
    // one-time prompt. Remember it for short-range correlation, bounding the
    // map before inserting a brand-new key.
    if (lastInteractiveReadEndedAt.size >= MAX_TRACKED_CREDENTIALS) {
      lastInteractiveReadEndedAt.clear();
    }
    lastInteractiveReadEndedAt.set(
      observation.credentialKey,
      observation.endedAt,
    );
    return;
  }
  // Count the discarded-grant event ONLY if this read began at or after the
  // earlier authorization completed — i.e. a persisted grant would have
  // covered it. If it began earlier (overlapping/concurrent reads) it proves
  // nothing: leave the stored value unchanged.
  if (observation.startedAt < previousEndedAt) {
    return;
  }
  // 5. Counted event: terminal broken state. The map is no longer needed.
  broken = true;
  lastInteractiveReadEndedAt.clear();
  emitGrantNotPersistingWarning();
}

/**
 * Reports whether the discarded-grant condition has been detected this process.
 * Terminal: once true, always true for the lifetime of the process.
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export function isKeychainGrantPersistenceBroken(): boolean {
  return broken;
}

/**
 * Emits the one-time discarded-grant warning to stderr, guaranteeing it
 * reaches the user independent of any injected logger.
 *
 * @plan PLAN-20260805-ISSUE3020
 */
function emitGrantNotPersistingWarning(): void {
  try {
    process.stderr.write(
      `\n${GRANT_NOT_PERSISTING_MESSAGE} ${GRANT_NOT_PERSISTING_REMEDIATION}\n\n`,
    );
  } catch {
    // stderr can be closed or broken (EPIPE when piped into a command that
    // exits early). Losing the diagnostic notice is acceptable; breaking the
    // credential read that triggered it is not — the caller must still receive
    // the value it just read. Swallow here so a stream error can never escape
    // into the credential read path. Intentionally mirrors the defensive catch
    // in runtime-replaced-errors.ts.
  }
}

// ─── Test seams ──────────────────────────────────────────────────────────────

/**
 * Resets the observation state for testing, including the credential
 * correlation map. Does not change the effective platform; pair with
 * {@link setKeychainGrantPersistencePlatformForTesting}.
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export function resetKeychainGrantPersistenceForTesting(): void {
  broken = false;
  lastInteractiveReadEndedAt.clear();
}

/**
 * Overrides the effective platform so the darwin-only behavior is exercisable
 * on every CI platform. Pass `null` to restore the default (`process.platform`).
 *
 * @plan PLAN-20260805-ISSUE3020
 */
export function setKeychainGrantPersistencePlatformForTesting(
  platform: NodeJS.Platform | null,
): void {
  effectivePlatform = platform;
}
