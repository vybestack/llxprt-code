/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider } from '../IProvider.js';

describe('RetryOrchestrator.getContextLimit() delegation (issue #2251)', () => {
  it('delegates getContextLimit to the wrapped provider when present', () => {
    const provider: IProvider = {
      name: 'delegating-provider',
      getContextLimit: () => 200_000,
      async getModels() {
        return [];
      },
      getDefaultModel() {
        return 'test-model';
      },
      getServerTools() {
        return [];
      },
      async invokeServerTool() {
        return null;
      },
      async *generateChatCompletion() {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
    };

    const orchestrator = new RetryOrchestrator(provider);

    expect(orchestrator.getContextLimit?.()).toBe(200_000);
  });

  it('returns undefined when the wrapped provider lacks getContextLimit', () => {
    const provider: IProvider = {
      name: 'no-context-limit-provider',
      async getModels() {
        return [];
      },
      getDefaultModel() {
        return 'test-model';
      },
      getServerTools() {
        return [];
      },
      async invokeServerTool() {
        return null;
      },
      async *generateChatCompletion() {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
    };

    const orchestrator = new RetryOrchestrator(provider);

    expect(orchestrator.getContextLimit?.()).toBeUndefined();
  });
});
