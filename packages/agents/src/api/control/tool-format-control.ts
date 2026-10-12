/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

export interface ToolFormatState {
  providerName: string;
  currentFormat: string | null;
  override: string | null;
  isAutoDetected: boolean;
}

export type ToolFormatOverrideLiteral =
  | 'auto'
  | 'openai'
  | 'qwen'
  | 'kimi'
  | 'hermes'
  | 'xml'
  | 'anthropic'
  | 'deepseek'
  | 'gemma'
  | 'llama';

export interface AgentToolFormatControl {
  getState(): Promise<ToolFormatState>;
  setOverride(
    format: ToolFormatOverrideLiteral | null,
  ): Promise<ToolFormatState>;
}

export function assembleToolFormatControl(
  readOwner: () => Pick<
    SessionSettingsOwner,
    'readToolFormat' | 'writeToolFormat'
  >,
  readProvider: RuntimeProviderManager['getActiveProvider'],
  assertReadAdmission: () => void,
  assertWriteAdmission: () => void,
): AgentToolFormatControl {
  const getState = async (): Promise<ToolFormatState> => {
    assertReadAdmission();
    const provider = readProvider();
    if (!provider) throw new Error('No active provider is configured.');
    const raw = readOwner().readToolFormat();
    const override = typeof raw === 'string' ? raw : 'auto';
    const isAutoDetected = !override || override === 'auto';
    return {
      providerName: provider.name,
      currentFormat: isAutoDetected
        ? (provider.getToolFormat?.() ?? null)
        : override,
      override: isAutoDetected ? null : override,
      isAutoDetected,
    };
  };
  return {
    getState,
    setOverride: async (format) => {
      assertWriteAdmission();
      if (!readProvider()) throw new Error('No active provider is configured.');
      await readOwner().writeToolFormat(
        !format || format === 'auto' ? 'auto' : format,
      );
      return getState();
    },
  };
}
