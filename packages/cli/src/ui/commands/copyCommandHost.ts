/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentMessage } from '@vybestack/llxprt-code-agents';
import { copyToClipboard } from '../utils/commandUtils.js';
import type { CopyCommandOutput } from './copyCommand.js';

export function bindCopyCommandHistoryRead(
  hasChatInitialized: () => boolean,
  getHistory: () => Promise<readonly AgentMessage[]>,
): () => Promise<CopyCommandOutput> {
  return async (): Promise<CopyCommandOutput> => {
    if (!hasChatInitialized()) return { kind: 'no-chat' };

    const history = await getHistory();
    const lastAiMessage = [...history]
      .reverse()
      .find((item) => item.speaker === 'ai');
    if (lastAiMessage == null) return { kind: 'no-output' };

    const text = lastAiMessage.blocks
      .filter(
        (block): block is { type: 'text'; text: string } =>
          block.type === 'text',
      )
      .map((block) => block.text)
      .join('');
    return text.length === 0 ? { kind: 'empty' } : { kind: 'text', text };
  };
}

export function bindCopyCommandClipboard(
  copy: (text: string) => Promise<void> = copyToClipboard,
): (text: string) => Promise<void> {
  return copy;
}
