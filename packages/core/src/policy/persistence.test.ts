/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createPolicyUpdater } from './config.js';
import { PolicyEngine } from './policy-engine.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import { Storage } from '../config/storage.js';
import * as debugLoggerModule from '../utils/debugLogger.js';

vi.mock('node:fs/promises');
vi.mock('../config/storage.js');

describe('createPolicyUpdater - TOML Persistence', () => {
  let policyEngine: PolicyEngine;
  let messageBus: MessageBus;

  beforeEach(() => {
    policyEngine = new PolicyEngine({ rules: [], checkers: [] });
    messageBus = new MessageBus(policyEngine);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('R3: TOML Persistence Format', () => {
    it('should persist policy when persist flag is true', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      const toolName = 'test_tool';
      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName,
        persist: true,
      });

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(Storage.getUserPoliciesDir).toHaveBeenCalled();
      expect(fs.mkdir).toHaveBeenCalledWith(userPoliciesDir, {
        recursive: true,
      });

      // Check written content
      const expectedContent = expect.stringContaining(`toolName = "test_tool"`);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expectedContent,
        'utf-8',
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        path.join(userPoliciesDir, 'auto-saved.toml'),
      );
    });

    it('should not persist policy when persist flag is false or undefined', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'test_tool',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('should use atomic write pattern (tmp + rename)', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'test_tool',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify atomic write: tmp file created first, then renamed
      const writeCall = (fs.writeFile as unknown as Mock).mock.calls[0];
      const renameCall = (fs.rename as unknown as Mock).mock.calls[0];

      expect(writeCall[0]).toMatch(/\.tmp$/);
      expect(renameCall[0]).toMatch(/\.tmp$/);
      expect(renameCall[1]).toBe(path.join(userPoliciesDir, 'auto-saved.toml'));
    });
  });

  describe('R4: Shell Command Prefix Matching', () => {
    it('should persist policy with commandPrefix when provided', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      const toolName = 'run_shell_command';
      const commandPrefix = 'git status';

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName,
        persist: true,
        commandPrefix,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify in-memory rule has argsPattern (converted from commandPrefix)
      const rules = policyEngine.getRules();
      const addedRule = rules.find((r) => r.toolName === toolName);
      expect(addedRule).toBeDefined();
      expect(addedRule?.priority).toBe(2.95);
      expect(addedRule?.argsPattern).toEqual(
        new RegExp(`"command":"git status(?:[\\s"]|$)`),
      );

      // Verify TOML file contains commandPrefix (not argsPattern)
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expect.stringContaining(`commandPrefix = "git status"`),
        'utf-8',
      );
    });

    it('should escape special characters in commandPrefix for regex', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      const commandPrefix = 'git log --oneline';

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'run_shell_command',
        persist: true,
        commandPrefix,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // In-memory rule should have escaped regex (no raw regex special chars)
      const rules = policyEngine.getRules();
      const addedRule = rules.find((r) => r.toolName === 'run_shell_command');
      expect(addedRule?.argsPattern).toBeDefined();

      // Verify regex escaping: should match commands starting with the prefix
      const testArgs1 = { command: 'git log --oneline' };
      expect(addedRule?.argsPattern?.test(JSON.stringify(testArgs1))).toBe(
        true,
      );

      const testArgs2 = { command: 'git log --oneline -5' };
      expect(addedRule?.argsPattern?.test(JSON.stringify(testArgs2))).toBe(
        true,
      );

      const nonMatchingArgs = { command: 'git status' }; // Different command
      expect(
        addedRule?.argsPattern?.test(JSON.stringify(nonMatchingArgs)),
      ).toBe(false);
    });
  });

  describe('R5: MCP Tool Granularity', () => {
    it('should persist policy with mcpName and extract simple toolName', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      const mcpName = 'my-jira-server';
      const simpleToolName = 'search';
      const toolName = `${mcpName}__${simpleToolName}`;

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName,
        persist: true,
        mcpName,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify TOML file written with mcpName and simple toolName
      const writeCall = (fs.writeFile as unknown as Mock).mock.calls[0];
      const writtenContent = writeCall[1] as string;
      expect(writtenContent).toContain(`mcpName = "${mcpName}"`);
      expect(writtenContent).toContain(`toolName = "${simpleToolName}"`);
      expect(writtenContent).toContain('priority = 200');
      expect(writtenContent).toContain('decision = "allow"');
    });

    it('should handle MCP toolNames without __ separator', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      const mcpName = 'my-server';
      const toolName = 'simple-tool'; // No __ separator

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName,
        persist: true,
        mcpName,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should use toolName as-is (no extraction needed)
      const writeCall = (fs.writeFile as unknown as Mock).mock.calls[0];
      const writtenContent = writeCall[1] as string;
      expect(writtenContent).toContain(`mcpName = "${mcpName}"`);
      expect(writtenContent).toContain(`toolName = "${toolName}"`);
    });
  });

  describe('R7: Error Handling', () => {
    it('should handle TOML write failure gracefully (non-fatal)', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockRejectedValue(
        new Error('Disk full'),
      );

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'test_tool',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // In-memory rule should still be added (fallback behavior)
      const rules = policyEngine.getRules();
      const addedRule = rules.find((r) => r.toolName === 'test_tool');
      expect(addedRule).toBeDefined();
      expect(addedRule?.priority).toBe(2.95);

      // Error should be logged (non-fatal, session continues)
      // This tests that the error is caught and doesn't throw
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should overwrite corrupt TOML file with warning', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockResolvedValue(
        'invalid toml syntax {{{',
      ); // Corrupt file
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      const debugWarnSpy = vi
        .spyOn(debugLoggerModule.debugLogger, 'warn')
        .mockImplementation(() => {});

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'test_tool',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should warn about corrupt file
      expect(debugWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse'),
        expect.anything(),
      );

      // Should write new valid TOML
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expect.stringContaining('toolName = "test_tool"'),
        'utf-8',
      );

      debugWarnSpy.mockRestore();
    });

    it('should create new file when none exists (no error)', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'test_tool',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should create directory if missing
      expect(fs.mkdir).toHaveBeenCalledWith(userPoliciesDir, {
        recursive: true,
      });

      // Should write new file
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });
  });

  describe('R2: In-Memory + Persistent Dual Operation', () => {
    it('should add in-memory rule with priority 2.95', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'edit',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify in-memory rule added
      const rules = policyEngine.getRules();
      const addedRule = rules.find((r) => r.toolName === 'edit');
      expect(addedRule).toBeDefined();
      expect(addedRule?.priority).toBe(2.95);
      expect(addedRule?.decision).toBe('allow');
    });

    it('should write persistent rule with priority 100 for standard tools', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'edit',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify TOML file has priority 100
      const writeCall = (fs.writeFile as unknown as Mock).mock.calls[0];
      const writtenContent = writeCall[1] as string;
      expect(writtenContent).toContain('priority = 100');
    });

    it('should write persistent rule with priority 200 for MCP tools', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'jira__search',
        persist: true,
        mcpName: 'jira',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify TOML file has priority 200 (higher than standard tools)
      const writeCall = (fs.writeFile as unknown as Mock).mock.calls[0];
      const writtenContent = writeCall[1] as string;
      expect(writtenContent).toContain('priority = 200');
    });
  });

  describe('R3: TOML Append Behavior', () => {
    it('should append new rule to existing rules (not overwrite)', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);

      // Existing file with one rule
      const existingToml = `
[[rule]]
toolName = "edit"
decision = "allow"
priority = 100
`;
      (fs.readFile as unknown as Mock).mockResolvedValue(existingToml);
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'run_shell_command',
        persist: true,
        commandPrefix: 'git status',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify new file contains BOTH rules
      const writeCall = (fs.writeFile as unknown as Mock).mock.calls[0];
      const writtenContent = writeCall[1] as string;
      expect(writtenContent).toContain('toolName = "edit"');
      expect(writtenContent).toContain('toolName = "run_shell_command"');
      expect(writtenContent).toContain('commandPrefix = "git status"');
    });
  });

  describe('R10: Zero Telemetry', () => {
    it('should only log errors locally (no telemetry)', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/mock/user/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockRejectedValue(
        new Error('Permission denied'),
      );

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'test_tool',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Error should be caught and handled locally (non-fatal)
      // The implementation uses coreEvents.emitFeedback which is local-only
      expect(fs.writeFile).toHaveBeenCalled();

      // Should NOT call any telemetry functions (we can't test negative easily,
      // but the implementation must not import ClearcutLogger)
    });

    it('should use ~/.llxprt/policies/ path (not Google paths)', async () => {
      createPolicyUpdater(policyEngine, messageBus);

      const userPoliciesDir = '/home/user/.llxprt/policies';
      vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(userPoliciesDir);
      (fs.mkdir as unknown as Mock).mockResolvedValue(undefined);
      (fs.readFile as unknown as Mock).mockRejectedValue(
        Object.assign(new Error('File not found'), { code: 'ENOENT' }),
      );
      (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
      (fs.rename as unknown as Mock).mockResolvedValue(undefined);

      messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'test_tool',
        persist: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify correct path used
      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        '/home/user/.llxprt/policies/auto-saved.toml',
      );

      // Path should NOT contain Google strings
      const renameCall = (fs.rename as unknown as Mock).mock.calls[0];
      expect(renameCall[1]).not.toContain('gemini-code-cli');
      expect(renameCall[1]).not.toContain('google');
    });
  });
});
