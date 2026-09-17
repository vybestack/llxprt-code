/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Expansion state for capped tool results (issue #3428 section D).
 *
 * The transcript is the source of truth: these tests record real sessions
 * through the real SessionRecordingService into real temp files, cap the
 * display copy through the shared retention boundary, and read the full body
 * back through the store under test. No transcript stand-ins.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SessionRecordingService,
  type IContent,
} from '@vybestack/llxprt-code-core';
import {
  boundResultDisplayForRetention,
  TOOL_RESULT_RETENTION_CAP_BYTES,
} from '../../utils/toolResultRetention.js';
import {
  createToolResultExpansionStore,
  TOOL_RESULT_EXPANSION_LIMIT,
} from './toolResultExpansionStore.js';

const KIB = 1024;

function largeBody(prefix: string, kib: number): string {
  return `${prefix}-start\n${'x'.repeat(kib * KIB)}\n${prefix}-end`;
}

function toolResponseContent(callId: string, result: unknown): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: 'test_tool',
        result,
        isComplete: true,
      },
    ],
  };
}

describe('toolResultExpansionStore — transcript-backed expansion (#3428)', () => {
  let tempDir: string;
  let service: SessionRecordingService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '3428-expansion-'));
    service = new SessionRecordingService({
      sessionId: 'test-session-3428-expansion',
      projectHash: 'testhash',
      chatsDir: tempDir,
      workspaceDirs: [tempDir],
      provider: 'fake',
      model: 'fake-model',
    });
  });

  afterEach(async () => {
    await service.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createStore(): ReturnType<typeof createToolResultExpansionStore> {
    return createToolResultExpansionStore(
      () => service.getFilePath() ?? undefined,
    );
  }

  it('expand loads the exact original body that was capped for display', async () => {
    const body = largeBody('FULL', 300); // well above the 64 KiB display cap
    const capped = boundResultDisplayForRetention(body);
    expect(capped.wasCapped).toBe(true);
    expect(capped.text.length).toBeLessThan(body.length);

    service.recordContent(toolResponseContent('call-big', body));
    await service.flush();

    const store = createStore();
    await store.commands.expand('call-big');

    expect(store.store.getState().expandedBodies.get('call-big')).toBe(body);
  });

  it('retains only the most recently expanded bodies, evicting the oldest', async () => {
    for (let i = 0; i < TOOL_RESULT_EXPANSION_LIMIT + 1; i += 1) {
      service.recordContent(
        toolResponseContent(`call-${i}`, `body-${i}-` + 'y'.repeat(2 * KIB)),
      );
    }
    await service.flush();

    const store = createStore();
    for (let i = 0; i < TOOL_RESULT_EXPANSION_LIMIT + 1; i += 1) {
      await store.commands.expand(`call-${i}`);
    }

    const bodies = store.store.getState().expandedBodies;
    expect(bodies.size).toBe(TOOL_RESULT_EXPANSION_LIMIT);
    expect(bodies.has('call-0')).toBe(false);
    expect(bodies.has(`call-${TOOL_RESULT_EXPANSION_LIMIT}`)).toBe(true);
  });

  it('purge drops every expanded body (no permanent re-retention)', async () => {
    service.recordContent(
      toolResponseContent('call-purge', largeBody('P', 300)),
    );
    await service.flush();

    const store = createStore();
    await store.commands.expand('call-purge');
    expect(store.store.getState().expandedBodies.size).toBe(1);

    store.commands.purge();
    expect(store.store.getState().expandedBodies.size).toBe(0);
  });

  it('leaves the map empty when the transcript has no such callId', async () => {
    service.recordContent(toolResponseContent('call-present', 'present body'));
    await service.flush();

    const store = createStore();
    await store.commands.expand('call-absent');

    expect(store.store.getState().expandedBodies.size).toBe(0);
  });

  it('keeps the cap constant at the stated small number', () => {
    expect(TOOL_RESULT_RETENTION_CAP_BYTES).toBe(64 * 1024);
    expect(TOOL_RESULT_EXPANSION_LIMIT).toBe(3);
  });
});
