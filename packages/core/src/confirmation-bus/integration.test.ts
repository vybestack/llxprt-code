/**
 * Integration Tests for Message Bus System
 *
 * These tests verify the end-to-end functionality of the message bus,
 * policy engine, TOML policy loading, and their integration with the
 * tool execution flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FunctionCall } from '@google/genai';

import { MessageBus } from './message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import {
  loadPolicyFromToml,
  loadDefaultPolicies,
} from '../policy/toml-loader.js';
import { PolicyDecision, type PolicyEngineConfig } from '../policy/types.js';
import { MessageBusType, type ToolConfirmationRequest } from './types.js';
import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';

describe('Message Bus Integration Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `msg-bus-integration-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Policy Engine with TOML Policies', () => {
    it('should load default TOML policies', async () => {
      const rules = await loadDefaultPolicies();

      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(0);

      // Verify read-only tools are present
      const readOnlyRule = rules.find((r) => r.toolName === 'glob');
      expect(readOnlyRule).toBeDefined();
      expect(readOnlyRule?.decision).toBe(PolicyDecision.ALLOW);

      // Verify write tools are present
      const writeRule = rules.find((r) => r.toolName === 'replace');
      expect(writeRule).toBeDefined();
      expect(writeRule?.decision).toBe(PolicyDecision.ASK_USER);
    });

    it('should match edit tool to write.toml rules', async () => {
      const rules = await loadDefaultPolicies();
      const policyEngine = new PolicyEngine({ rules });

      const decision = policyEngine.evaluate('replace', {
        file_path: '/test/file.ts',
        old_string: 'foo',
        new_string: 'bar',
      });

      expect(decision).toBe(PolicyDecision.ASK_USER);
    });

    it('should match read-only tools with ALLOW decision', async () => {
      const rules = await loadDefaultPolicies();
      const policyEngine = new PolicyEngine({ rules });

      const readOnlyTools = [
        'glob',
        'search_file_content',
        'read_file',
        'list_directory',
      ];

      for (const toolName of readOnlyTools) {
        const decision = policyEngine.evaluate(toolName, {});
        expect(decision).toBe(PolicyDecision.ALLOW);
      }
    });

    it('should enforce priority order in TOML policies', async () => {
      const path = join(testDir, 'priority.toml');
      // TOML priorities are integers 0-999, transformed by tier (tier + priority/1000)
      // priority = 10 in tier 1 becomes 1.010
      // priority = 100 in tier 1 becomes 1.100 (higher priority)
      const content = `
[[rule]]
toolName = "shell"
decision = "ask_user"
priority = 10

[[rule]]
toolName = "shell"
argsPattern = "rm\\\\s+-rf\\\\s+/"
decision = "deny"
priority = 100
`;
      await writeFile(path, content);

      const rules = await loadPolicyFromToml(path);
      const policyEngine = new PolicyEngine({ rules });

      // Normal shell command should ask user (priority 1.010)
      const normalDecision = policyEngine.evaluate('shell', { command: 'ls' });
      expect(normalDecision).toBe(PolicyDecision.ASK_USER);

      // Dangerous command should be denied (priority 1.100 - higher priority)
      const dangerousDecision = policyEngine.evaluate('shell', {
        command: 'rm -rf /',
      });
      expect(dangerousDecision).toBe(PolicyDecision.DENY);
    });

    it('should load policies with argsPattern regex', async () => {
      const path = join(testDir, 'regex.toml');
      // TOML priorities are integers 0-999, priority = 50 in tier 1 becomes 1.050
      const content = `
[[rule]]
toolName = "replace"
argsPattern = "\\\\.md"
decision = "allow"
priority = 50
`;
      await writeFile(path, content);

      const rules = await loadPolicyFromToml(path);
      const policyEngine = new PolicyEngine({ rules });

      // Markdown file should be allowed
      const mdDecision = policyEngine.evaluate('replace', {
        file_path: 'README.md',
      });
      expect(mdDecision).toBe(PolicyDecision.ALLOW);

      // TypeScript file should use default (ASK_USER)
      const tsDecision = policyEngine.evaluate('replace', {
        file_path: 'script.ts',
      });
      expect(tsDecision).toBe(PolicyDecision.ASK_USER);
    });
  });

  describe('Message Bus Flow Integration', () => {
    it('should process full confirmation request → response cycle', async () => {
      const config: PolicyEngineConfig = {
        defaultDecision: PolicyDecision.ASK_USER,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const requestHandler = vi.fn();
      messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        requestHandler,
      );

      const toolCall: FunctionCall = { name: 'edit', args: {} };
      const confirmationPromise = messageBus.requestConfirmation(toolCall, {});

      // Wait for request to be published
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requestHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
          toolCall,
        }),
      );

      const request = requestHandler.mock
        .calls[0][0] as ToolConfirmationRequest;

      // Simulate user approval
      messageBus.respondToConfirmation(
        request.correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );

      const result = await confirmationPromise;
      expect(result).toBe(true);

      messageBus.removeAllListeners();
    });

    it('should match correlation IDs correctly', async () => {
      const config: PolicyEngineConfig = {
        defaultDecision: PolicyDecision.ASK_USER,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const requestHandler = vi.fn();
      messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        requestHandler,
      );

      const toolCall: FunctionCall = { name: 'edit', args: {} };
      const confirmationPromise = messageBus.requestConfirmation(toolCall, {});

      await new Promise((resolve) => setTimeout(resolve, 0));

      const request = requestHandler.mock
        .calls[0][0] as ToolConfirmationRequest;

      // Send wrong correlation ID first - should not resolve
      messageBus.respondToConfirmation(
        'wrong-id',
        ToolConfirmationOutcome.Cancel,
      );

      // Wait a bit to ensure wrong ID doesn't resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Send correct correlation ID
      messageBus.respondToConfirmation(
        request.correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );

      const result = await confirmationPromise;
      expect(result).toBe(true);

      messageBus.removeAllListeners();
    });

    it('should handle timeout for ASK_USER decisions', async () => {
      vi.useFakeTimers();

      const config: PolicyEngineConfig = {
        defaultDecision: PolicyDecision.ASK_USER,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const toolCall: FunctionCall = { name: 'edit', args: {} };
      const confirmationPromise = messageBus.requestConfirmation(toolCall, {});

      // Fast-forward past the 5-minute timeout
      vi.advanceTimersByTime(300000);

      const result = await confirmationPromise;
      expect(result).toBe(false); // Timeout = deny

      vi.useRealTimers();
      messageBus.removeAllListeners();
    });

    it('should process ALLOW decisions without publishing request', async () => {
      const config: PolicyEngineConfig = {
        rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const requestHandler = vi.fn();
      messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        requestHandler,
      );

      const toolCall: FunctionCall = { name: 'edit', args: {} };
      const result = await messageBus.requestConfirmation(toolCall, {});

      expect(result).toBe(true);
      expect(requestHandler).not.toHaveBeenCalled();

      messageBus.removeAllListeners();
    });

    it('should process DENY decisions and publish rejection', async () => {
      const config: PolicyEngineConfig = {
        rules: [{ toolName: 'shell', decision: PolicyDecision.DENY }],
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const rejectionHandler = vi.fn();
      messageBus.subscribe(
        MessageBusType.TOOL_POLICY_REJECTION,
        rejectionHandler,
      );

      const toolCall: FunctionCall = { name: 'shell', args: {} };
      const result = await messageBus.requestConfirmation(toolCall, {});

      expect(result).toBe(false);
      expect(rejectionHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_POLICY_REJECTION,
          toolCall,
          reason: 'Policy denied execution',
        }),
      );

      messageBus.removeAllListeners();
    });

    it('should handle requiresUserConfirmation flag in responses', async () => {
      const config: PolicyEngineConfig = {
        defaultDecision: PolicyDecision.ASK_USER,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const responseHandler = vi.fn();
      messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        responseHandler,
      );

      messageBus.respondToConfirmation(
        'test-id',
        ToolConfirmationOutcome.ProceedAlways,
        undefined,
        true,
      );

      expect(responseHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          correlationId: 'test-id',
          outcome: ToolConfirmationOutcome.ProceedAlways,
          confirmed: true,
          requiresUserConfirmation: true,
        }),
      );

      messageBus.removeAllListeners();
    });
  });

  describe('Discovered Tools Integration', () => {
    it('should enforce discovered_tool_ prefix in policy rules', async () => {
      const path = join(testDir, 'discovered.toml');
      // TOML priorities are integers 0-999, priority = 10 in tier 1 becomes 1.010
      const content = `
[[rule]]
toolName = "discovered_tool_"
decision = "ask_user"
priority = 10
`;
      await writeFile(path, content);

      const rules = await loadPolicyFromToml(path);
      const policyEngine = new PolicyEngine({ rules });

      // Discovered tool should match the prefix rule
      const discoveredDecision = policyEngine.evaluate(
        'discovered_tool_custom',
        {},
      );
      expect(discoveredDecision).toBe(PolicyDecision.ASK_USER);

      // Built-in tool should not match
      const builtInDecision = policyEngine.evaluate('edit', {});
      expect(builtInDecision).toBe(PolicyDecision.ASK_USER); // default
    });

    it('should validate MCP tools include serverName', async () => {
      const config: PolicyEngineConfig = {
        rules: [{ decision: PolicyDecision.ALLOW }],
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      // Valid MCP tool with correct serverName
      const validToolCall: FunctionCall = {
        name: 'myserver__tool',
        args: {},
      };
      const validResult = await messageBus.requestConfirmation(
        validToolCall,
        {},
        'myserver',
      );
      expect(validResult).toBe(true);

      messageBus.removeAllListeners();
    });

    it('should detect and deny spoofed server names', async () => {
      const config: PolicyEngineConfig = {
        rules: [{ decision: PolicyDecision.ALLOW }],
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const rejectionHandler = vi.fn();
      messageBus.subscribe(
        MessageBusType.TOOL_POLICY_REJECTION,
        rejectionHandler,
      );

      // Tool claims to be from 'trusted' but actually from 'malicious'
      const spoofedToolCall: FunctionCall = {
        name: 'trusted__tool',
        args: {},
      };
      const result = await messageBus.requestConfirmation(
        spoofedToolCall,
        {},
        'malicious',
      );

      expect(result).toBe(false);
      expect(rejectionHandler).toHaveBeenCalled();

      messageBus.removeAllListeners();
    });
  });

  describe('End-to-End Policy Flow', () => {
    it('should process complete flow: policy check → message bus → response', async () => {
      const path = join(testDir, 'e2e.toml');
      // TOML priorities are integers 0-999
      // priority = 50 in tier 1 becomes 1.050
      // priority = 10 in tier 1 becomes 1.010
      const content = `
[[rule]]
toolName = "glob"
decision = "allow"
priority = 50

[[rule]]
toolName = "edit"
decision = "ask_user"
priority = 10

[[rule]]
toolName = "shell"
decision = "deny"
priority = 10
`;
      await writeFile(path, content);

      const rules = await loadPolicyFromToml(path);
      const policyEngine = new PolicyEngine({ rules });
      const messageBus = new MessageBus(policyEngine);

      const requestHandler = vi.fn();
      const rejectionHandler = vi.fn();

      messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        requestHandler,
      );
      messageBus.subscribe(
        MessageBusType.TOOL_POLICY_REJECTION,
        rejectionHandler,
      );

      // Test ALLOW flow
      const globCall: FunctionCall = { name: 'glob', args: {} };
      const globResult = await messageBus.requestConfirmation(globCall, {});
      expect(globResult).toBe(true);
      expect(requestHandler).not.toHaveBeenCalled();

      // Test DENY flow
      const shellCall: FunctionCall = { name: 'shell', args: {} };
      const shellResult = await messageBus.requestConfirmation(shellCall, {});
      expect(shellResult).toBe(false);
      expect(rejectionHandler).toHaveBeenCalled();

      // Test ASK_USER flow
      const editCall: FunctionCall = { name: 'edit', args: {} };
      const editPromise = messageBus.requestConfirmation(editCall, {});

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requestHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
          toolCall: editCall,
        }),
      );

      const request = requestHandler.mock
        .calls[0][0] as ToolConfirmationRequest;
      messageBus.respondToConfirmation(
        request.correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );

      const editResult = await editPromise;
      expect(editResult).toBe(true);

      messageBus.removeAllListeners();
    });

    it('should handle concurrent tool confirmations', async () => {
      const config: PolicyEngineConfig = {
        defaultDecision: PolicyDecision.ASK_USER,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const requests: ToolConfirmationRequest[] = [];
      messageBus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (request) => {
          requests.push(request);
        },
      );

      // Start multiple confirmations concurrently
      const tool1: FunctionCall = { name: 'edit', args: { file: '1.ts' } };
      const tool2: FunctionCall = { name: 'edit', args: { file: '2.ts' } };
      const tool3: FunctionCall = { name: 'edit', args: { file: '3.ts' } };

      const promise1 = messageBus.requestConfirmation(tool1, { file: '1.ts' });
      const promise2 = messageBus.requestConfirmation(tool2, { file: '2.ts' });
      const promise3 = messageBus.requestConfirmation(tool3, { file: '3.ts' });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requests).toHaveLength(3);

      // Respond to each in different order
      messageBus.respondToConfirmation(
        requests[1].correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );
      messageBus.respondToConfirmation(
        requests[2].correlationId,
        ToolConfirmationOutcome.Cancel,
      );
      messageBus.respondToConfirmation(
        requests[0].correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );

      const results = await Promise.all([promise1, promise2, promise3]);

      expect(results[0]).toBe(true);
      expect(results[1]).toBe(true);
      expect(results[2]).toBe(false);

      messageBus.removeAllListeners();
    });
  });

  describe('Non-Interactive Mode', () => {
    it('should convert ASK_USER to DENY in non-interactive mode', async () => {
      const config: PolicyEngineConfig = {
        rules: [{ toolName: 'edit', decision: PolicyDecision.ASK_USER }],
        nonInteractive: true,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const rejectionHandler = vi.fn();
      messageBus.subscribe(
        MessageBusType.TOOL_POLICY_REJECTION,
        rejectionHandler,
      );

      const toolCall: FunctionCall = { name: 'edit', args: {} };
      const result = await messageBus.requestConfirmation(toolCall, {});

      expect(result).toBe(false);
      expect(rejectionHandler).toHaveBeenCalled();

      messageBus.removeAllListeners();
    });

    it('should still allow ALLOW decisions in non-interactive mode', async () => {
      const config: PolicyEngineConfig = {
        rules: [{ toolName: 'glob', decision: PolicyDecision.ALLOW }],
        nonInteractive: true,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const toolCall: FunctionCall = { name: 'glob', args: {} };
      const result = await messageBus.requestConfirmation(toolCall, {});

      expect(result).toBe(true);

      messageBus.removeAllListeners();
    });
  });

  describe('Multiple Subscribers', () => {
    it('should notify all subscribers of same message type', async () => {
      const config: PolicyEngineConfig = {
        defaultDecision: PolicyDecision.ASK_USER,
      };
      const policyEngine = new PolicyEngine(config);
      const messageBus = new MessageBus(policyEngine);

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler1);
      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler2);
      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, handler3);

      const toolCall: FunctionCall = { name: 'edit', args: {} };
      const confirmationPromise = messageBus.requestConfirmation(toolCall, {});

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();

      // All handlers should receive the same request
      const request1 = handler1.mock.calls[0][0] as ToolConfirmationRequest;
      const request2 = handler2.mock.calls[0][0] as ToolConfirmationRequest;
      const request3 = handler3.mock.calls[0][0] as ToolConfirmationRequest;

      expect(request1.correlationId).toBe(request2.correlationId);
      expect(request2.correlationId).toBe(request3.correlationId);

      // Respond to unblock
      messageBus.respondToConfirmation(
        request1.correlationId,
        ToolConfirmationOutcome.ProceedOnce,
      );
      await confirmationPromise;

      messageBus.removeAllListeners();
    });
  });

  describe('Error Handling', () => {
    it('should throw error if tool call has no name', async () => {
      const policyEngine = new PolicyEngine();
      const messageBus = new MessageBus(policyEngine);

      const toolCall: FunctionCall = { args: {} }; // No name

      await expect(
        messageBus.requestConfirmation(toolCall, {}),
      ).rejects.toThrow('Tool call must have a name');

      messageBus.removeAllListeners();
    });

    it('should handle invalid TOML gracefully', async () => {
      const path = join(testDir, 'invalid.toml');
      const content = 'this is not valid TOML [[[';
      await writeFile(path, content);

      await expect(loadPolicyFromToml(path)).rejects.toThrow();
    });

    it('should validate priority bands', async () => {
      const path = join(testDir, 'bad-priority.toml');
      // Priority must be an integer 0-999 in TOML
      // 5000 is out of range
      const content = `
[[rule]]
toolName = "edit"
decision = "allow"
priority = 5000
`;
      await writeFile(path, content);

      await expect(loadPolicyFromToml(path)).rejects.toThrow(
        'priority must be <= 999',
      );
    });
  });

  describe('Cleanup', () => {
    it('should clean up listeners when removeAllListeners is called', async () => {
      const policyEngine = new PolicyEngine();
      const messageBus = new MessageBus(policyEngine);

      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_REQUEST, vi.fn());
      messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_RESPONSE, vi.fn());

      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBeGreaterThan(0);

      messageBus.removeAllListeners();

      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(0);
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
    });

    it('should allow unsubscribe via returned function', async () => {
      const policyEngine = new PolicyEngine();
      const messageBus = new MessageBus(policyEngine);

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        handler1,
      );
      const unsubscribe2 = messageBus.subscribe(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        handler2,
      );

      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(2);

      unsubscribe1();

      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(1);

      unsubscribe2();

      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
      ).toBe(0);

      messageBus.removeAllListeners();
    });
  });
});
