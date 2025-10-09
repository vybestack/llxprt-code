import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'vitest';

vi.mock('child_process');

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
import { writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  SubagentManager,
  ProfileManager,
  Logger,
  SessionMetrics,
} from '@vybestack/llxprt-code-core';
import {
  CommandContext,
  MessageActionReturn,
  ConfirmActionReturn,
  SlashCommandActionReturn,
} from '../types.js';
import { LoadedSettings } from '../../../config/settings.js';
import { SessionStatsState } from '../../contexts/SessionContext.js';
import { spawnSync } from 'child_process';

let subagentCommand: typeof import('../subagentCommand.js').subagentCommand;

beforeAll(async () => {
  // Reset modules to ensure fresh import with mocks
  vi.resetModules();

  // Set up default mock behavior for spawnSync
  vi.mocked(spawnSync).mockImplementation(() => ({
    pid: 12345,
    output: [null, null, null] as [null, null, null],
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
    status: 0,
    signal: null,
    error: undefined,
  }));

  // Import AFTER mock is set up
  const mod = await import('../subagentCommand.js?t=' + Date.now());
  subagentCommand = mod.subagentCommand;
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
      setPendingItem: vi.fn(),
      loadHistory: vi.fn(),
      toggleCorgiMode: vi.fn(),
      toggleVimEnabled: vi.fn().mockResolvedValue(true),
      setLlxprtMdFileCount: vi.fn(),
      updateHistoryTokenCount: vi.fn(),
      reloadCommands: vi.fn(),
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

      expect(result.prompt).toMatch(/overwrite/i);
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
    it('should show message when no subagents exist', async () => {
      // Mock listSubagents to return empty array
      // Use real SubagentManager for this test
      context = createTestContext({
        profileManager,
        subagentManager,
      });

      const result = ensureMessage(
        await subagentCommand.subCommands![1].action!(context, ''),
      );

      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/no subagents found/i);
    });

    it('should list all subagents with details', async () => {
      // Create multiple subagents
      await subagentManager.saveSubagent('agent1', 'testprofile', 'Prompt 1');
      await subagentManager.saveSubagent('agent2', 'testprofile', 'Prompt 2');

      const result = ensureMessage(
        await subagentCommand.subCommands![1].action!(context, ''),
      );

      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/agent1/);
      expect(result.content).toMatch(/agent2/);
      expect(result.content).toMatch(/testprofile/);
    });
  });

  describe('showCommand @requirement:REQ-006 @plan:PLAN-20250117-SUBAGENTCONFIG.P07', () => {
    it('should display full subagent configuration', async () => {
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Test system prompt',
      );

      const result = ensureMessage(
        await subagentCommand.subCommands![2].action!(context, 'testagent'),
      );

      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/testagent/);
      expect(result.content).toMatch(/testprofile/);
      expect(result.content).toMatch(/Test system prompt/);
    });

    it('should error for non-existent subagent', async () => {
      const result = ensureMessage(
        await subagentCommand.subCommands![2].action!(context, 'nonexistent'),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });

    it('should error when name not provided', async () => {
      const result = ensureMessage(
        await subagentCommand.subCommands![2].action!(context, ''),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/usage|name required/i);
    });
  });

  describe('deleteCommand @requirement:REQ-007 @plan:PLAN-20250117-SUBAGENTCONFIG.P07', () => {
    it('should delete subagent with confirmation', async () => {
      await subagentManager.saveSubagent(
        'testagent',
        'testprofile',
        'Test prompt',
      );

      // First call: should prompt for confirmation
      ensureConfirm(
        await subagentCommand.subCommands![3].action!(context, 'testagent'),
      );

      // Second call: with confirmation
      context.overwriteConfirmed = true;
      const result2 = ensureMessage(
        await subagentCommand.subCommands![3].action!(context, 'testagent'),
      );

      expect(result2.messageType).toBe('info');
      expect(result2.content).toMatch(/deleted/i);

      // Verify deleted
      const exists = await subagentManager.subagentExists('testagent');
      expect(exists).toBe(false);
    });

    it('should error for non-existent subagent', async () => {
      const result = ensureMessage(
        await subagentCommand.subCommands![3].action!(context, 'nonexistent'),
      );

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });
  });
});

