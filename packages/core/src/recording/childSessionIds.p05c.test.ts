/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05c target contract: subagent child sessions get a random FS-SAFE session
 * id allocated BEFORE runtime construction. Today the orchestrator derives
 * child ids as `${parent}::${parent}#${name}#${suffix}` — the `::` and `#`
 * fail the safe-session lock grammar (janitor/sessionSafety.ts
 * SAFE_SESSION_ID_RE), and every child of one parent shares the parent's
 * first 12 characters, so two children materialized in the same timestamp
 * bucket collide on a single journal filename.
 *
 * RED (missing API): imports the pinned `allocateChildSessionId` seam that
 * the green session implements per tmp/verify854/p05c/api_sketch.md. The
 * module does not exist at HEAD, so this file fails at load — the sanctioned
 * red mode for a missing contract.
 *
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 */

import { describe, expect, it } from 'bun:test';
import { allocateChildSessionId } from './childSessionIds.js';
import { isValidSafeSessionId } from './janitor/sessionSafety.js';
import { SESSION_FILE_ID_PREFIX_LENGTH } from './SessionRecordingService.js';

const PARALLEL_LAUNCHES = 64;

describe('P05c child session id allocation @plan:PLAN-20260917-ISSUE854.P05c', () => {
  it('produces ids accepted by the canonical safe-session lock grammar', () => {
    const id = allocateChildSessionId();
    expect(isValidSafeSessionId(id)).toBe(true);
  });

  it('produces distinct ids across a parallel launch burst', () => {
    const ids = Array.from({ length: PARALLEL_LAUNCHES }, () =>
      allocateChildSessionId(),
    );
    expect(new Set(ids).size).toBe(PARALLEL_LAUNCHES);
  });

  it('produces distinct filename prefixes inside one timestamp bucket', () => {
    const ids = Array.from({ length: PARALLEL_LAUNCHES }, () =>
      allocateChildSessionId(),
    );
    const prefixes = new Set(
      ids.map((id) => id.slice(0, SESSION_FILE_ID_PREFIX_LENGTH)),
    );
    expect(prefixes.size).toBe(PARALLEL_LAUNCHES);
  });

  it('allocates ids long enough to fill the filename prefix', () => {
    const id = allocateChildSessionId();
    expect(id.length).toBeGreaterThanOrEqual(SESSION_FILE_ID_PREFIX_LENGTH);
  });

  it('never allocates an id equal to a previously allocated id', () => {
    const seen = new Set<string>();
    for (let round = 0; round < 256; round += 1) {
      const id = allocateChildSessionId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
