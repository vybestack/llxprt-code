/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the probe request handlers (scripts/memory/probe.ts).
 * Handlers are exercised with fake JSC/v8 dependencies that record calls and
 * return controlled heap readings — no large real snapshot is ever produced.
 */

import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  type ProbeDeps,
  drainPendingRequests,
  handleSample,
  handleSnapshot,
  processClaimed,
} from '../../memory/probe.ts';
import {
  type ClaimResult,
  CLAIMED_SUFFIX,
  DONE_DIR_NAME,
  DEFAULT_STALE_MS,
  REQUEST_DIR_NAME,
  REQUEST_VERSION,
  type MemRequest,
  claimNextRequest,
  isRequestDone,
  queueRequest,
  writeDoneMarker,
} from '../../memory/request.ts';
import { type JscHeapStats } from '../../memory/sample.ts';

const MB = 1024 * 1024;

interface FakeState {
  readonly samples: string[];
  readonly logs: string[];
  readonly snapshots: string[];
  readonly published: Array<readonly [string, string]>;
  gcCalls: number;
}

interface FakeOptions {
  readonly heapSizeValue: number;
  readonly snapshotsArmed: boolean;
  readonly maxSnapshotHeapMb: number;
  readonly nowMs: number;
}

function makeDeps(
  runDir: string,
  options: FakeOptions,
): { readonly deps: ProbeDeps; readonly state: FakeState } {
  const state: FakeState = {
    samples: [],
    logs: [],
    snapshots: [],
    published: [],
    gcCalls: 0,
  };
  const stats: JscHeapStats = {
    heapSize: options.heapSizeValue,
    heapCapacity: options.heapSizeValue,
    extraMemorySize: 0,
    objectCount: 1000,
    protectedObjectCount: 5,
    objectTypeCounts: { Object: 500, String: 500 },
  };
  const deps: ProbeDeps = {
    runDir,
    now: () => options.nowMs,
    pid: () => 777,
    rss: () => 10 * MB,
    gcAndSweep: () => {
      state.gcCalls += 1;
    },
    heapStats: () => stats,
    heapSize: () => options.heapSizeValue,
    snapshotsArmed: options.snapshotsArmed,
    maxSnapshotHeapMb: options.maxSnapshotHeapMb,
    writeHeapSnapshot: (path) => {
      state.snapshots.push(path);
      writeFileSync(path, '');
    },
    appendSample: (line) => {
      state.samples.push(line);
    },
    appendLog: (line) => {
      state.logs.push(line);
    },
    publishSnapshot: (tempPath, finalPath) => {
      renameSync(tempPath, finalPath);
      state.published.push([tempPath, finalPath]);
    },
    // Idempotency probe over the recorded samples, mirroring the production
    // scan of samples.jsonl for this request id.
    hasSample: (requestId) =>
      state.samples.some((line) => line.includes(`"requestId":"${requestId}"`)),
  };
  return { deps, state };
}

const sampleRequest: MemRequest = {
  version: REQUEST_VERSION,
  id: 'req-sample-1',
  createdAt: 1_700_000_000_000,
  kind: 'sample',
};
const snapshotRequest: MemRequest = {
  version: REQUEST_VERSION,
  id: 'req-snap-1',
  createdAt: 1_700_000_000_000,
  kind: 'snapshot',
};

describe('handleSample — sample request behavior', () => {
  it('forces GC, writes a tagged sample, and logs completion with the id', () => {
    const { deps, state } = makeDeps('/tmp/unused', {
      heapSizeValue: 50 * MB,
      snapshotsArmed: false,
      maxSnapshotHeapMb: 256,
      nowMs: 1_700_000_000_000,
    });
    handleSample(deps, sampleRequest);
    expect(state.gcCalls).toBe(1);
    expect(state.samples).toHaveLength(1);
    const parsed = JSON.parse(state.samples[0]) as { tag: string };
    expect(parsed.tag).toBe('manual');
    expect(state.logs.some((l) => l.includes('req-sample-1'))).toBe(true);
    expect(state.logs.some((l) => l.includes('sample complete'))).toBe(true);
  });

  it('does not duplicate a sample whose request id was already published', () => {
    const { deps, state } = makeDeps('/tmp/unused', {
      heapSizeValue: 50 * MB,
      snapshotsArmed: false,
      maxSnapshotHeapMb: 256,
      nowMs: 1_700_000_000_000,
    });
    // A crash after the append but before the done marker leaves the sample
    // present; recovery must acknowledge, not append a second copy.
    state.samples.push(
      JSON.stringify({ tag: 'manual', requestId: 'req-sample-1' }),
    );
    handleSample(deps, sampleRequest);
    expect(state.gcCalls).toBe(0);
    expect(state.samples).toHaveLength(1);
    expect(state.logs.some((l) => l.includes('already published'))).toBe(true);
  });
});

