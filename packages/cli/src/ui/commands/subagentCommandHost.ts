/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
} from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { SubagentCommandOperations } from './subagentCommand.js';

export function bindSubagentCommand(
  reads: SubagentDefinitionReads | undefined,
  writes: SubagentDefinitionWrites | undefined,
  listProfiles: () => Promise<string[]>,
  isFuzzyEnabled: () => boolean,
  generatePrompt: (description: string) => Promise<string>,
  isConfigured: boolean,
  addItem: UseHistoryManagerReturn['addItem'],
): SubagentCommandOperations {
  const requireReads = (): SubagentDefinitionReads => {
    if (!reads) throw new Error('Subagent definitions unavailable');
    return reads;
  };
  return {
    isAvailable: reads !== undefined && writes !== undefined,
    isConfigured,
    listSubagents: (...args) => requireReads().listSubagents(...args),
    loadSubagent: (...args) => requireReads().loadSubagent(...args),
    subagentExists: (...args) => requireReads().subagentExists(...args),
    subagentExistsOnDisk: (name) => requireReads().subagentExistsOnDisk(name),
    hasSettingsSubagent: (name) => requireReads().hasSettingsSubagent(name),
    validateProfileReference: (name) =>
      requireReads().validateProfileReference(name),
    saveSubagent: (name, profile, prompt) => {
      if (!writes) throw new Error('Subagent definitions unavailable');
      return writes.saveSubagent(name, profile, prompt);
    },
    listProfiles,
    isFuzzyEnabled,
    generatePrompt,
    addItem,
  };
}
