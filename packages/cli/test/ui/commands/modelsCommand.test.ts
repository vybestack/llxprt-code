/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { modelsCommand } from '../../../src/ui/commands/modelsCommand.js';
import {
  CommandContext,
  OpenDialogActionReturn,
  ModelsDialogData,
} from '../../../src/ui/commands/types.js';
import { LoadedSettings } from '../../../src/config/settings.js';
import { Logger } from '@vybestack/llxprt-code-core';
import { SessionStatsState } from '../../../src/ui/contexts/SessionContext.js';

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

describe('modelsCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = createMockContext();
    vi.clearAllMocks();
  });

  describe('command metadata', () => {
    it('has correct name', () => {
      expect(modelsCommand.name).toBe('models');
    });

    it('has description', () => {
      expect(modelsCommand.description).toBeDefined();
      expect(modelsCommand.description.length).toBeGreaterThan(0);
    });
  });

  describe('dialog action return', () => {
    it('returns dialog type with models dialog', () => {
      const result = modelsCommand.action(
        context,
        '',
      ) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
      expect(result.dialog).toBe('models');
    });

    it('returns dialogData object', () => {
      const result = modelsCommand.action(
        context,
        '',
      ) as OpenDialogActionReturn;
      expect(result.dialogData).toBeDefined();
    });

    it('returns empty filters when no args', () => {
      const result = modelsCommand.action(
        context,
        '',
      ) as OpenDialogActionReturn;
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

  describe('search term parsing', () => {
    it('parses positional search term', () => {
      const result = modelsCommand.action(
        context,
        'gpt-4',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('gpt-4');
    });

    it('parses search term with provider flag', () => {
      const result = modelsCommand.action(
        context,
        '--provider openai',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      // provider sets providerOverride, not initialSearch
      expect(data.providerOverride).toBe('openai');
    });

    it('prioritizes search term over provider', () => {
      const result = modelsCommand.action(
        context,
        'claude --provider anthropic',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      // search takes priority
      expect(data.initialSearch).toBe('claude');
    });
  });

  describe('capability filter parsing', () => {
    it('parses --tools flag', () => {
      const result = modelsCommand.action(
        context,
        '--tools',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.vision).toBe(false);
      expect(data.initialFilters?.reasoning).toBe(false);
      expect(data.initialFilters?.audio).toBe(false);
    });

    it('parses -t short flag', () => {
      const result = modelsCommand.action(
        context,
        '-t',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
    });

    it('parses --vision flag', () => {
      const result = modelsCommand.action(
        context,
        '--vision',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.vision).toBe(true);
    });

    it('parses --reasoning flag', () => {
      const result = modelsCommand.action(
        context,
        '--reasoning',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.reasoning).toBe(true);
    });

    it('parses -r short flag', () => {
      const result = modelsCommand.action(
        context,
        '-r',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.reasoning).toBe(true);
    });

    it('parses --audio flag', () => {
      const result = modelsCommand.action(
        context,
        '--audio',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.audio).toBe(true);
    });

    it('parses -a short flag', () => {
      const result = modelsCommand.action(
        context,
        '-a',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.audio).toBe(true);
    });

    it('parses multiple capability flags', () => {
      const result = modelsCommand.action(
        context,
        '--tools --vision --reasoning',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.vision).toBe(true);
      expect(data.initialFilters?.reasoning).toBe(true);
      expect(data.initialFilters?.audio).toBe(false);
    });
  });

  describe('--all flag parsing', () => {
    it('parses --all flag to showAllProviders', () => {
      const result = modelsCommand.action(
        context,
        '--all',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      // --all shows all providers, not deprecated models
      expect(data.showAllProviders).toBe(true);
    });

    it('defaults includeDeprecated to false', () => {
      const result = modelsCommand.action(
        context,
        '',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.includeDeprecated).toBe(false);
    });
  });

  describe('combined args parsing', () => {
    it('parses search term with tools filter', () => {
      const result = modelsCommand.action(
        context,
        'gpt --tools',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('gpt');
      expect(data.initialFilters?.tools).toBe(true);
    });

    it('parses provider with reasoning and all', () => {
      const result = modelsCommand.action(
        context,
        '-p openai -r --all',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.providerOverride).toBe('openai');
      expect(data.initialFilters?.reasoning).toBe(true);
      expect(data.showAllProviders).toBe(true);
    });

    it('parses all capability flags together', () => {
      const result = modelsCommand.action(
        context,
        '-t -r -a --vision',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.vision).toBe(true);
      expect(data.initialFilters?.reasoning).toBe(true);
      expect(data.initialFilters?.audio).toBe(true);
    });
  });

  describe('ignored flags', () => {
    it('ignores --limit flag', () => {
      const result = modelsCommand.action(
        context,
        '--limit 10',
      ) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
      // Should not crash, limit is ignored
    });

    it('ignores -l short flag', () => {
      const result = modelsCommand.action(
        context,
        '-l 5',
      ) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
    });

    it('ignores --verbose flag', () => {
      const result = modelsCommand.action(
        context,
        '--verbose',
      ) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
    });

    it('ignores -v short flag', () => {
      const result = modelsCommand.action(
        context,
        '-v',
      ) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
    });

    it('ignores unknown flags gracefully', () => {
      const result = modelsCommand.action(
        context,
        '--unknown-flag value',
      ) as OpenDialogActionReturn;
      expect(result.type).toBe('dialog');
    });
  });

  describe('example command args', () => {
    it('/models --tools --provider openai', () => {
      const result = modelsCommand.action(
        context,
        '--tools --provider openai',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.providerOverride).toBe('openai');
      expect(data.initialFilters?.tools).toBe(true);
    });

    it('/models --tools --reasoning', () => {
      const result = modelsCommand.action(
        context,
        '--tools --reasoning',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialFilters?.tools).toBe(true);
      expect(data.initialFilters?.reasoning).toBe(true);
    });

    it('/models gpt-4o', () => {
      const result = modelsCommand.action(
        context,
        'gpt-4o',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('gpt-4o');
    });

    it('/models claude --vision', () => {
      const result = modelsCommand.action(
        context,
        'claude --vision',
      ) as OpenDialogActionReturn;
      const data = result.dialogData as ModelsDialogData;
      expect(data.initialSearch).toBe('claude');
      expect(data.initialFilters?.vision).toBe(true);
    });
  });
});