/**
 * Edit command tests
 *
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P10
 * @requirement:REQ-008
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

    expect(vi.isMockFunction(spawnSync)).toBe(true);
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
    expect(result.content).toMatch(/usage|name required/i);
  });

  it('should error for non-existent subagent', async () => {
    const result = ensureMessage(
      await subagentCommand.subCommands![4].action!(context, 'nonexistent'),
    );

    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/not found/i);
  });

  it('should launch editor for existing subagent', async () => {
    await subagentManager.saveSubagent(
      'testagent',
      'testprofile',
      'Test prompt',
    );
    const original = await subagentManager.loadSubagent('testagent');

    // Mock implementation that simulates file editing
    vi.mocked(spawnSync).mockImplementationOnce((_cmd, args) => {
      const filePath = Array.isArray(args)
        ? (args[0] as string | undefined)
        : undefined;
      if (filePath) {
        writeFileSync(
          filePath,
          JSON.stringify(
            {
              ...original,
              systemPrompt: 'Updated prompt from editor',
            },
            null,
            2,
          ),
          'utf8',
        );
      }
      return {
        pid: 12345,
        output: [null, null, null] as [null, null, null],
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        status: 0,
        signal: null,
        error: undefined,
      };
    });

    const result = ensureMessage(
      await subagentCommand.subCommands![4].action!(context, 'testagent'),
    );

    const updated = await subagentManager.loadSubagent('testagent');
    expect(updated.systemPrompt).toBe('Updated prompt from editor');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(original.updatedAt).getTime(),
    );
    expect(result.messageType).toBe('info');
    expect(result.content).toMatch(/updated successfully/i);
  });

  it('should handle editor failure', async () => {
    await subagentManager.saveSubagent(
      'testagent',
      'testprofile',
      'Test prompt',
    );

    // Mock editor exiting with error
    vi.mocked(spawnSync).mockImplementationOnce(() => ({
      pid: 12345,
      output: [null, null, null] as [null, null, null],
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
      status: 1,
      signal: null,
      error: undefined,
    }));

    const result = ensureMessage(
      await subagentCommand.subCommands![4].action!(context, 'testagent'),
    );

    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/editor.*exited|failed/i);
  });

  it('should validate JSON after edit', async () => {
    await subagentManager.saveSubagent(
      'testagent',
      'testprofile',
      'Test prompt',
    );

    // Mock editor writing invalid JSON
    vi.mocked(spawnSync).mockImplementationOnce((_cmd, args) => {
      const filePath = Array.isArray(args)
        ? (args[0] as string | undefined)
        : undefined;
      if (filePath) {
        writeFileSync(filePath, '{ invalid json', 'utf8');
      }
      return {
        pid: 12345,
        output: [null, null, null] as [null, null, null],
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        status: 0,
        signal: null,
        error: undefined,
      };
    });

    const result = ensureMessage(
      await subagentCommand.subCommands![4].action!(context, 'testagent'),
    );

    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/invalid json/i);
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
  let context: CommandContext;
  let subagentManager: SubagentManager;
  let profileManager: ProfileManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directories - same pattern as Phase 08
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'subagent-completion-test-'),
    );
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
  });

  it('should complete subcommand names at level 1', async () => {
    // Simulate: /subagent sa<TAB>
    const fullLine = '/subagent sa';
    const results = await subagentCommand.completion!(context, 'sa', fullLine);

    // Currently stub returns empty array - test should fail on assertion
    expect(results).toContain('save');
    expect(results).not.toContain('list');
  });

  it('should return all subcommands with empty partialArg', async () => {
    // Simulate: /subagent <TAB>
    const fullLine = '/subagent ';
    const results = await subagentCommand.completion!(context, '', fullLine);

    expect(results).toContain('save');
    expect(results).toContain('list');
    expect(results).toContain('show');
    expect(results).toContain('delete');
    expect(results).toContain('edit');
  });

  it('should complete agent names for show command', async () => {
    await subagentManager.saveSubagent('agent1', 'testprofile', 'Prompt 1');
    await subagentManager.saveSubagent('agent2', 'testprofile', 'Prompt 2');

    // Simulate: /subagent show ag<TAB>
    const fullLine = '/subagent show ag';
    const results = await subagentCommand.completion!(context, 'ag', fullLine);

    expect(results).toContain('agent1');
    expect(results).toContain('agent2');
    expect(results).not.toContain('list'); // Not a subcommand here
  });

  it('should complete profile names for save command', async () => {
    // Create multiple profiles
    await profileManager.saveProfile('profile1', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });
    await profileManager.saveProfile('profile2', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });

    // Simulate: /subagent save myagent pro<TAB>
    const fullLine = '/subagent save myagent pro';
    const results = await subagentCommand.completion!(context, 'pro', fullLine);

    expect(results).toContain('profile1');
    expect(results).toContain('profile2');
    expect(results).not.toContain('testprofile'); // Filtered by 'pro'
  });

  it('should complete mode for save command', async () => {
    // Simulate: /subagent save myagent myprofile a<TAB>
    const fullLine = '/subagent save myagent myprofile a';
    const results = await subagentCommand.completion!(context, 'a', fullLine);

    expect(results).toContain('auto');
    expect(results).not.toContain('manual'); // Filtered by 'a'
  });

  it('should return all modes with empty partialArg at mode position', async () => {
    // Simulate: /subagent save myagent myprofile <TAB>
    const fullLine = '/subagent save myagent myprofile ';
    const results = await subagentCommand.completion!(context, '', fullLine);

    expect(results).toContain('auto');
    expect(results).toContain('manual');
  });

  it('should return empty array for positions beyond mode', async () => {
    // Simulate: /subagent save myagent myprofile auto <TAB>
    const fullLine = '/subagent save myagent myprofile auto ';
    const results = await subagentCommand.completion!(context, '', fullLine);

    expect(results).toEqual([]);
  });
});
