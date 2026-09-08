/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { GenerateChatOptions } from '../IProvider.js';

export async function* generatePartialThenInterruptedResponse(
  recordAttempt: () => number,
): AsyncGenerator<IContent> {
  if (recordAttempt() === 1) {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'partial' }],
    } as IContent;
    const error = new Error('Connection reset') as Error & { code?: string };
    error.code = 'STREAM_INTERRUPTED';
    throw error;
  }
  yield {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'complete' }],
  } as IContent;
}

export async function* generateTimeoutThenSuccess(
  recordAttempt: () => number,
): AsyncGenerator<IContent> {
  if (recordAttempt() === 1) {
    await delay(200);
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'too slow' }],
    } as IContent;
  } else {
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'success' }],
    } as IContent;
  }
}

export async function* generateAbortAwareResponse(
  options: GenerateChatOptions,
  recordCall: () => void,
  captureOptions: (options: GenerateChatOptions) => void,
): AsyncGenerator<IContent> {
  recordCall();
  captureOptions(options);
  await delay(50);
  if (options.invocation?.signal?.aborted === true) {
    throw new DOMException('Aborted', 'AbortError');
  }
  yield {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'test' }],
  } as IContent;
}
