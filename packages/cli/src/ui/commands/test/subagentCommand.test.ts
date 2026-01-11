import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'vitest';

const runWithScopeMock = vi.fn((callback: () => unknown) => callback());
const getRuntimeBridgeMock = vi.fn(() => ({
  runWithScope: runWithScopeMock,
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeBridge: getRuntimeBridgeMock,
}));

/**
 * COMPLETION SYSTEM REQUIREMENTS
 *
 * These tests require Phase 01 to have resolved autocomplete system capabilities.
 *
 * Findings from Phase 01:
 * - Autocomplete feasibility documented (see findings.md)
 * - Required file changes identified for fullLine support
 * - No production code modified yet
 *
 * If Phase 01 blocked on autocomplete:
 * - These tests should not be written until blocker resolved
 * - Plan should be paused at Phase 01
 *
 * See: project-plans/subagentconfig/analysis/findings.md for Phase 01 results
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  SubagentManager,
  ProfileManager,
  Logger,
  SessionMetrics,
} from '@vybestack/llxprt-code-core';
import { SubagentView } from '../../components/SubagentManagement/types.js';
import { FunctionCallingConfigMode } from '@google/genai';
import {
  CommandContext,
  MessageActionReturn,
  ConfirmActionReturn,
  SlashCommandActionReturn,
} from '../types.js';
import { LoadedSettings } from '../../../config/settings.js';
import { SessionStatsState } from '../../contexts/SessionContext.js';

let subagentCommand: typeof import('../subagentCommand.js').subagentCommand;
let subagentCommandModule: typeof import('../subagentCommand.js');

beforeAll(async () => {
  // Reset modules to ensure fresh import with mocks
  vi.resetModules();

  // Import module
  const mod = await import('../subagentCommand.js?t=' + Date.now());
  subagentCommand = mod.subagentCommand;
  subagentCommandModule = mod;
});

type TestContextOptions = {
  subagentManager?: SubagentManager;
  profileManager?: ProfileManager;
  overwriteConfirmed?: boolean;
};

const createTestContext = ({
  subagentManager,
  profileManager,
  overwriteConfirmed,
}: TestContextOptions = {}): CommandContext => {
  const settings = { merged: {} } as LoadedSettings;
  const logger = {
    log: vi.fn(),
    logMessage: vi.fn(),
    saveCheckpoint: vi.fn(),
    loadCheckpoint: vi.fn().mockResolvedValue([]),
  } as unknown as Logger;

  const metrics: SessionMetrics = {
    models: {},
    tools: {
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalDurationMs: 0,
      totalDecisions: {
        accept: 0,
        reject: 0,
        modify: 0,
        auto_accept: 0,
      },
      byName: {},
    },
    files: {
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
    tokenTracking: {
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      sessionTokenUsage: {
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      },
    },
  };

  const stats: SessionStatsState = {
    sessionId: 'test-session',
    sessionStartTime: new Date(),
    metrics,
    lastPromptTokenCount: 0,
    historyTokenCount: 0,
    promptCount: 0,
  };

  return {
    invocation: {
      raw: '',
      name: '',
      args: '',
    },
    services: {
      config: null,
      settings,
      git: undefined,
      logger,
      profileManager,
      subagentManager,
    },
    ui: {
      addItem: vi.fn(),
      clear: vi.fn(),
      setDebugMessage: vi.fn(),
      pendingItem: null,
      setPendingItem: () => {},
      loadHistory: vi.fn(),
      toggleCorgiMode: vi.fn(),
      toggleDebugProfiler: vi.fn(),
      toggleVimEnabled: vi.fn().mockResolvedValue(true),
      setGeminiMdFileCount: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      updateHistoryTokenCount: vi.fn(),
      reloadCommands: vi.fn(),
      extensionsUpdateState: new Map(),
      dispatchExtensionStateUpdate: vi.fn(),
      addConfirmUpdateExtensionRequest: vi.fn(),
    },
    session: {
      stats,
      sessionShellAllowlist: new Set<string>(),
    },
    overwriteConfirmed: overwriteConfirmed ?? false,
  };
};

const ensureMessage = (
  value: SlashCommandActionReturn | void,
): MessageActionReturn => {
  expect(value).toBeDefined();
  expect(value?.type).toBe('message');
  if (!value || value.type !== 'message') {
    throw new Error('Expected message action return');
  }
  return value;
};

const ensureConfirm = (
  value: SlashCommandActionReturn | void,
): ConfirmActionReturn => {
  expect(value).toBeDefined();
  expect(value?.type).toBe('confirm_action');
  if (!value || value.type !== 'confirm_action') {
    throw new Error('Expected confirm action return');
  }
  return value;
};

type DialogActionReturn = {
  type: 'dialog';
  dialog: string;
  dialogData?: Record<string, unknown>;
};

const ensureDialog = (
  value: SlashCommandActionReturn | void,
): DialogActionReturn => {
  expect(value).toBeDefined();
  expect(value?.type).toBe('dialog');
  if (!value || value.type !== 'dialog') {
    throw new Error('Expected dialog action return');
  }
  return value as DialogActionReturn;
};

/**
 * SubagentCommand behavioral tests - Basic commands
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P07
 * @requirement:REQ-004, REQ-005, REQ-006, REQ-007, REQ-014
 *
 * Tests verify command interactions with SubagentManager
 * Mock GeminiClient, use real file system
 */
