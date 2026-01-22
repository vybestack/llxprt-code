/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { modelCommand } from '../../../src/ui/commands/modelCommand.js';
import {
  CommandContext,
  OpenDialogActionReturn,
  MessageActionReturn,
  ModelsDialogData,
} from '../../../src/ui/commands/types.js';
import { LoadedSettings } from '../../../src/config/settings.js';
import { Logger } from '@vybestack/llxprt-code-core';
import { SessionStatsState } from '../../../src/ui/contexts/SessionContext.js';

// Mock the RuntimeContext
const mockSetActiveModel = vi.fn();
vi.mock('../../../src/ui/contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    setActiveModel: mockSetActiveModel,
  }),
}));

// Create mock command context
function createMockContext(): CommandContext {
  return {
    services: {
      config: null,
      settings: {} as LoadedSettings,
      git: undefined,
      logger: {} as Logger,
    },
    ui: {
      addItem: vi.fn(),
      clear: vi.fn(),
      setDebugMessage: vi.fn(),
      pendingItem: null,
      setPendingItem: vi.fn(),
      loadHistory: vi.fn(),
      toggleCorgiMode: vi.fn(),
      toggleVimEnabled: vi.fn().mockResolvedValue(true),
      setLlxprtMdFileCount: vi.fn(),
      reloadCommands: vi.fn(),
    },
    session: {
      stats: {} as SessionStatsState,
      sessionShellAllowlist: new Set(),
    },
  };
}

