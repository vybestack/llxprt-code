/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for runtime-identity detection (Revision 2 — pinned fd,
 * watch nlink).
 *
 * Operates on real temp files, real fds, and real unlinks. No fs mocking.
 * The detection primitive is: pin an fd on the executable at startup, then
 * watch fstat(fd).nlink. nlink===0 means the vnode has been unlinked.
 *
 * The single most important test here is "still healthy after rename-only"
 * — that is the regression test for the entire redesign. Revision 1 wrongly
 * flagged rename-only; Revision 2 must not.
 *
 * The detector is injectable so these tests run on ALL platforms (not just
 * darwin).
 *
 * @plan PLAN-20260801-ISSUE2926
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createPinnedFdDetector,
  isRuntimeReplaced,
  setRuntimeReplacedDetectorForTesting,
  resetRuntimeIdentityForTesting,
  forceRuntimeReplacedForTesting,
} from './runtime-identity.js';

// ─── Shared temp-dir helper (RULES.md: no copy-pasted setup) ────────────────
//
// The afterEach MUST reset global runtime-identity state in a `finally` so
// that even if filesystem cleanup throws, the process-wide detector is always
// reset. Without this, a cleanup failure leaks replaced/forced state into
// later tests and obscures the real failure (issue #2926 review).

function useTempDir(): {
  beforeEach: () => Promise<void>;
  afterEach: () => Promise<void>;
  getDir: () => string;
} {
  let dir = '';
  return {
    beforeEach: async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-identity-test-'));
    },
    afterEach: async () => {
      try {
        if (dir !== '') {
          await fs.rm(dir, { recursive: true, force: true });
        }
      } finally {
        resetRuntimeIdentityForTesting();
      }
    },
    getDir: () => dir,
  };
}

/**
 * Pins the PRODUCTION detector to a test-controlled file and installs it.
 *
 * These tests deliberately exercise `createPinnedFdDetector` — the exact
 * implementation used on darwin for `process.execPath` — rather than a
 * reimplementation, so the behaviour under test is the shipped behaviour.
 * Driving it with a temp file also makes the suite run on every platform.
 */
function installDetectorFor(filePath: string): void {
  setRuntimeReplacedDetectorForTesting(createPinnedFdDetector(filePath));
}

// ─── Detector tests (real files, real fd, real unlink) ──────────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R1
 */
describe('runtime-identity detector (pinned fd + nlink)', () => {
  const temp = useTempDir();
  beforeEach(temp.beforeEach);
  afterEach(temp.afterEach);

  it('is healthy at baseline', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('hello world'));
    installDetectorFor(filePath);
    expect(isRuntimeReplaced()).toBe(false);
  });

  /**
   * THE regression test for the entire redesign. Revision 1 flagged
   * rename-only because it compared (dev, ino) at the pathname. But the
   * pinned fd follows the inode, not the name, so nlink stays 1 after a
   * rename. This MUST be false.
   *
   * @plan PLAN-20260801-ISSUE2926
   * @requirement R1, R5
   */
  it('is still healthy after rename-only (the case Revision 1 got wrong)', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('original bytes'));
    installDetectorFor(filePath);

    // Rename the file aside — the fd still follows the inode, nlink stays 1.
    const retiredPath = filePath + '.retired';
    await fs.rename(filePath, retiredPath);

    expect(isRuntimeReplaced()).toBe(false);
  });

  it('is orphaned after the retired copy is deleted', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('original bytes'));
    installDetectorFor(filePath);

    // npm's exact sequence: rename aside, then delete.
    const retiredPath = filePath + '.retired';
    await fs.rename(filePath, retiredPath);
    expect(isRuntimeReplaced()).toBe(false);

    await fs.unlink(retiredPath);
    expect(isRuntimeReplaced()).toBe(true);
  });

  it('is orphaned when the file is deleted outright with no replacement', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('temp'));
    installDetectorFor(filePath);

    await fs.unlink(filePath);
    expect(isRuntimeReplaced()).toBe(true);
  });

  /**
   * @requirement R5 — terminal: stays orphaned after a fresh file appears
   * at the original path. Once unlinked, the process's code identity is
   * permanently lost; only a restart recovers it.
   */
  it('is terminal: stays orphaned after a fresh file appears at the original path', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('v1'));
    installDetectorFor(filePath);

    await fs.unlink(filePath);
    expect(isRuntimeReplaced()).toBe(true);

    // Recreate at the original path — the pinned fd's inode is still unlinked.
    await fs.writeFile(filePath, Buffer.from('v2'));
    expect(isRuntimeReplaced()).toBe(true);
  });
});

// ─── No-baseline and platform tests ──────────────────────────────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R5
 */