describe('subagentCommand - basic @plan:PLAN-20250117-SUBAGENTCONFIG.P07', () => {
  let context: CommandContext;
  let subagentManager: SubagentManager;
  let profileManager: ProfileManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-cmd-test-'));
    const subagentsDir = path.join(tempDir, 'subagents');
    const profilesDir = path.join(tempDir, 'profiles');

    // Initialize managers
    profileManager = new ProfileManager(profilesDir);
    subagentManager = new SubagentManager(subagentsDir, profileManager);

    // Create test profile
    await fs.mkdir(profilesDir, { recursive: true });
    await profileManager.saveProfile('testprofile', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });

    context = createTestContext({
      profileManager,
      subagentManager,
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    runWithScopeMock.mockClear();
    getRuntimeBridgeMock.mockClear();
  });

  describe('saveCommand - manual mode @requirement:REQ-004', () => {
    it('should save new subagent with manual mode', async () => {
      const args = 'testagent testprofile manual "You are a test agent"';
      const result = ensureMessage(
        await subagentCommand.subCommands![0].action!(context, args),
      );

      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/created successfully/i);

      // Verify subagent was saved
      const exists = await subagentManager.subagentExists('testagent');
      expect(exists).toBe(true);

      const loaded = await subagentManager.loadSubagent('testagent');
      expect(loaded.profile).toBe('testprofile');
      expect(loaded.systemPrompt).toBe('You are a test agent');
    });

    it('should reject invalid syntax', async () => {
      const invalidArgs = [
        'testagent', // Missing profile and mode
        'testagent testprofile', // Missing mode and prompt
        'testagent testprofile manual', // Missing prompt
        'testagent testprofile invalid "prompt"', // Invalid mode
      ];

      for (const args of invalidArgs) {
        const result = ensureMessage(
          await subagentCommand.subCommands![0].action!(context, args),
        );
        expect(result.messageType).toBe('error');
        expect(result.content).toMatch(/usage|syntax/i);
      }
    });

    it('should error when subagentManager service missing', async () => {
      const contextWithoutManager = createTestContext({
        profileManager,
        subagentManager: undefined,
      });

      const result = ensureMessage(
        await subagentCommand.subCommands![0].action!(
          contextWithoutManager,
          'testagent testprofile manual "Prompt"',
        ),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/service .* unavailable/i);
    });

    it('should reject non-existent profile @requirement:REQ-013', async () => {
      const args = 'testagent nonexistent manual "prompt"';
      const result = ensureMessage(
        await subagentCommand.subCommands![0].action!(context, args),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/profile.*not found/i);
    });

    it('should prompt for confirmation on overwrite @requirement:REQ-014', async () => {
      // Create existing subagent
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Original prompt',
      );

      // Try to overwrite without confirmation
      const args = 'testagent testprofile manual "New prompt"';
      const result = ensureConfirm(
        await subagentCommand.subCommands![0].action!(context, args),
      );

      // Check that prompt is a React element
      expect(result).toHaveProperty('prompt');
      expect(result.prompt).toBeDefined();
      expect(result.originalInvocation).toBeDefined();
    });

    it('should overwrite when confirmed', async () => {
      // Create existing subagent
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Original prompt',
      );

      // Set confirmation flag
      context.overwriteConfirmed = true;

      const args = 'testagent testprofile manual "New prompt"';
      const result = ensureMessage(
        await subagentCommand.subCommands![0].action!(context, args),
      );

      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/updated successfully/i);

      // Verify updated
      const loaded = await subagentManager.loadSubagent('testagent');
      expect(loaded.systemPrompt).toBe('New prompt');
    });
  });

  describe('listCommand @requirement:REQ-005 @plan:PLAN-20250117-SUBAGENTCONFIG.P07', () => {
    it('should open list dialog', async () => {
      // listCommand now opens interactive dialog instead of returning message
      context = createTestContext({
        profileManager,
        subagentManager,
      });

      const result = ensureDialog(
        await subagentCommand.subCommands![2].action!(context, ''),
      );

      expect(result.dialog).toBe('subagent');
      expect(result.dialogData?.initialView).toBe(SubagentView.LIST);
    });
  });

  describe('showCommand @requirement:REQ-006 @plan:PLAN-20250117-SUBAGENTCONFIG.P07', () => {
    it('should open show dialog for existing subagent', async () => {
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Test system prompt',
      );

      const result = ensureDialog(
        await subagentCommand.subCommands![3].action!(context, 'testagent'),
      );

      expect(result.dialog).toBe('subagent');
      expect(result.dialogData?.initialView).toBe(SubagentView.SHOW);
      expect(result.dialogData?.initialSubagentName).toBe('testagent');
    });

    it('should error for non-existent subagent', async () => {
      const result = ensureMessage(
        await subagentCommand.subCommands![3].action!(context, 'nonexistent'),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });

    it('should error when name not provided', async () => {
      const result = ensureMessage(
        await subagentCommand.subCommands![3].action!(context, ''),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/usage/i);
    });
  });

  describe('deleteCommand @requirement:REQ-007 @plan:PLAN-20250117-SUBAGENTCONFIG.P07', () => {
    it('should open delete dialog for existing subagent', async () => {
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Test prompt',
      );

      // deleteCommand now opens interactive dialog for confirmation
      const result = ensureDialog(
        await subagentCommand.subCommands![5].action!(context, 'testagent'),
      );

      expect(result.dialog).toBe('subagent');
      expect(result.dialogData?.initialView).toBe(SubagentView.DELETE);
      expect(result.dialogData?.initialSubagentName).toBe('testagent');
    });

    it('should error for non-existent subagent', async () => {
      const result = ensureMessage(
        await subagentCommand.subCommands![5].action!(context, 'nonexistent'),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });

    it('should error when name not provided', async () => {
      const result = ensureMessage(
        await subagentCommand.subCommands![5].action!(context, ''),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/usage/i);
    });
  });
});

