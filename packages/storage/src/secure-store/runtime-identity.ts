/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime identity detection for the macOS orphaned-executable condition
 * (issue #2926).
 *
 * On macOS, LLxprt execs the Bun binary bundled inside its own npm package
 * tree. When an in-place reinstall renames that tree aside and deletes it,
 * the running process survives but its executable vnode becomes nameless.
 * macOS securityd can then no longer reconstruct the process's code identity
 * (proc_pidpath() returns ENOENT), so it cannot evaluate any Keychain item's
 * requirement and falls back to a login-password prompt on every protected
 * operation — an unbounded storm.
 *
 * ## Correct signal: pinned fd, watch nlink
 *
 * Revision 1 used a (dev, ino) pathname comparator. That was wrong: renaming
 * the tree aside changes the inode at the path but is harmless (the C harness
 * showed SecCode create=0 valid=0 while renamed aside). The correct signal
 * is whether the **live executable vnode has been unlinked** — not whether a
 * file at the same path has a different inode.
 *
 * We open a file descriptor on `process.execPath` at startup and pin it. The
 * fd follows the inode, not the name. `fstat(fd).nlink` is then exact:
 *
 *   nlink >= 1  → inode still has ≥1 directory entry. Healthy.
 *   nlink === 0 → every link gone; file unlinked. Orphaned, terminal.
 *
 * Validated empirically against the real npm sequence:
 *
 *   baseline               nlink=1  → orphaned: false
 *   after rename-only      nlink=1  → orphaned: false   (healthy)
 *   after retired deleted  nlink=0  → orphaned: true    (orphaned)
 *
 * Pure Node — no native module, no proc_pidpath binding.
 *
 * ## Injectability
 *
 * The detector is injectable: `isRuntimeReplaced` delegates to a swappable
 * predicate so SecureStore behaviour is testable on all CI platforms, not
 * just macOS. The darwin implementation opens a real fd; tests can inject a
 * controllable stub via `setRuntimeReplacedDetectorForTesting`.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R1, R2, R5
 */

import { openSync, fstatSync, closeSync } from 'node:fs';

/**
 * Injectable "is the runtime replaced?" predicate.
 *
 * Carries an optional `close()` so a detector that holds resources (the pinned
 * fd opened by {@link createPinnedFdDetector}) can release them deterministically
 * when the detector is swapped out of {@link currentDetector}. `close()` must be
 * idempotent and must never throw.
 *
 * Plain function detectors (e.g. the non-darwin `() => false` default and the
 * test stubs) omit `close()` — they hold no resources.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R1
 */
export interface RuntimeReplacedDetector {
  (): boolean;
  close?(): void;
}

// ─── Process-wide state ──────────────────────────────────────────────────────

const NO_PINNED_FD = -1;

/**
 * Opens a pinned fd on `execPath`, or NO_PINNED_FD if it cannot be opened.
 * No baseline means we never had a reference point, so the detector reports
 * healthy (never flags) — tested explicitly.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R5
 */
function openPinnedFd(execPath: string): number {
  try {
    return openSync(execPath, 'r');
  } catch {
    return NO_PINNED_FD;
  }
}

/**
 * Checks whether the pinned executable fd has been unlinked (nlink === 0).
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R1
 */
function isPinnedFdUnlinked(fd: number): boolean {
  try {
    return fstatSync(fd).nlink === 0;
  } catch {
    // fstat failed — state is indeterminate. Report healthy rather than
    // disabling credentials on a transient I/O error.
    return false;
  }
}

/**
 * Builds a detector that pins an fd on `execPath` and reports replaced once
 * that inode has been unlinked. The fd follows the inode, not the name, so a
 * rename leaves nlink at 1 and is correctly reported healthy.
 *
 * Terminal: once replaced, always replaced.
 *
 * Exported so tests exercise this exact production implementation against a
 * temp file, rather than reimplementing it.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R1, R5
 */
export function createPinnedFdDetector(
  execPath: string,
): RuntimeReplacedDetector {
  let fd = openPinnedFd(execPath);
  let memoised = false;
  const detect = (): boolean => {
    if (memoised) {
      return true;
    }
    if (fd === NO_PINNED_FD) {
      return false;
    }
    memoised = isPinnedFdUnlinked(fd);
    if (memoised) {
      // The inode is orphaned (terminal). The fd is no longer needed and
      // must be released so repeated detector creation (tests, multiple
      // SecureStore instances) cannot accumulate descriptors and hit EMFILE.
      closeSync(fd);
      fd = NO_PINNED_FD;
    }
    return memoised;
  };
  // Deterministic resource release for the swap path (issue #2926 review):
  // when this detector is replaced via resetRuntimeIdentityForTesting() or
  // setRuntimeReplacedDetectorForTesting(), the pinned fd must be closed so
  // per-test detector creation cannot accumulate descriptors and hit EMFILE.
  // Idempotent: once closed, fd is NO_PINNED_FD so subsequent calls are noops.
  // Never throws: closeSync failures are swallowed because detection has
  // already completed its contract by the time close() is invoked.
  detect.close = (): void => {
    if (fd !== NO_PINNED_FD) {
      try {
        closeSync(fd);
      } catch {
        // Swallow: close() must never throw. The fd will be reclaimed by the
        // OS on process exit regardless.
      }
      fd = NO_PINNED_FD;
    }
  };
  return detect;
}

/**
 * Creates the default detector. On darwin it pins an fd on the running
 * executable; elsewhere it always reports healthy (the bug is macOS-specific).
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R1, R5
 */
function createDefaultDetector(): RuntimeReplacedDetector {
  if (process.platform !== 'darwin') {
    return () => false;
  }
  return createPinnedFdDetector(process.execPath);
}

/**
 * The current detector. Created eagerly at module initialisation so the fd is
 * pinned before any await can interleave a mid-session reinstall. Injectable
 * for testing (R5: testable on all CI platforms).
 */
let currentDetector: RuntimeReplacedDetector = createDefaultDetector();

/**
 * Disposes a detector's resources (its pinned fd, if any) and then installs
 * the replacement as the current detector. Centralised so every swap path —
 * {@link resetRuntimeIdentityForTesting}, {@link setRuntimeReplacedDetectorForTesting},
 * and {@link forceRuntimeReplacedForTesting} — closes the outgoing detector's
 * fd before discarding it, preventing per-test fd accumulation that can hit
 * EMFILE in a long suite.
 *
 * `close()` is optional and idempotent; calling it on a detector without one
 * (e.g. the non-darwin `() => false` default) is a noop.
 *
 * @plan PLAN-20260801-ISSUE2926
 */
function replaceDetector(next: RuntimeReplacedDetector): void {
  const outgoing = currentDetector;
  if (typeof outgoing.close === 'function') {
    outgoing.close();
  }
  currentDetector = next;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reports whether the running runtime has been replaced on disk since process
 * start. Process-wide and memoised: once true, always true for the lifetime
 * of this process.
 *
 * Non-darwin platforms always return false (the bug is macOS-specific; R5).
 * A null baseline (fd could not be opened) always returns false.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R1, R2, R5
 */
export function isRuntimeReplaced(): boolean {
  return currentDetector();
}

/**
 * Sets the detector function for testing. This makes the replaced-runtime
 * behaviour testable on all CI platforms — tests inject a stub that returns
 * true/false without needing a real darwin fd. Disposes the outgoing
 * detector's fd (if any) so per-test swaps cannot accumulate descriptors.
 *
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R5
 */
export function setRuntimeReplacedDetectorForTesting(
  detector: RuntimeReplacedDetector | null,
): void {
  replaceDetector(detector ?? createDefaultDetector());
}

/**
 * Resets the process-wide state for testing: clears memoisation and
 * re-creates the default detector (which re-opens the fd on darwin). Disposes
 * the outgoing detector's fd (if any) before swapping.
 *
 * @plan PLAN-20260801-ISSUE2926
 */
export function resetRuntimeIdentityForTesting(): void {
  replaceDetector(createDefaultDetector());
}

/**
 * Test-only: forces the replaced condition so SecureStore gating can be
 * exercised without actually unlinking the real process executable. Disposes
 * the outgoing detector's fd (if any) before swapping.
 *
 * @plan PLAN-20260801-ISSUE2926
 */
export function forceRuntimeReplacedForTesting(): void {
  replaceDetector(() => true);
}
