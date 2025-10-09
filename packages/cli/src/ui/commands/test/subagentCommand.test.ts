import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
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
} from '../types.js';
import { LoadedSettings } from '../../../config/settings.js';
import { SessionStatsState } from '../../contexts/SessionContext.js';
import { subagentCommand } from '../subagentCommand.js';

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
      const result = (await subagentCommand.subCommands![0].action!(
        context,
        args,
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
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
        const result = (await subagentCommand.subCommands![0].action!(
          context,
          args,
        )) as MessageActionReturn;
        expect(result.messageType).toBe('error');
        expect(result.content).toMatch(/usage|syntax/i);
      }
    });

    it('should error when subagentManager service missing', async () => {
      const contextWithoutManager = createTestContext({
        profileManager,
        subagentManager: undefined,
      });

      const result = (await subagentCommand.subCommands![0].action!(
        contextWithoutManager,
        'testagent testprofile manual "Prompt"',
      )) as MessageActionReturn;

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/service .* unavailable/i);
    });

    it('should reject non-existent profile @requirement:REQ-013', async () => {
      const args = 'testagent nonexistent manual "prompt"';
      const result = (await subagentCommand.subCommands![0].action!(
        context,
        args,
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
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
      const result = (await subagentCommand.subCommands![0].action!(
        context,
        args,
      )) as ConfirmActionReturn;

      expect(result.type).toBe('confirm_action');
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
      const result = (await subagentCommand.subCommands![0].action!(
        context,
        args,
      )) as MessageActionReturn;

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

      const result = (await subagentCommand.subCommands![1].action!(
        context,
        '',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/no subagents found/i);
    });

    it('should list all subagents with details', async () => {
      // Create multiple subagents
      await subagentManager.saveSubagent('agent1', 'testprofile', 'Prompt 1');
      await subagentManager.saveSubagent('agent2', 'testprofile', 'Prompt 2');

      const result = (await subagentCommand.subCommands![1].action!(
        context,
        '',
      )) as MessageActionReturn;

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

      const result = (await subagentCommand.subCommands![2].action!(
        context,
        'testagent',
      )) as MessageActionReturn;

      expect(result.messageType).toBe('info');
      expect(result.content).toMatch(/testagent/);
      expect(result.content).toMatch(/testprofile/);
      expect(result.content).toMatch(/Test system prompt/);
    });

    it('should error for non-existent subagent', async () => {
      const result = (await subagentCommand.subCommands![2].action!(
        context,
        'nonexistent',
      )) as MessageActionReturn;

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });

    it('should error when name not provided', async () => {
      const result = (await subagentCommand.subCommands![2].action!(
        context,
        '',
      )) as MessageActionReturn;

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
      const result1 = (await subagentCommand.subCommands![3].action!(
        context,
        'testagent',
      )) as ConfirmActionReturn;
      expect(result1.type).toBe('confirm_action');

      // Second call: with confirmation
      context.overwriteConfirmed = true;
      const result2 = (await subagentCommand.subCommands![3].action!(
        context,
        'testagent',
      )) as MessageActionReturn;

      expect(result2.messageType).toBe('info');
      expect(result2.content).toMatch(/deleted/i);

      // Verify deleted
      const exists = await subagentManager.subagentExists('testagent');
      expect(exists).toBe(false);
    });

    it('should error for non-existent subagent', async () => {
      const result = (await subagentCommand.subCommands![3].action!(
        context,
        'nonexistent',
      )) as MessageActionReturn;

      expect(result.messageType).toBe('error');
      expect(result.content).toMatch(/not found/i);
    });
  });
});