/**
 * Edit command tests
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P10
 * @requirement:REQ-008
 *
 * NOTE: editCommand now opens interactive dialog instead of external editor.
 * Editor-based tests removed in favor of dialog-based UI.
 */
describe('editCommand @requirement:REQ-008', () => {
  let context: CommandContext;
  let subagentManager: SubagentManager;
  let profileManager: ProfileManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directories - same pattern as Phase 08
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-edit-test-'));
    const subagentsDir = path.join(tempDir, 'subagents');
    const profilesDir = path.join(tempDir, 'profiles');

    // Initialize real managers
    profileManager = new ProfileManager(profilesDir);
    subagentManager = new SubagentManager(subagentsDir, profileManager);

    // Create test profile
    await fs.mkdir(profilesDir, { recursive: true });
    await profileManager.saveProfile('testprofile', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });

    context = createTestContext({
      profileManager,
      subagentManager,
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should error when name not provided', async () => {
    const result = ensureMessage(
      await subagentCommand.subCommands![4].action!(context, ''),
    );

    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/usage/i);
  });

  it('should error for non-existent subagent', async () => {
    const result = ensureMessage(
      await subagentCommand.subCommands![4].action!(context, 'nonexistent'),
    );

    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/not found/i);
  });

  it('should open edit dialog for existing subagent', async () => {
    await subagentManager.saveSubagent(
      'testagent',
      'testprofile',
      'Test prompt',
    );

    const result = ensureDialog(
      await subagentCommand.subCommands![4].action!(context, 'testagent'),
    );

    expect(result.dialog).toBe('subagent');
    expect(result.dialogData?.initialView).toBe(SubagentView.EDIT);
    expect(result.dialogData?.initialSubagentName).toBe('testagent');
  });
});

