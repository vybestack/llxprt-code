/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionMediaOwner } from './session-media-owner.js';

describe('SessionMediaOwner', () => {
  let projectRoot = '';

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'session-media-services-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('provides a media store without retaining persistence journals in Config', async () => {
    const owner = new SessionMediaOwner(projectRoot, 1024);
    try {
      expect(await owner.store.getStoredByteLength()).toBe(0);
      expect('persistence' in owner).toBe(false);
    } finally {
      await owner.dispose();
    }
  });
});
