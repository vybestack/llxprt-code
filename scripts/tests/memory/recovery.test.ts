/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recoverability tests for the request channel (issue #3230): request
 * processing must be effectively exactly-once across a process restart.
 *
 * Interruption is simulated at the boundaries that matter:
 *  - BEFORE side effects: the claim exists but nothing was produced. Recovery
 *    must re-run the side effects.
 *  - AFTER side effects: the output (sample with the request id / snapshot
 *    final file / done marker) exists but the claim was not removed. Recovery
 *    must acknowledge without doubling.
 *
 * A crashed process leaves a RENAMED .claimed file (no .json remains), which
 * is what the production claim path actually produces; the fixtures model the
 * rename rather than fabricating an extra file.
 *
 * These exercise the real production claim/recovery functions against a real
 * temp filesystem — no mocks of internal logic.
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
import { join } from 'node:path';
import {
  DEFAULT_STALE_MS,
  DONE_DIR_NAME,
  REQUEST_DIR_NAME,
  REQUEST_VERSION,
  type MemRequest,
  queueRequest,
  writeDoneMarker,
} from '../../memory/request.ts';
import {
  type ProbeDeps,
  recoverOrphanedClaims,
  snapshotPathFor,
} from '../../memory/probe.ts';
import { type JscHeapStats } from '../../memory/sample.ts';

const MB = 1024 * 1024;

interface ProbeHarness {
  readonly deps: ProbeDeps;
  readonly samples: string[];
  readonly logs: string[];
  readonly snapshotWrites: string[];
  gcCalls: () => number;
}

/**
 * A probe harness with recordable side effects. writeHeapSnapshot actually
 * creates the temp file so the publish (rename) step can be interrupted
 * realistically; the fake payload is tiny.
 */
function makeHarness(runDir: string, armed: boolean): ProbeHarness {
  const samples: string[] = [];
  const logs: string[] = [];
  const snapshotWrites: string[] = [];
  let gcCalls = 0;
  const stats: JscHeapStats = {
    heapSize: 50 * MB,
    heapCapacity: 60 * MB,
    extraMemorySize: 0,
    objectCount: 1_000,
    protectedObjectCount: 5,
    objectTypeCounts: { Object: 500, String: 500 },
  };
  const deps: ProbeDeps = {
    runDir,
    now: () => 1_700_000_000_000,
    pid: () => 999,
    rss: () => 10 * MB,
    gcAndSweep: () => {
      gcCalls += 1;
    },
    heapStats: () => stats,
    heapSize: () => stats.heapSize,
    snapshotsArmed: armed,
    maxSnapshotHeapMb: 256,
    writeHeapSnapshot: (path) => {
      snapshotWrites.push(path);
      writeFileSync(path, '{"tiny":"fake"}');
    },
    appendSample: (line) => {
      samples.push(line);
    },
    appendLog: (line) => {
      logs.push(line);
    },
    publishSnapshot: (tempPath, finalPath) => {
      renameSync(tempPath, finalPath);
    },
    // Production semantics: a published sample carrying the request id makes
    // manual-sample publication idempotent across the restart.
    hasSample: (requestId) =>
      samples.some((line) => line.includes(`"requestId":"${requestId}"`)),
  };
  return {
    deps,
    samples,
    logs,
    snapshotWrites,
    gcCalls: () => gcCalls,
  };
}

const validateOptions = {
  now: () => 1_700_000_000_000,
  staleMs: DEFAULT_STALE_MS,
};

/**
 * Simulates a crash AFTER the claim: models the rename the dead process
 * actually performed, so exactly one file (the .claimed one) remains.
 */
function crashAfterClaim(requestDir: string, request: MemRequest): string {
  mkdirSync(requestDir, { recursive: true });
  const requestPath = join(requestDir, `${request.id}.json`);
  const claimedPath = `${requestPath}.claimed`;
  writeFileSync(requestPath, JSON.stringify(request));
  renameSync(requestPath, claimedPath);
  return claimedPath;
}

describe('recovery — interrupted BEFORE side effects', () => {
  it('re-runs a sample request whose claim survived with no output', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-a-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('sample', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      // Crash: the request was claimed but nothing else happened. The .json
      // is GONE — the claim was a rename — which is what a real crash leaves.
      const claimedPath = crashAfterClaim(requestDir, queued.request);

      const harness = makeHarness(runDir, false);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      // The side effects ran exactly once during recovery.
      expect(harness.gcCalls()).toBe(1);
      expect(harness.samples).toHaveLength(1);
      expect(existsSync(claimedPath)).toBe(false);
      // And the done marker now exists, so a second recovery is a no-op.
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('re-runs a snapshot request whose claim survived with no snapshot', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-b-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('snapshot', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      crashAfterClaim(requestDir, queued.request);

      const harness = makeHarness(runDir, true);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      // The snapshot was produced and published under the final keyed name.
      const finalPath = snapshotPathFor(runDir, queued.request.id);
      expect(existsSync(finalPath)).toBe(true);
      // No partial temp file is left masquerading as an artifact.
      expect(
        readdirSync(join(runDir, 'snapshots')).filter((n) =>
          n.endsWith('.tmp'),
        ),
      ).toEqual([]);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('re-runs an OLD claimed request instead of stale-rejecting it', () => {
    // A claim was accepted, then the process stayed down past the staleness
    // window. Recovery validates shape only — never staleness — so the
    // already-accepted request is re-run, not dropped.
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-stale-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const stale: MemRequest = {
        version: REQUEST_VERSION,
        id: 'stale-9',
        createdAt: 1_700_000_000_000 - DEFAULT_STALE_MS - 60_000,
        kind: 'sample',
      };
      crashAfterClaim(requestDir, stale);

      const harness = makeHarness(runDir, false);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      expect(harness.gcCalls()).toBe(1);
      expect(harness.samples).toHaveLength(1);
      // Re-run, not rejection: no "rejected request" line was logged.
      expect(harness.logs.some((l) => l.includes('rejected request'))).toBe(
        false,
      );
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe('recovery — interrupted AFTER side effects', () => {
  it('does not double a sample when the done marker exists', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-c-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('sample', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      // Crash: side effects completed and marker written, claim not removed.
      crashAfterClaim(requestDir, queued.request);
      writeDoneMarker(runDir, queued.request.id, 1);

      const harness = makeHarness(runDir, false);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      expect(harness.gcCalls()).toBe(0);
      expect(harness.samples).toHaveLength(0);
      expect(harness.logs.some((l) => l.includes('already complete'))).toBe(
        true,
      );
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('does not duplicate a manual sample even when the marker is missing', () => {
    // Crash AFTER the sample append but BEFORE the done marker: the sample
    // with the request id is already on disk. Recovery must acknowledge the
    // idempotent output instead of appending a second copy.
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-c2-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('sample', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      const claimedPath = crashAfterClaim(requestDir, queued.request);
      const harness = makeHarness(runDir, false);
      // The crashed process had appended its sample before dying.
      harness.samples.push(
        JSON.stringify({ tag: 'manual', requestId: queued.request.id }),
      );

      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      expect(harness.gcCalls()).toBe(0);
      expect(harness.samples).toHaveLength(1);
      expect(harness.logs.some((l) => l.includes('already published'))).toBe(
        true,
      );
      // And the completion is now durable, so the claim is removed.
      expect(existsSync(claimedPath)).toBe(false);
      const doneDir = join(runDir, REQUEST_DIR_NAME, DONE_DIR_NAME);
      expect(readdirSync(doneDir)).toContain(queued.request.id);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('acknowledges an already-published snapshot without re-writing it', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-d-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('snapshot', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      // Crash AFTER the final rename but BEFORE the done marker.
      const finalPath = snapshotPathFor(runDir, queued.request.id);
      mkdirSync(join(runDir, 'snapshots'), { recursive: true });
      writeFileSync(finalPath, '{"tiny":"fake"}');
      crashAfterClaim(requestDir, queued.request);

      const harness = makeHarness(runDir, true);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      // Not re-written, not forced through GC again.
      expect(harness.snapshotWrites).toHaveLength(0);
      expect(harness.gcCalls()).toBe(0);
      expect(harness.logs.some((l) => l.includes('already present'))).toBe(
        true,
      );
      // The marker is written now, so subsequent recovery is inert.
      const doneDir = join(runDir, REQUEST_DIR_NAME, DONE_DIR_NAME);
      expect(readdirSync(doneDir)).toContain(queued.request.id);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('overwrites a stale temp snapshot left by a crash mid-write', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-e-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('snapshot', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      // Crash DURING writeHeapSnapshot: a partial temp file exists, no final.
      // The temp carries an earlier attempt's pid/timestamp suffix.
      const finalPath = snapshotPathFor(runDir, queued.request.id);
      const snapshotDir = join(runDir, 'snapshots');
      mkdirSync(snapshotDir, { recursive: true });
      const staleTemp = `${finalPath}.p1.${(1_700_000_000_000 - 5_000).toString(36)}.tmp`;
      writeFileSync(staleTemp, '{"partial":');
      crashAfterClaim(requestDir, queued.request);

      const harness = makeHarness(runDir, true);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      // The fresh attempt wrote its own per-attempt temp and published; the
      // crashed attempt's partial file was removed.
      expect(existsSync(finalPath)).toBe(true);
      expect(existsSync(staleTemp)).toBe(false);
      expect(
        readdirSync(snapshotDir).filter((n) => n.endsWith('.tmp')),
      ).toEqual([]);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('an unarmed probe recovering a snapshot request refuses it durably', () => {
    // The restarted process was NOT launched with --snapshots. The orphaned
    // snapshot request is refused (logged), marked done, and the claim is
    // removed — it will not loop on every restart.
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-unarmed-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      const queued = queueRequest('snapshot', {
        requestDir,
        now: () => 1_700_000_000_000,
        random: () => 0.5,
        pid: 1,
      });
      const claimedPath = crashAfterClaim(requestDir, queued.request);

      const harness = makeHarness(runDir, false);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      expect(harness.snapshotWrites).toHaveLength(0);
      expect(harness.logs.some((l) => l.includes('snapshots not armed'))).toBe(
        true,
      );
      expect(existsSync(claimedPath)).toBe(false);
      expect(
        readdirSync(join(runDir, REQUEST_DIR_NAME, DONE_DIR_NAME)),
      ).toContain(queued.request.id);
      // Second recovery: nothing left to do.
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

describe('recovery — mixed and empty states', () => {
  it('returns zero when there are no orphans', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-f-'));
    try {
      const harness = makeHarness(runDir, false);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('removes an orphaned malformed claim without looping', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-g-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      mkdirSync(requestDir, { recursive: true });
      writeFileSync(join(requestDir, 'garbage.json.claimed'), 'not-json{');

      const harness = makeHarness(runDir, false);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      expect(harness.gcCalls()).toBe(0);
      expect(
        readdirSync(requestDir).filter((n) => n.endsWith('.claimed')),
      ).toEqual([]);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it('removes an orphaned claim whose id violates the grammar', () => {
    // A path-shaped id (traversal attempt or corrupt file) is invalid: the
    // claim is rejected and deleted, never processed.
    const runDir = mkdtempSync(join(tmpdir(), 'memprobe-recover-i-'));
    try {
      const requestDir = join(runDir, REQUEST_DIR_NAME);
      mkdirSync(requestDir, { recursive: true });
      writeFileSync(
        join(requestDir, 'evil.json.claimed'),
        JSON.stringify({
          version: REQUEST_VERSION,
          id: '../escape',
          createdAt: 1_700_000_000_000,
          kind: 'snapshot',
        }),
      );
      const harness = makeHarness(runDir, true);
      expect(recoverOrphanedClaims(harness.deps, validateOptions)).toBe(1);
      expect(harness.snapshotWrites).toHaveLength(0);
      expect(readdirSync(requestDir)).toEqual([]);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});