describe('handleSnapshot — refusals', () => {
  it('refuses safely when snapshots are not armed', () => {
    const { deps, state } = makeDeps('/tmp/unused', {
      heapSizeValue: 10 * MB,
      snapshotsArmed: false,
      maxSnapshotHeapMb: 256,
      nowMs: 1_700_000_000_000,
    });
    handleSnapshot(deps, snapshotRequest);
    expect(state.snapshots).toHaveLength(0);
    expect(state.samples).toHaveLength(0);
    expect(state.logs.some((l) => l.includes('REFUSED'))).toBe(true);
    expect(state.logs.some((l) => l.includes('req-snap-1'))).toBe(true);
  });

  it('forces GC then refuses when the heap is over the guard', () => {
    const { deps, state } = makeDeps('/tmp/unused', {
      heapSizeValue: 300 * MB,
      snapshotsArmed: true,
      maxSnapshotHeapMb: 256,
      nowMs: 1_700_000_000_000,
    });
    handleSnapshot(deps, snapshotRequest);
    expect(state.gcCalls).toBe(1);
    expect(state.snapshots).toHaveLength(0);
    expect(state.samples).toHaveLength(0);
    expect(state.logs.some((l) => l.includes('REFUSED'))).toBe(true);
    expect(state.logs.some((l) => l.includes('exceeds limit'))).toBe(true);
  });
});

