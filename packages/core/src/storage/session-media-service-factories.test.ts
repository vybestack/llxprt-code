/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { sessionMediaServices } from './session-media-service-factories.js';

describe('sessionMediaServices', () => {
  let projectRoot = '';

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'session-media-services-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('shares one persistence queue, generation stream, and path per session ID', () => {
    const services = sessionMediaServices({
      storage: new Storage(projectRoot),
      getMediaStoreQuotaByteLimit: () => 1024,
      getSessionPersistenceQueueByteLimit: () => 2048,
    });

    const first = services.persistence('shared-session');
    const second = services.persistence('shared-session');
    const other = services.persistence('other-session');

    expect(second).toBe(first);
    expect(second.getSessionFilePath()).toBe(first.getSessionFilePath());
    expect(other).not.toBe(first);
  });
});
