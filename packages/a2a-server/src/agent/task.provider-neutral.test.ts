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

import { describe, it, expect, beforeEach } from 'bun:test';
import { Task } from './task.js';
import { createMockConfig } from '../utils/testing_utils.js';
import {
  UNCONFIGURED_PROVIDER,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import type {
  AgentClientContract,
  AgentRuntimeState,
  Config,
} from '@vybestack/llxprt-code-core';

const capturedRuntimeStates: Array<{ provider: string; model: string }> = [];

function captureAgentClientFactory(
  _config: Config,
  runtimeState: AgentRuntimeState,
): AgentClientContract {
  capturedRuntimeStates.push({
    provider: runtimeState.provider,
    model: runtimeState.model,
  });
  return {
    getUserTier: () => undefined,
    addHistory: () => Promise.resolve(undefined),
    sendMessageStream: () => (async function* () {})(),
    initialize: () => Promise.resolve(undefined),
  } as unknown as AgentClientContract;
}

const taskDependencies = { agentClientFactory: captureAgentClientFactory };

describe('Task: provider-neutral default (not gemini)', () => {
  beforeEach(() => {
    capturedRuntimeStates.length = 0;
  });

  it('passes UNCONFIGURED_PROVIDER sentinel (not gemini) to createAgentClient when config has no provider set', async () => {
    const mockConfig = createMockConfig({
      getProvider: () => undefined,
      getModel: () => '',
      getContentGeneratorConfig: () => undefined,
    });

    await Task.create(
      'task-id',
      'context-id',
      mockConfig as never,
      undefined,
      undefined,
      taskDependencies,
    );

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].provider).toBe(UNCONFIGURED_PROVIDER);
    expect(capturedRuntimeStates[0].provider).not.toBe('gemini');
  });

  it('passes PLACEHOLDER_MODEL (not gemini-pro) to createAgentClient when no model is configured', async () => {
    const mockConfig = createMockConfig({
      getProvider: () => undefined,
      getModel: () => '',
      getContentGeneratorConfig: () => undefined,
    });

    await Task.create(
      'task-id',
      'context-id',
      mockConfig as never,
      undefined,
      undefined,
      taskDependencies,
    );

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].model).toBe(PLACEHOLDER_MODEL);
    expect(capturedRuntimeStates[0].model).not.toBe('gemini-pro');
  });

  it('passes an explicit provider through to createAgentClient', async () => {
    const mockConfig = createMockConfig({
      getProvider: () => 'openai',
      getModel: () => 'gpt-4o',
      getContentGeneratorConfig: () => ({ model: 'gpt-4o' }),
    });

    await Task.create(
      'task-id',
      'context-id',
      mockConfig as never,
      undefined,
      undefined,
      taskDependencies,
    );

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].provider).toBe('openai');
    expect(capturedRuntimeStates[0].model).toBe('gpt-4o');
  });

  it('treats whitespace-only provider as UNCONFIGURED_PROVIDER', async () => {
    const mockConfig = createMockConfig({
      getProvider: () => '   ',
      getModel: () => '',
      getContentGeneratorConfig: () => undefined,
    });

    await Task.create(
      'task-id',
      'context-id',
      mockConfig as never,
      undefined,
      undefined,
      taskDependencies,
    );

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].provider).toBe(UNCONFIGURED_PROVIDER);
  });

  it('treats empty-string provider as UNCONFIGURED_PROVIDER', async () => {
    const mockConfig = createMockConfig({
      getProvider: () => '',
      getModel: () => '',
      getContentGeneratorConfig: () => undefined,
    });

    await Task.create(
      'task-id',
      'context-id',
      mockConfig as never,
      undefined,
      undefined,
      taskDependencies,
    );

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].provider).toBe(UNCONFIGURED_PROVIDER);
  });

  it('trims a padded explicit provider before passing to createAgentClient', async () => {
    capturedRuntimeStates.length = 0;

    const mockConfig = createMockConfig({
      getProvider: () => '  openai  ',
      getModel: () => 'gpt-4o',
      getContentGeneratorConfig: () => ({ model: 'gpt-4o' }),
    });

    await Task.create(
      'task-id',
      'context-id',
      mockConfig as never,
      undefined,
      undefined,
      taskDependencies,
    );

    expect(capturedRuntimeStates.length).toBe(1);
    expect(capturedRuntimeStates[0].provider).toBe('openai');
  });
});