describe('handleSnapshot — success', () => {
  it('writes a request-keyed snapshot via a per-attempt temp then publishes', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-snap-'));
    try {
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 100 * MB,
        snapshotsArmed: true,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      handleSnapshot(deps, snapshotRequest);
      expect(state.gcCalls).toBe(1);
      expect(state.snapshots).toHaveLength(1);
      // The snapshot is written to a PER-ATTEMPT temp (request key + pid +
      // timestamp, so concurrent attempts never collide), then atomically
      // published to a final file keyed by the request id.
      const tempPath = state.snapshots[0];
      expect(tempPath).toMatch(
        /snap-req-snap-1\.heapsnapshot\.[a-z0-9]+\.[a-z0-9]+\.tmp$/,
      );
      expect(state.published).toEqual([
        [tempPath, join(runDir, 'snapshots', 'snap-req-snap-1.heapsnapshot')],
      ]);
      expect(existsSync(tempPath)).toBe(false);
      expect(state.samples).toHaveLength(1);
      const parsed = JSON.parse(state.samples[0]) as { tag: string };
      expect(parsed.tag).toBe('post-snapshot');
      expect(state.logs.some((l) => l.includes('req-snap-1'))).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('two attempts never collide: the second attempt uses a fresh temp', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-snap-2-'));
    try {
      const first = makeDeps(runDir, {
        heapSizeValue: 100 * MB,
        snapshotsArmed: true,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      handleSnapshot(first.deps, snapshotRequest);
      const second = makeDeps(runDir, {
        heapSizeValue: 100 * MB,
        snapshotsArmed: true,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_500_000,
      });
      // Delete the final to model a retry; the temp must differ per attempt.
      rmSync(join(runDir, 'snapshots', 'snap-req-snap-1.heapsnapshot'));
      handleSnapshot(second.deps, snapshotRequest);
      expect(second.state.snapshots[0]).not.toBe(first.state.snapshots[0]);
      expect(
        readdirSync(join(runDir, 'snapshots')).filter((n) =>
          n.endsWith('.tmp'),
        ),
      ).toEqual([]);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('does not re-write a snapshot whose final file already exists', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-snap-idem-'));
    try {
      const snapshotDir = join(runDir, 'snapshots');
      mkdirSync(snapshotDir, { recursive: true });
      writeFileSync(join(snapshotDir, 'snap-req-snap-1.heapsnapshot'), '');
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 100 * MB,
        snapshotsArmed: true,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      handleSnapshot(deps, snapshotRequest);
      expect(state.gcCalls).toBe(0);
      expect(state.snapshots).toHaveLength(0);
      expect(state.logs.some((l) => l.includes('already present'))).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe('drainPendingRequests — exactly once and no loops', () => {
  const validateOptions = {
    now: () => 1_700_000_000_000,
    staleMs: DEFAULT_STALE_MS,
  };

  /** Pending request artifacts: .json files awaiting claim or .claimed files. */
  const pendingArtifacts = (dir: string): string[] =>
    readdirSync(dir).filter(
      (name) => name.endsWith('.json') || name.endsWith(CLAIMED_SUFFIX),
    );

  it('processes a valid request exactly once and records a done marker', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-drain-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      queueRequest('sample', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      expect(drainPendingRequests(deps, validateOptions)).toBe(1);
      expect(state.gcCalls).toBe(1);
      expect(pendingArtifacts(requestDir)).toHaveLength(0);
      expect(drainPendingRequests(deps, validateOptions)).toBe(0);
      // The done marker survives so a restart recognizes completion.
      const doneDir = join(runDir, REQUEST_DIR_NAME, DONE_DIR_NAME);
      expect(readdirSync(doneDir)).toHaveLength(1);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('does not re-process a request whose done marker already exists', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-dup-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('sample', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      writeDoneMarker(runDir, queued.request.id, 1);
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      expect(drainPendingRequests(deps, validateOptions)).toBe(1);
      expect(state.gcCalls).toBe(0);
      expect(state.logs.some((l) => l.includes('already complete'))).toBe(true);
      expect(pendingArtifacts(requestDir)).toHaveLength(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('rejects and removes a malformed request without looping', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-malformed-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      mkdirSync(requestDir, { recursive: true });
      writeFileSync(join(requestDir, 'bad.json'), 'not valid json{', {
        flag: 'w',
      });
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      expect(drainPendingRequests(deps, validateOptions)).toBe(1);
      expect(state.gcCalls).toBe(0);
      expect(readdirSync(requestDir)).toHaveLength(0);
      expect(drainPendingRequests(deps, validateOptions)).toBe(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('rejects and removes a stale pending request without looping', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-stale-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      mkdirSync(requestDir, { recursive: true });
      writeFileSync(
        join(requestDir, 'old.json'),
        JSON.stringify({
          version: REQUEST_VERSION,
          id: 'old-1',
          createdAt: 1_700_000_000_000 - DEFAULT_STALE_MS - 1,
          kind: 'sample',
        }),
      );
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      expect(drainPendingRequests(deps, validateOptions)).toBe(1);
      expect(state.gcCalls).toBe(0);
      expect(readdirSync(requestDir)).toHaveLength(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe('processClaimed — durable retention on operational failure', () => {
  const validateOptions = {
    now: () => 1_700_000_000_000,
    staleMs: DEFAULT_STALE_MS,
  };

  it('keeps the claim for retry when the sample append fails', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-keep-1-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('sample', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      const claimed = claimOrFail(requestDir);
      const base = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      // An operational (external fs) failure in the side effect.
      const failingDeps: ProbeDeps = {
        ...base.deps,
        appendSample: () => {
          throw new Error('ENOSPC: no space left on device');
        },
      };
      processClaimed(claimed, failingDeps, validateOptions, 'pending');
      // The claim is KEPT and no done marker was written.
      expect(existsSync(claimed.path)).toBe(true);
      expect(isRequestDone(runDir, queued.request.id)).toBe(false);
      expect(base.state.logs.some((l) => l.includes('kept for retry'))).toBe(
        true,
      );
      // A retry with a healthy filesystem completes and removes the claim.
      const retry = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      processClaimed(claimed, retry.deps, validateOptions, 'pending');
      expect(existsSync(claimed.path)).toBe(false);
      expect(isRequestDone(runDir, queued.request.id)).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('keeps the claim when the done-marker write fails after a successful dispatch', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-keep-2-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('sample', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      const claimed = claimOrFail(requestDir);
      expect(claimed.fileName).toBe(basename(queued.path));
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      // Sabotage the run directory so the done-marker mkdir fails midway:
      // replace requests/ with a regular file, which breaks done-dir creation.
      rmSync(join(runDir, REQUEST_DIR_NAME), { recursive: true, force: true });
      writeFileSync(join(runDir, REQUEST_DIR_NAME), 'not-a-dir');
      processClaimed(claimed, deps, validateOptions, 'pending');
      expect(state.logs.some((l) => l.includes('kept for retry'))).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('recovery (already-claimed) does not stale-reject an old request', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-keep-3-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      // A request claimed long ago (older than staleMs): recovery must re-run
      // it, not drop it — it was already accepted when claimed.
      const old: MemRequest = {
        version: REQUEST_VERSION,
        id: 'old-2',
        createdAt: 1_700_000_000_000 - DEFAULT_STALE_MS - 60_000,
        kind: 'sample',
      };
      mkdirSync(requestDir, { recursive: true });
      const claimedPath = join(requestDir, 'old-2.json' + CLAIMED_SUFFIX);
      writeFileSync(claimedPath, JSON.stringify(old));
      const { deps, state } = makeDeps(runDir, {
        heapSizeValue: 50 * MB,
        snapshotsArmed: false,
        maxSnapshotHeapMb: 256,
        nowMs: 1_700_000_000_000,
      });
      processClaimed(
        { raw: JSON.stringify(old), path: claimedPath, fileName: 'old-2.json' },
        deps,
        validateOptions,
        'recovery',
      );
      expect(state.gcCalls).toBe(1);
      expect(state.samples).toHaveLength(1);
      expect(existsSync(claimedPath)).toBe(false);
      expect(isRequestDone(runDir, 'old-2')).toBe(true);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

/** Claims the single pending request or throws (test helper invariant). */
function claimOrFail(requestDir: string): ClaimResult {
  const result = claimNextRequest(requestDir);
  if (result === null) {
    throw new Error('expected a pending request to claim');
  }
  return result;
}
