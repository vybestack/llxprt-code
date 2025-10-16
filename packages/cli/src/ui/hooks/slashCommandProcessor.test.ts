import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { IdeClient } from '@vybestack/llxprt-code-core';
import { useSlashCommandProcessor } from './slashCommandProcessor';
import { Config } from '../../../config';
import { SlashCommand, CommandKind } from '../commands/types';
import { BuiltinCommandLoader } from '../commands';
import { LoadedSettings } from '../../../config/settings';

vi.mock('../commands', () => ({
  BuiltinCommandLoader: vi.fn(),
}));

const mockBuiltinLoadCommands = vi.fn();

(vi.mocked(BuiltinCommandLoader) as Mock).mockImplementation(() => ({
  loadCommands: mockBuiltinLoadCommands,
}));

/**
 * Creates a minimal SlashCommand for testing purposes.
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P07
 */
function createTestCommand(overrides: Partial<SlashCommand>): SlashCommand {
  return {
    name: overrides.name || 'testcmd',
    description: overrides.description || 'A test command',
    kind: overrides.kind || CommandKind.BUILT_IN,
    action: overrides.action || vi.fn(),
    subCommands: overrides.subCommands || undefined,
  };
}

describe('useSlashCommandProcessor', () => {
  const mockConfig = {
    getClient: vi.fn().mockReturnValue({
      MCP_PROMPT: 'mcp-prompt',
    } as unknown as IdeClient),
    getProjectRoot: vi.fn().mockReturnValue('/test/project'),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getDebugMode: vi.fn().mockReturnValue(false),
    getTargetDir: vi.fn().mockReturnValue('/test/project'),
    getUserMemory: vi.fn().mockReturnValue(''),
    setUserMemory: vi.fn(),
    getApprovalMode: vi.fn().mockReturnValue('default'),
    setApprovalMode: vi.fn(),
    getGeminiClient: vi.fn().mockReturnValue(undefined),
  } as unknown as Config;

  const mockSettings = {} as LoadedSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    (vi.mocked(BuiltinCommandLoader) as Mock).mockClear();
    mockBuiltinLoadCommands.mockResolvedValue([]);
  });

  // Existing tests would be here...

  it('loads slash commands via BuiltinCommandLoader', async () => {
    const testCommand = createTestCommand({ name: 'subagent' });
    mockBuiltinLoadCommands.mockResolvedValue([testCommand]);
    const { result } = renderHook(() =>
      useSlashCommandProcessor(mockConfig, mockSettings),
    );

    await waitFor(() =>
      expect(result.current.slashCommands).toEqual([testCommand]),
    );
  });
});
