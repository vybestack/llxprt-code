/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { ModelChangeResult } from '@vybestack/llxprt-code-core';
import type { ToolFormatState } from '@vybestack/llxprt-code-agents';
import type { SlashCommand } from '../commands/types.js';
import { createModelCommand } from '../commands/modelCommand.js';
import { createToolFormatCommand } from '../commands/toolformatCommand.js';
type WriteToolFormat = Parameters<typeof createToolFormatCommand>[1];
export function useModelCommand(
  selectModel: (model: string) => Promise<ModelChangeResult>,
  recordProviderSwitch: (provider: string, model: string) => Promise<void>,
): SlashCommand {
  return useMemo(
    () => createModelCommand(selectModel, recordProviderSwitch),
    [selectModel, recordProviderSwitch],
  );
}

export function useToolFormatCommand(
  readToolFormat: () => Promise<ToolFormatState>,
  writeToolFormat: WriteToolFormat,
): SlashCommand {
  return useMemo(
    () => createToolFormatCommand(readToolFormat, writeToolFormat),
    [readToolFormat, writeToolFormat],
  );
}

export function useModelSelectionCommands(
  selectModel: Parameters<typeof useModelCommand>[0],
  readFormat: Parameters<typeof useToolFormatCommand>[0],
  writeFormat: Parameters<typeof useToolFormatCommand>[1],
  record: Parameters<typeof useModelCommand>[1],
) {
  return {
    modelCommand: useModelCommand(selectModel, record),
    toolFormatCommand: useToolFormatCommand(readFormat, writeFormat),
  };
}
