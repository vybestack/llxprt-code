import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
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
  createSessionRecorder,
  type SessionRecordingPort,
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
  let service: SessionRecordingPort;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '3428-reader-'));
    service = createSessionRecorder({
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

  it('refuses a retired JSONL transcript instead of reading its body', async () => {
    const retired = path.join(tempDir, 'session-retired.jsonl');
    await fs.writeFile(
      retired,
      `${JSON.stringify({ type: 'content', payload: { content: toolResponseContent('retired', 'old body') } })}
`,
    );
    await expect(readToolResultBody(retired, 'retired')).rejects.toThrow(
      'retired JSONL journal format',
    );
  });

  it('returns undefined from a native session with no rows', async () => {
    service.recordSessionMetadata('empty native transcript');
    await service.flush();
    const file = service.getFilePath();
    if (file === null) throw new Error('Missing native transcript');
    expect(await readToolResultBody(file, 'absent')).toBeUndefined();
  });

  it('returns the exact original string body for a capped callId', async () => {
    const body = largeBody('STR', 300);
    await recordRowsForTest(service, [textContent('human', 'run the tool')]);
    await recordRowsForTest(service, [toolResponseContent('call-str', body)]);
    await recordRowsForTest(service, [textContent('ai', 'done')]);
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-str');
    expect(result).toBe(body);
  });

  it('pretty-prints object results the way the replay path displays them', async () => {
    const payload = { ok: true, rows: [1, 2, 3], note: 'hello' };
    await recordRowsForTest(service, [
      toolResponseContent('call-obj', payload),
    ]);
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-obj');
    expect(result).toBe(JSON.stringify(payload, null, 2));
  });

  it('returns undefined for a callId that is not in the transcript', async () => {
    await recordRowsForTest(service, [
      toolResponseContent('call-str', 'present'),
    ]);
    await service.flush();

    expect(
      await readToolResultBody(service.getFilePath()!, 'call-missing'),
    ).toBeUndefined();
  });

  it('finds the matching response in a long session without confusing callIds', async () => {
    for (let i = 0; i < 40; i += 1) {
      await recordRowsForTest(service, [
        toolResponseContent(`call-${i}`, `body-${i}-` + 'y'.repeat(2 * KIB)),
      ]);
    }
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-17');
    expect(result).toBe('body-17-' + 'y'.repeat(2 * KIB));
  });

  it('returns the body for the LAST response when a callId repeats', async () => {
    // Tools can retry; replay shows the latest response, so expansion must
    // agree with it rather than resurrecting a superseded body.
    await recordRowsForTest(service, [
      toolResponseContent('call-dup', 'first attempt'),
    ]);
    await recordRowsForTest(service, [
      toolResponseContent('call-dup', 'second attempt'),
    ]);
    await service.flush();

    const result = await readToolResultBody(service.getFilePath()!, 'call-dup');
    expect(result).toBe('second attempt');
  });
});
