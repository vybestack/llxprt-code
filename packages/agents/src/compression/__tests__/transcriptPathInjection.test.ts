/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for issue #2933: when the CompressionContext carries a
 * session journal path, both LLM compression strategies must hand the
 * summarizing model the same accurate pointer to it.
 *
 * The strategies are real; only the LLM provider is substituted, and it is a
 * capture provider that records the request it actually received.
 */

import { describe, it, expect } from 'bun:test';
import type {
  CompressionContext,
  CompressionProviderResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildTranscriptPathNotice } from '@vybestack/llxprt-code-core/core/compression/transcriptPathNotice.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import {
  buildContext,
  createCaptureProvider,
  generateHistory,
  testProviderRuntime,
} from '../MiddleOutStrategy-test-helpers.js';

const JOURNAL_PATH = '/tmp/llxprt-chats/session-2026-08-22-abcd1234.jsonl';

/**
 * The notice text that precedes the path, derived from the builder rather than
 * hard-coded, so the absence checks stay tied to the real contract instead of
 * to a generic word that unrelated prompt text could contain.
 */
const NOTICE_PREFIX =
  buildTranscriptPathNotice(JOURNAL_PATH).split(JOURNAL_PATH)[0];

interface Strategy {
  compress(context: CompressionContext): Promise<unknown>;
}

/**
 * Runs a strategy end to end and returns the text of every message the
 * provider actually received.
 */
async function captureRequestText(
  strategy: Strategy,
  transcriptPath: string | undefined,
): Promise<string[]> {
  const captured: IContent[] = [];
  const provider = createCaptureProvider(captured);
  const base = buildContext({
    history: generateHistory(20),
    resolveProvider: (): CompressionProviderResult =>
      ({
        provider,
        runtime: testProviderRuntime,
      }) as unknown as CompressionProviderResult,
  });
  const context: CompressionContext = {
    ...base,
    ...(transcriptPath === undefined ? {} : { transcriptPath }),
  };

  await strategy.compress(context);

  return captured.flatMap((message) =>
    message.blocks
      .filter((block): block is { type: 'text'; text: string } =>
        Boolean(block.type === 'text' && 'text' in block),
      )
      .map((block) => block.text),
  );
}

function noticeIn(requestText: string[]): string | undefined {
  return requestText.find((text) => text.includes(JOURNAL_PATH));
}

describe('session journal notice injection (#2933)', () => {
  it('OneShotStrategy hands the journal path to the summarizing model', async () => {
    const requestText = await captureRequestText(
      new OneShotStrategy(),
      JOURNAL_PATH,
    );

    expect(noticeIn(requestText)).toBe(buildTranscriptPathNotice(JOURNAL_PATH));
  });

  it('MiddleOutStrategy hands the journal path to the summarizing model', async () => {
    const requestText = await captureRequestText(
      new MiddleOutStrategy(),
      JOURNAL_PATH,
    );

    expect(noticeIn(requestText)).toBe(buildTranscriptPathNotice(JOURNAL_PATH));
  });

  it('both strategies emit identical notice text so the wording cannot drift', async () => {
    const oneShotText = await captureRequestText(
      new OneShotStrategy(),
      JOURNAL_PATH,
    );
    const middleOutText = await captureRequestText(
      new MiddleOutStrategy(),
      JOURNAL_PATH,
    );

    const oneShotNotice = noticeIn(oneShotText);
    const middleOutNotice = noticeIn(middleOutText);
    expect(oneShotNotice).toBeDefined();
    expect(middleOutNotice).toBe(oneShotNotice as string);
  });

  it('OneShotStrategy sends no journal notice when no path is present', async () => {
    const requestText = await captureRequestText(
      new OneShotStrategy(),
      undefined,
    );

    expect(noticeIn(requestText)).toBeUndefined();
    expect(requestText.some((text) => text.includes(NOTICE_PREFIX))).toBe(
      false,
    );
  });

  it('MiddleOutStrategy sends no journal notice when no path is present', async () => {
    const requestText = await captureRequestText(
      new MiddleOutStrategy(),
      undefined,
    );

    expect(noticeIn(requestText)).toBeUndefined();
    expect(requestText.some((text) => text.includes(NOTICE_PREFIX))).toBe(
      false,
    );
  });
});
