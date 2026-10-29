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
  getHistory: () => AsyncIterable<AgentMessage>,
): () => Promise<CopyCommandOutput> {
  return async (): Promise<CopyCommandOutput> => {
    if (!hasChatInitialized()) return { kind: 'no-chat' };

    let text: string | undefined;
    for await (const item of getHistory()) {
      if (item.speaker !== 'ai') continue;
      text = '';
      for (const block of item.blocks) {
        if (block.type === 'text') text += block.text;
      }
    }
    if (text === undefined) return { kind: 'no-output' };

    return text.length === 0 ? { kind: 'empty' } : { kind: 'text', text };
  };
}

export function bindCopyCommandClipboard(
  copy: (text: string) => Promise<void> = copyToClipboard,
): (text: string) => Promise<void> {
  return copy;
}
