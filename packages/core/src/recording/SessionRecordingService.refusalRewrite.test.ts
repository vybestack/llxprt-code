/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: a reviewed rewrite of refused context is a mutating
 * `refusal_rewrite` journal record. Replay installs the recorded resulting
 * history; the original text stays in the record only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import type { RefusalRewritePayload } from './types.js';
import {
  assertReplayOk,
  makeContent,
} from './__tests__/replay-test-helpers.js';

const PROJECT_HASH = 'refusal-rewrite-project';
const ORIGINAL = 'The agent kills surviving mutants in src/a.ts';
const REWRITTEN = 'The agent terminates surviving mutants in src/a.ts';

function summary(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { isSummary: true },
  };
}

function rewritePayload(
  resultingHistory: readonly IContent[],
): RefusalRewritePayload {
  return {
    operationId: 'op-1',
    time: '2026-11-12T10:00:00.000Z',
    promptId: 'prompt-1',
    attemptIndex: 2,
    reviewer: {
      profile: 'sonnet-reviewer',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    },
    explanation: 'Plain wording for a mutation-testing summary.',
    changes: [
      {
        id: 'c1.0',
        role: 'human',
        kind: 'summary',
        originalText: ORIGINAL,
        newText: REWRITTEN,
      },
    ],
    resultingHistory,
  };
}

/** Journals a rewrite the way RecordingIntegration does: drain, then commit. */
async function appendRewrite(
  service: SessionRecordingService,
  payload: RefusalRewritePayload,
): Promise<void> {
  await service.flush();
  const prepared = service.prepareRefusalRewrite(payload);
  prepared.publish();
  await prepared.finalize();
}

function textsOf(history: readonly IContent[]): string[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'text' ? [block.text] : [],
    ),
  );
}

describe('refusal_rewrite journal record (issue #4036)', () => {
  let chatsDir: string;
  const services: SessionRecordingService[] = [];

  beforeEach(async () => {
    chatsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-rewrite-'));
  });

  afterEach(async () => {
    for (const service of services.splice(0)) await service.dispose();
    await fs.rm(chatsDir, { recursive: true, force: true });
  });

  function createService(): SessionRecordingService {
    const service = new SessionRecordingService({
      sessionId: 'rewrite-session-0001',
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
    services.push(service);
    return service;
  }

  async function recordTypes(
    service: SessionRecordingService,
  ): Promise<string[]> {
    const filePath = service.getFilePath();
    if (filePath === null) return [];
    return (await fs.readFile(filePath, 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { type: string }).type);
  }

  it('replays to the recorded resulting history without the original text', async () => {
    const service = createService();
    service.recordContent(summary(ORIGINAL));
    service.recordContent(makeContent('continue', 'ai'));
    const resulting = [summary(REWRITTEN), makeContent('continue', 'ai')];
    await appendRewrite(service, rewritePayload(resulting));
    service.recordContent(makeContent('next question', 'human'));
    await service.flush();

    const result = await replaySession(service.getFilePath()!, PROJECT_HASH);

    assertReplayOk(result);
    expect({
      texts: textsOf(result.history),
      hasOriginal: JSON.stringify(result.history).includes(ORIGINAL),
      warnings: result.warnings,
    }).toStrictEqual({
      texts: [REWRITTEN, 'continue', 'next question'],
      hasOriginal: false,
      warnings: [],
    });
  });

  it('keeps the original text in the record itself', async () => {
    const service = createService();
    service.recordContent(summary(ORIGINAL));
    await appendRewrite(service, rewritePayload([summary(REWRITTEN)]));
    await service.flush();

    const written = await fs.readFile(service.getFilePath()!, 'utf-8');

    expect(written).toContain(`"originalText":"${ORIGINAL}"`);
  });

  it('materializes a session whose first event is the rewrite', async () => {
    const service = createService();

    await appendRewrite(service, rewritePayload([summary(REWRITTEN)]));
    await service.flush();

    expect(await recordTypes(service)).toStrictEqual([
      'session_start',
      'refusal_rewrite',
    ]);
  });

  it('writes a prepared rewrite once it is published and finalized', async () => {
    const service = createService();
    service.recordContent(summary(ORIGINAL));
    await service.flush();
    const prepared = service.prepareRefusalRewrite(
      rewritePayload([summary(REWRITTEN)]),
    );

    prepared.publish();
    await prepared.finalize();
    await service.flush();

    expect(await recordTypes(service)).toStrictEqual([
      'session_start',
      'content',
      'refusal_rewrite',
    ]);
  });

  it('writes nothing for a prepared rewrite that is rolled back', async () => {
    const service = createService();
    service.recordContent(summary(ORIGINAL));
    await service.flush();
    const prepared = service.prepareRefusalRewrite(
      rewritePayload([summary(REWRITTEN)]),
    );

    prepared.publish();
    prepared.rollback();
    service.recordContent(makeContent('after', 'human'));
    await service.flush();

    expect(await recordTypes(service)).toStrictEqual([
      'session_start',
      'content',
      'content',
    ]);
  });

  it('keeps a published rewrite off disk while another write drains, until it is finalized', async () => {
    const service = createService();
    service.recordContent(summary(ORIGINAL));
    await service.flush();
    const prepared = service.prepareRefusalRewrite(
      rewritePayload([summary(REWRITTEN)]),
    );

    prepared.publish();
    service.recordContent(makeContent('during', 'human'));
    await service.flush();
    const beforeFinalize = await recordTypes(service);
    await prepared.finalize();
    await service.flush();

    expect({
      beforeFinalize,
      afterFinalize: await recordTypes(service),
    }).toStrictEqual({
      beforeFinalize: ['session_start', 'content'],
      afterFinalize: ['session_start', 'content', 'refusal_rewrite', 'content'],
    });
  });

  it('never writes a rewrite that is rolled back after another write drained', async () => {
    const service = createService();
    service.recordContent(summary(ORIGINAL));
    await service.flush();
    const prepared = service.prepareRefusalRewrite(
      rewritePayload([summary(REWRITTEN)]),
    );

    prepared.publish();
    service.recordContent(makeContent('during', 'human'));
    await service.flush();
    prepared.rollback();
    await service.flush();

    expect(await recordTypes(service)).toStrictEqual([
      'session_start',
      'content',
      'content',
    ]);
  });

  it('reports a rewrite record with an invalid payload as malformed and keeps history', async () => {
    const service = createService();
    service.recordContent(summary(ORIGINAL));
    await service.flush();
    const filePath = service.getFilePath()!;
    const malformed = JSON.stringify({
      v: 2,
      seq: 3,
      ts: '2026-11-12T10:00:00.000Z',
      type: 'refusal_rewrite',
      payload: { operationId: 'op-1', resultingHistory: 'not a history' },
    });
    await fs.appendFile(filePath, `${malformed}\n`);

    const result = await replaySession(filePath, PROJECT_HASH);

    assertReplayOk(result);
    expect({
      malformedReported: result.warnings.some((warning) =>
        warning.includes('malformed refusal_rewrite'),
      ),
      texts: textsOf(result.history),
    }).toStrictEqual({ malformedReported: true, texts: [ORIGINAL] });
  });
});
