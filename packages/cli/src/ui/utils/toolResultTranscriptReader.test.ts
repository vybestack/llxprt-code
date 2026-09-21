/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SessionRecordingService,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { readToolResultBody } from './toolResultTranscriptReader.js';

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

function textContent(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

describe('readToolResultBody — transcript-backed expansion (issue #3428)', () => {
  let tempDir: string;
  let service: SessionRecordingService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '3428-reader-'));
    service = new SessionRecordingService({
      sessionId: 'test-session-3428',
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

  it('returns the exact original string body for a capped callId', async () => {
    const body = largeBody('STR', 300);
    service.recordContent(textContent('human', 'run the tool'));
    service.recordContent(toolResponseContent('call-str', body));
    service.recordContent(textContent('ai', 'done'));
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-str');
    expect(result).toBe(body);
  });

  it('pretty-prints object results the way the replay path displays them', async () => {
    const payload = { ok: true, rows: [1, 2, 3], note: 'hello' };
    service.recordContent(toolResponseContent('call-obj', payload));
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-obj');
    expect(result).toBe(JSON.stringify(payload, null, 2));
  });

  it('returns undefined for a callId that is not in the transcript', async () => {
    service.recordContent(toolResponseContent('call-str', 'present'));
    await service.flush();

    expect(
      await readToolResultBody(service.getFilePath()!, 'call-missing'),
    ).toBeUndefined();
  });

  it('finds the matching response in a long session without confusing callIds', async () => {
    for (let i = 0; i < 40; i += 1) {
      service.recordContent(
        toolResponseContent(`call-${i}`, `body-${i}-` + 'y'.repeat(2 * KIB)),
      );
    }
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-17');
    expect(result).toBe('body-17-' + 'y'.repeat(2 * KIB));
  });

  it('returns the body for the LAST response when a callId repeats', async () => {
    // Tools can retry; replay shows the latest response, so expansion must
    // agree with it rather than resurrecting a superseded body.
    service.recordContent(toolResponseContent('call-dup', 'first attempt'));
    service.recordContent(toolResponseContent('call-dup', 'second attempt'));
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-dup');
    expect(result).toBe('second attempt');
  });
});