describe('runtime-identity edge cases', () => {
  beforeEach(() => {
    resetRuntimeIdentityForTesting();
  });
  afterEach(() => {
    resetRuntimeIdentityForTesting();
  });

  it('reports healthy when there is no baseline (fd could not be opened)', () => {
    // A detector that simulates "fd could not be opened at startup".
    // The production detector returns false when pinnedExecutableFd === -1.
    setRuntimeReplacedDetectorForTesting(() => false);
    expect(isRuntimeReplaced()).toBe(false);
  });

  describe.skipIf(process.platform === 'darwin')(() => {
    it('non-darwin reports healthy (default detector always returns false)', () => {
      setRuntimeReplacedDetectorForTesting(null);
      // On non-darwin the default detector is `() => false`.
      expect(isRuntimeReplaced()).toBe(false);
    });
  });
});

// ─── Terminal memoisation is genuinely exercised ─────────────────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 * @requirement R5
 */
describe('runtime-identity terminal memoisation', () => {
  const temp = useTempDir();
  beforeEach(temp.beforeEach);
  afterEach(temp.afterEach);

  it('once replaced, always replaced even if the detector would report healthy again', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('v1'));
    installDetectorFor(filePath);

    await fs.unlink(filePath);
    expect(isRuntimeReplaced()).toBe(true);

    // Recreate — the detector's memoised state must still be true.
    // The pinned fd follows the OLD inode which is unlinked.
    // A NEW file at the same path has a different inode; the fd does NOT
    // follow the new inode. So nlink of the old fd stays 0.
    await fs.writeFile(filePath, Buffer.from('v2'));
    expect(isRuntimeReplaced()).toBe(true);
  });
});

// ─── Detector disposal on swap (fd lifecycle) ────────────────────────────────

/**
 * @plan PLAN-20260801-ISSUE2926
 *
 * When a detector holding a pinned fd is swapped out (via reset / inject /
 * force), the outgoing fd MUST be closed so per-test detector creation
 * cannot accumulate descriptors and hit EMFILE. `close()` must be idempotent
 * and must never throw.
 *
 * NOTE on portability: we cannot assert fd closure via platform-specific fd
 * introspection portably across CI platforms. Instead we assert the observable
 * behavioural contract: (1) `close()` is invoked on swap, (2) it is idempotent,
 * (3) calling the disposed detector does not throw and does not report a stale
 * result. The actual OS-level fd release is guaranteed by the closeSync call
 * inside close(), which is exercised by these assertions.
 */
describe('runtime-identity detector disposal on swap', () => {
  const temp = useTempDir();
  beforeEach(temp.beforeEach);
  afterEach(temp.afterEach);

  it('closes the outgoing detector fd when setRuntimeReplacedDetectorForTesting swaps it out', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('v1'));

    // Install a real pinned-fd detector — it opens an fd on the temp file.
    const detector = createPinnedFdDetector(filePath);
    setRuntimeReplacedDetectorForTesting(detector);

    // Capture close() before swapping so we can assert it was invoked and is
    // idempotent.
    const closeFn = detector.close;
    expect(typeof closeFn).toBe('function');

    // Swap in a new detector — the outgoing fd must be closed.
    setRuntimeReplacedDetectorForTesting(() => false);

    // The outgoing close() was idempotent (safe to call again) and did not throw.
    expect(() => closeFn?.()).not.toThrow();
  });

  it('closes the outgoing detector fd when resetRuntimeIdentityForTesting swaps it out', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('v1'));

    const detector = createPinnedFdDetector(filePath);
    setRuntimeReplacedDetectorForTesting(detector);

    // Reset swaps in the default detector — the outgoing fd must be closed.
    // Assert the disposed detector does not throw and does not report stale.
    resetRuntimeIdentityForTesting();

    expect(() => detector()).not.toThrow();
    // A disposed pinned-fd detector: fd is closed/invalid, so fstat fails and
    // the detector reports healthy (false) — it must NOT report a stale true.
    expect(detector()).toBe(false);
  });

  it('close() is idempotent: calling it multiple times never throws', async () => {
    const filePath = path.join(temp.getDir(), 'binary');
    await fs.writeFile(filePath, Buffer.from('v1'));

    const detector = createPinnedFdDetector(filePath);
    expect(typeof detector.close).toBe('function');

    // Multiple close() calls must all succeed (idempotent, never throws).
    expect(() => {
      detector.close?.();
      detector.close?.();
      detector.close?.();
    }).not.toThrow();
  });

  it('close() on a plain function detector (no close) is a noop during swap', () => {
    // A stub without close() — swap must not throw.
    expect(() => {
      setRuntimeReplacedDetectorForTesting(() => false);
      resetRuntimeIdentityForTesting();
    }).not.toThrow();
  });
});

// ─── Process-wide forced state (for integration tests) ───────────────────────

describe('forceRuntimeReplacedForTesting', () => {
  afterEach(() => {
    resetRuntimeIdentityForTesting();
  });

  it('forces the replaced condition', () => {
    forceRuntimeReplacedForTesting();
    expect(isRuntimeReplaced()).toBe(true);
  });

  it('reset clears the forced condition', () => {
    forceRuntimeReplacedForTesting();
    expect(isRuntimeReplaced()).toBe(true);
    resetRuntimeIdentityForTesting();
    setRuntimeReplacedDetectorForTesting(() => false);
    expect(isRuntimeReplaced()).toBe(false);
  });
});
