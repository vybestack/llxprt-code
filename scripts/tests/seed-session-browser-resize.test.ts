/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getProjectHash,
  SessionDiscovery,
  SessionLockManager,
} from '@vybestack/llxprt-code-core';
import { seedSessionBrowserResize } from '../seed-session-browser-resize.ts';

const EXPECTED_SESSION_ID = '00000000-0000-4000-8000-000000002017';

let tempRoot: string;
let chatsDir: string;
let projectRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'resize-session-seed-'));
  chatsDir = path.join(tempRoot, 'chats');
  projectRoot = path.join(tempRoot, 'workspace');
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('session-browser resize seed', () => {
  it('persists the fixed unlocked fake-provider session for the target project', async () => {
    await seedSessionBrowserResize({ chatsDir, projectRoot });

    const targets = await SessionDiscovery.listContinueTargets(
      chatsDir,
      getProjectHash(projectRoot),
    );

    expect(targets).toHaveLength(1);
    const target = targets[0];
    if (target === undefined || target.kind !== 'session') {
      throw new Error('Expected one persisted session target');
    }
    expect(target.session).toMatchObject({
      sessionId: EXPECTED_SESSION_ID,
      provider: 'fake',
      model: 'fake-model',
    });
    await expect(
      SessionDiscovery.readFirstUserMessage(target.session.filePath),
    ).resolves.toBe('seed isolated resize session');
    await expect(
      SessionLockManager.isLocked(chatsDir, EXPECTED_SESSION_ID),
    ).resolves.toBe(false);
  });
});