describe('modelCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = createMockContext();
    vi.clearAllMocks();
  });

  describe('command metadata', () => {
    it('has correct name', () => {
      expect(modelCommand.name).toBe('model');
    });

    it('has description', () => {
      expect(modelCommand.description).toBeDefined();
      expect(modelCommand.description.length).toBeGreaterThan(0);
    });
  });

  describe('dialog action return (no args)', () => {
    it('returns dialog type with models dialog', async () => {
      const result = (await modelCommand.action(
        context,
        '',
      )) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
      expect(result.dialog).toBe('models');
    });

    it('returns dialogData object', async () => {
      const result = (await modelCommand.action(
        context,
        '',
      )) as OpenDialogActionReturn;
      expect(result.dialogData).toBeDefined();
    });

    it('returns empty filters when no args', async () => {
      const result = (await modelCommand.action(
        context,
        '',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBeUndefined();
      expect(data.initialFilters).toEqual({
        tools: false,
        vision: false,
        reasoning: false,
        audio: false,
      });
      expect(data.includeDeprecated).toBe(false);
    });
  });

  describe('direct switch (positional arg only)', () => {
    it('switches model directly when only positional arg', async () => {
      mockSetActiveModel.mockResolvedValue({
        previousModel: 'gpt-4',
        nextModel: 'gpt-4o',
        providerName: 'openai',
      });

      const result = (await modelCommand.action(
        context,
        'gpt-4o',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Switched from gpt-4 to gpt-4o');
      expect(mockSetActiveModel).toHaveBeenCalledWith('gpt-4o');
    });

    it('returns error message on switch failure', async () => {
      mockSetActiveModel.mockRejectedValue(new Error('Model not found'));

      const result = (await modelCommand.action(
        context,
        'invalid-model',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Failed to switch model');
      expect(result.content).toContain('Model not found');
    });

    it('handles unknown previous model', async () => {
      mockSetActiveModel.mockResolvedValue({
        previousModel: null,
        nextModel: 'gpt-4o',
        providerName: 'openai',
      });

      const result = (await modelCommand.action(
        context,
        'gpt-4o',
      )) as MessageActionReturn;

      expect(result.content).toContain('Switched from unknown to gpt-4o');
    });
  });

  describe('dialog with flags (positional + flags)', () => {
    it('opens dialog when positional arg has flags', async () => {
      const result = (await modelCommand.action(
        context,
        'gpt-4o --tools',
      )) as OpenDialogActionReturn;

      expect(result.type).toBe('dialog');
      expect(result.dialog).toBe('models');
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('gpt-4o');
      expect(data.initialFilters?.tools).toBe(true);
      expect(mockSetActiveModel).not.toHaveBeenCalled();
    });

    it('opens dialog with provider flag only', async () => {
      const result = (await modelCommand.action(
        context,
        '--provider openai',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.providerOverride).toBe('openai');
    });

    it('opens dialog with search and provider', async () => {
      const result = (await modelCommand.action(
        context,
        'claude --provider anthropic',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('claude');
      expect(data.providerOverride).toBe('anthropic');
    });
  });

  describe('capability filter parsing', () => {
    it('parses --tools flag', async () => {
      const result = (await modelCommand.action(
        context,
        '--tools',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.vision).toBe(false);
      expect(data.initialFilters?.reasoning).toBe(false);
      expect(data.initialFilters?.audio).toBe(false);
    });

    it('parses -t short flag', async () => {
      const result = (await modelCommand.action(
        context,
        '-t',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
    });

    it('parses --vision flag', async () => {
      const result = (await modelCommand.action(
        context,
        '--vision',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.vision).toBe(true);
    });

    it('parses --reasoning flag', async () => {
      const result = (await modelCommand.action(
        context,
        '--reasoning',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.reasoning).toBe(true);
    });

    it('parses -r short flag', async () => {
      const result = (await modelCommand.action(
        context,
        '-r',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.reasoning).toBe(true);
    });

    it('parses --audio flag', async () => {
      const result = (await modelCommand.action(
        context,
        '--audio',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.audio).toBe(true);
    });

    it('parses -a short flag', async () => {
      const result = (await modelCommand.action(
        context,
        '-a',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.audio).toBe(true);
    });

    it('parses multiple capability flags', async () => {
      const result = (await modelCommand.action(
        context,
        '--tools --vision --reasoning',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.vision).toBe(true);
      expect(data.initialFilters?.reasoning).toBe(true);
      expect(data.initialFilters?.audio).toBe(false);
    });
  });

  describe('--all flag parsing', () => {
    it('parses --all flag to showAllProviders', async () => {
      const result = (await modelCommand.action(
        context,
        '--all',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.showAllProviders).toBe(true);
    });

    it('defaults includeDeprecated to false', async () => {
      const result = (await modelCommand.action(
        context,
        '',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.includeDeprecated).toBe(false);
    });
  });

  describe('combined args parsing', () => {
    it('parses search term with tools filter (opens dialog)', async () => {
      const result = (await modelCommand.action(
        context,
        'gpt --tools',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('gpt');
      expect(data.initialFilters?.tools).toBe(true);
    });

    it('parses provider with reasoning and all', async () => {
      const result = (await modelCommand.action(
        context,
        '-p openai -r --all',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.providerOverride).toBe('openai');
      expect(data.initialFilters?.reasoning).toBe(true);
      expect(data.showAllProviders).toBe(true);
    });

    it('parses all capability flags together', async () => {
      const result = (await modelCommand.action(
        context,
        '-t -r -a --vision',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.vision).toBe(true);
      expect(data.initialFilters?.reasoning).toBe(true);
      expect(data.initialFilters?.audio).toBe(true);
    });
  });

  describe('ignored flags', () => {
    it('ignores --limit flag (value becomes search term, triggers direct switch)', async () => {
      // --limit is ignored, but 10 becomes search term triggering direct switch
      mockSetActiveModel.mockRejectedValue(new Error('Model not found'));
      const result = (await modelCommand.action(
        context,
        '--limit 10',
      )) as MessageActionReturn;
      expect(result.type).toBe('message');
      expect(mockSetActiveModel).toHaveBeenCalledWith('10');
    });

    it('ignores -l short flag (value becomes search term, triggers direct switch)', async () => {
      // -l is ignored, but 5 becomes search term triggering direct switch
      mockSetActiveModel.mockRejectedValue(new Error('Model not found'));
      const result = (await modelCommand.action(
        context,
        '-l 5',
      )) as MessageActionReturn;
      expect(result.type).toBe('message');
      expect(mockSetActiveModel).toHaveBeenCalledWith('5');
    });

    it('ignores --verbose flag', async () => {
      const result = (await modelCommand.action(
        context,
        '--verbose',
      )) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
    });

    it('ignores -v short flag', async () => {
      const result = (await modelCommand.action(
        context,
        '-v',
      )) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
    });

    it('ignores unknown flags (value becomes search term, triggers direct switch)', async () => {
      // --unknown-flag is ignored, but value becomes search term triggering direct switch
      mockSetActiveModel.mockRejectedValue(new Error('Model not found'));
      const result = (await modelCommand.action(
        context,
        '--unknown-flag value',
      )) as MessageActionReturn;
      expect(result.type).toBe('message');
      expect(mockSetActiveModel).toHaveBeenCalledWith('value');
    });
  });

  describe('example command args', () => {
    it('/model --tools --provider openai', async () => {
      const result = (await modelCommand.action(
        context,
        '--tools --provider openai',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.providerOverride).toBe('openai');
      expect(data.initialFilters?.tools).toBe(true);
    });

    it('/model --tools --reasoning', async () => {
      const result = (await modelCommand.action(
        context,
        '--tools --reasoning',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.reasoning).toBe(true);
    });

    it('/model gpt-4o (direct switch)', async () => {
      mockSetActiveModel.mockResolvedValue({
        previousModel: 'gpt-4',
        nextModel: 'gpt-4o',
        providerName: 'openai',
      });

      const result = (await modelCommand.action(
        context,
        'gpt-4o',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(mockSetActiveModel).toHaveBeenCalledWith('gpt-4o');
    });

    it('/model claude --vision (opens dialog with search + filter)', async () => {
      const result = (await modelCommand.action(
        context,
        'claude --vision',
      )) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('claude');
      expect(data.initialFilters?.vision).toBe(true);
    });
  });
});
