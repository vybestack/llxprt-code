/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving the A2A Task request path does NOT default to
 * 'gemini' as the provider. When config.getProvider() returns undefined
 * (unconfigured), the Task must use the neutral sentinel
 * UNCONFIGURED_PROVIDER — not 'gemini'.
 */

import { describe, it, expect, vi } from 'bun:test';
import { Task } from './task.js';
import { createMockConfig } from '../utils/testing_utils.js';
import {
  UNCONFIGURED_PROVIDER,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core';

const capturedRuntimeStates: Array<{ provider: string; model: string }> = [];

void vi.mock('@vybestack/llxprt-code-agents', () => ({
  createAgentClient: vi.fn((_, runtimeState) => {
    capturedRuntimeStates.push({
      provider: runtimeState.provider,
      model: runtimeState.model,
    });
    return {
      getUserTier: () => undefined,
      addHistory: () => Promise.resolve(undefined),
      sendMessageStream: () => {},
    } as unknown as AgentClientContract;
  }),
}));

describe('Task: provider-neutral default (not gemini)', () => {
  it('passes UNCONFIGURED_PROVIDER sentinel (not gemini) to createAgentClient when config has no provider set', async () => {
    capturedRuntimeStates.length = 0;

    const mockConfig = createMockConfig({
      getProvider: () => undefined,
      getModel: () => '',
      getContentGeneratorConfig: () => undefined,
    });

    await Task.create('task-id', 'context-id', mockConfig as never, undefined);

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].provider).toBe(UNCONFIGURED_PROVIDER);
    expect(capturedRuntimeStates[0].provider).not.toBe('gemini');
  });

  it('passes PLACEHOLDER_MODEL (not gemini-pro) to createAgentClient when no model is configured', async () => {
    capturedRuntimeStates.length = 0;

    const mockConfig = createMockConfig({
      getProvider: () => undefined,
      getModel: () => '',
      getContentGeneratorConfig: () => undefined,
    });

    await Task.create('task-id', 'context-id', mockConfig as never, undefined);

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].model).toBe(PLACEHOLDER_MODEL);
    expect(capturedRuntimeStates[0].model).not.toBe('gemini-pro');
  });

  it('passes an explicit provider through to createAgentClient', async () => {
    capturedRuntimeStates.length = 0;

    const mockConfig = createMockConfig({
      getProvider: () => 'openai',
      getModel: () => 'gpt-4o',
      getContentGeneratorConfig: () => ({ model: 'gpt-4o' }),
    });

    await Task.create('task-id', 'context-id', mockConfig as never, undefined);

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].provider).toBe('openai');
    expect(capturedRuntimeStates[0].model).toBe('gpt-4o');
  });
});