/**
 * Autocomplete tests
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P10
 * @requirement:REQ-009
 *
 * NOTE: These tests assume Phase 01 has resolved autocomplete system to support
 * fullLine parameter. If Phase 01 did not implement enhancement, these tests
 * will need to be adjusted based on findings.md.
 */
describe('completion @requirement:REQ-009', () => {
  it('is temporarily skipped pending schema-driven slash completion migration', () => {
    expect(subagentCommand.schema).toBeUndefined();
  });
});

/**
 * Auto mode tests
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P13
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P14
 * @requirement:REQ-003
 */
describe('saveCommand - auto mode @requirement:REQ-003', () => {
  let context: CommandContext;
  let subagentManager: SubagentManager;
  let profileManager: ProfileManager;
  let tempDir: string;
  let mockGeminiClient: {
    generateDirectMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Create temp directories for a realistic test environment
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-auto-test-'));
    const subagentsDir = path.join(tempDir, 'subagents');
    const profilesDir = path.join(tempDir, 'profiles');

    // Initialize real managers
    profileManager = new ProfileManager(profilesDir);
    subagentManager = new SubagentManager(subagentsDir, profileManager);

    // Create test profile
    await fs.mkdir(profilesDir, { recursive: true });
    await profileManager.saveProfile('testprofile', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });

    context = createTestContext({
      profileManager,
      subagentManager,
    });

    // Mock GeminiClient
    mockGeminiClient = {
      generateDirectMessage: vi.fn().mockResolvedValue({
        text: 'Auto generated prompt',
      }),
    };

    // Add to context in a way that avoids TypeScript errors
    (context as unknown as { services: { config: unknown } }).services.config =
      {
        getGeminiClient: vi.fn(() => mockGeminiClient),
      };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should generate system prompt using LLM', async () => {
    // Mock LLM response
    mockGeminiClient.generateDirectMessage.mockResolvedValue({
      text: 'You are an expert Python debugger specializing in finding and fixing bugs.',
    });

    const args = 'testagent testprofile auto "expert Python debugger"';
    // Access the save subcommand directly from the imported module
    const result = await subagentCommand.subCommands![0].action!(context, args);

    // Verify LLM was called
    expect(mockGeminiClient.generateDirectMessage).toHaveBeenCalledTimes(1);
    const callArgs = mockGeminiClient.generateDirectMessage.mock.calls[0][0];
    expect(callArgs.message).toMatch(/expert Python debugger/);
    expect(callArgs.message).toMatch(/system prompt/i);
    expect(callArgs.config).toEqual({
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.NONE,
        },
      },
      serverTools: [],
    });

    // Verify success message type and content
    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    if (!result || result.type !== 'message') {
      throw new Error('Expected message action return');
    }
    expect(result.messageType).toBe('info');
    expect(result.content).toMatch(/created successfully/i);

    // Verify the subagent was saved with the generated prompt
    const loaded = await subagentManager.loadSubagent('testagent');
    expect(loaded.systemPrompt).toBe(
      'You are an expert Python debugger specializing in finding and fixing bugs.',
    );
  });

  it('should handle LLM generation failure', async () => {
    // Mock LLM error
    mockGeminiClient.generateDirectMessage.mockRejectedValue(
      new Error('Network error'),
    );

    const args = 'testagent testprofile auto "expert debugger"';
    const result = await subagentCommand.subCommands![0].action!(context, args);

    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    if (!result || result.type !== 'message') {
      throw new Error('Expected message action return');
    }
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/Network error/);
    expect(mockGeminiClient.generateDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.NONE,
            },
          },
          serverTools: [],
        },
      }),
      expect.any(String),
    );
  });

  it('should handle empty LLM response', async () => {
    // Mock empty response
    mockGeminiClient.generateDirectMessage.mockResolvedValue({
      text: '',
    });

    const args = 'testagent testprofile auto "expert debugger"';
    const result = await subagentCommand.subCommands![0].action!(context, args);

    expect(result).toBeDefined();
    expect(result?.type).toBe('message');
    if (!result || result.type !== 'message') {
      throw new Error('Expected message action return');
    }
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/empty.*response|manual mode/i);
    expect(mockGeminiClient.generateDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.NONE,
            },
          },
          serverTools: [],
        },
      }),
      expect.any(String),
    );
  });

  it('falls back to a detached Gemini client when the primary client fails and provider is gemini', async () => {
    const primaryClient = {
      generateDirectMessage: vi.fn(),
    };

    const fallbackResponseText = 'Fallback prompt from detached Gemini client.';
    const fallbackClient = {
      generateDirectMessage: vi.fn().mockResolvedValue({
        text: fallbackResponseText,
      }),
      dispose: vi.fn(),
    };

    const helperSpy = vi
      .spyOn(
        subagentCommandModule.subagentAutoPromptHelpers,
        'createDetachedGeminiClientForAutoPrompt',
      )
      .mockReturnValue(fallbackClient as never);

    (context as unknown as { services: { config: unknown } }).services.config =
      {
        getGeminiClient: vi.fn(() => primaryClient),
        getProvider: vi.fn(() => 'gemini'),
      };

    const saveSpy = vi.spyOn(subagentManager, 'saveSubagent');

    runWithScopeMock.mockClear();

    const args = 'testagent testprofile auto "expert prompt"';
    const actionResult = await subagentCommand.subCommands![0].action!(
      context,
      args,
    );

    expect(primaryClient.generateDirectMessage).not.toHaveBeenCalled();
    expect(helperSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        getProvider: expect.any(Function),
      }),
    );
    expect(fallbackClient.generateDirectMessage).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledWith(
      'testagent',
      'testprofile',
      fallbackResponseText,
    );
    expect(runWithScopeMock).not.toHaveBeenCalled();
    expect(actionResult).toBeDefined();
    expect(actionResult?.type).toBe('message');
    if (!actionResult || actionResult.type !== 'message') {
      throw new Error('Expected message action return');
    }
    expect(actionResult.messageType).toBe('info');
    expect(actionResult.content).toContain('Subagent');
    helperSpy.mockRestore();
  });

  it('should use correct prompt template for LLM', async () => {
    mockGeminiClient.generateDirectMessage.mockResolvedValue({
      text: 'Generated prompt',
    });

    const description = 'expert code reviewer';
    const args = `testagent testprofile auto "${description}"`;
    await subagentCommand.subCommands![0].action!(context, args);

    const callArgs = mockGeminiClient.generateDirectMessage.mock.calls[0][0];

    // Verify prompt includes description
    expect(callArgs.message).toContain(description);

    // Verify prompt includes instructions
    expect(callArgs.message).toMatch(/comprehensive/i);
    expect(callArgs.message).toMatch(/role.*capabilities.*behavior/i);
    expect(callArgs.message).toMatch(/output.*only/i);
  });
});
