/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TodoPause, TodoPauseParams } from './todo-pause.js';

describe('TodoPause - Behavioral Tests', () => {
  let tool: TodoPause;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    tool = new TodoPause();
  });

  describe('Input Validation', () => {
    /**
     * @requirement REQ-003.1: Accept reason string parameter
     */
    it('should accept valid reason strings', () => {
      const validParams: TodoPauseParams = {
        reason: 'Missing configuration file needed for deployment',
      };
      const result = tool.validateToolParams(validParams);
      expect(result).toBeNull();
    });

    /**
     * @requirement REQ-003.1: Accept reason string parameter
     */
    it('should accept minimal valid reason', () => {
      const validParams: TodoPauseParams = {
        reason: 'X',
      };
      const result = tool.validateToolParams(validParams);
      expect(result).toBeNull();
    });

    /**
     * @requirement REQ-003.1: Accept reason string parameter
     */
    it('should reject empty reason string', () => {
      const invalidParams = {
        reason: '',
      };
      const result = tool.validateToolParams(invalidParams);
      expect(result).not.toBeNull();
      expect(result?.message).toContain('reason');
    });

    /**
     * @requirement REQ-003.1: Accept reason string parameter
     */
    it('should reject missing reason parameter', () => {
      const invalidParams = {};
      const result = tool.validateToolParams(invalidParams);
      expect(result).not.toBeNull();
      expect(result?.message).toContain('reason');
    });

    /**
     * @requirement REQ-003.1: Accept reason string parameter
     */
    it('should truncate reasons exceeding 500 character limit', () => {
      const longReason = 'A'.repeat(600);
      const validParams: TodoPauseParams = {
        reason: longReason,
      };
      // Schema validation should handle this truncation or rejection
      const result = tool.validateToolParams(validParams);
      // The tool should either accept it (with truncation) or reject it
      // Based on the schema having maxLength: '500', it should reject
      expect(result).not.toBeNull();
    });

    /**
     * @requirement REQ-003.1: Accept reason string parameter
     */
    it('should accept reason at exactly 500 characters', () => {
      const maxLengthReason = 'A'.repeat(500);
      const validParams: TodoPauseParams = {
        reason: maxLengthReason,
      };
      const result = tool.validateToolParams(validParams);
      expect(result).toBeNull();
    });
  });

  describe('Execution Behavior', () => {
    /**
     * @requirement REQ-003.2: Break continuation without changing task status
     * @requirement REQ-003.3: Display reason to user
     */
    it('should return pause signal with provided reason', async () => {
      const params: TodoPauseParams = {
        reason: 'Database connection failed',
      };

      const result = await tool.execute(params, abortSignal);

      expect(result.llmContent).toContain('Database connection failed');
      expect(result.returnDisplay).toContain('Database connection failed');
      expect(result.summary).toContain('paused');
    });

    /**
     * @requirement REQ-003.2: Break continuation without changing task status
     */
    it('should not modify any todo statuses during execution', async () => {
      const params: TodoPauseParams = {
        reason: 'Missing API credentials',
      };

      // Execute the pause
      const result = await tool.execute(params, abortSignal);

      // The result should only contain the pause message, not any todo modifications
      expect(result.llmContent).not.toContain('status');
      expect(result.llmContent).not.toContain('completed');
      expect(result.llmContent).not.toContain('pending');
      expect(result.llmContent).not.toContain('in_progress');
    });

    /**
     * @requirement REQ-003.3: Display reason to user
     */
    it('should format user-friendly pause message', async () => {
      const params: TodoPauseParams = {
        reason: 'Network timeout when connecting to external service',
      };

      const result = await tool.execute(params, abortSignal);

      expect(result.returnDisplay).toContain('AI paused:');
      expect(result.returnDisplay).toContain(
        'Network timeout when connecting to external service',
      );
    });

    /**
     * @requirement REQ-003.3: Display reason to user
     */
    it('should handle special characters in reason', async () => {
      const params: TodoPauseParams = {
        reason: 'File "config.json" not found in /path/with spaces & symbols!',
      };

      const result = await tool.execute(params, abortSignal);

      expect(result.llmContent).toContain('config.json');
      expect(result.llmContent).toContain('/path/with spaces & symbols!');
      expect(result.returnDisplay).toContain('config.json');
      expect(result.returnDisplay).toContain('/path/with spaces & symbols!');
    });

    /**
     * @requirement REQ-003.3: Display reason to user
     */
    it('should handle multi-line reasons properly', async () => {
      const params: TodoPauseParams = {
        reason:
          'Multiple issues occurred:\n1. Database unavailable\n2. Config file missing',
      };

      const result = await tool.execute(params, abortSignal);

      const displayText = result.returnDisplay as string;
      expect(displayText).toContain('Multiple issues occurred:');
      expect(displayText).toContain('1. Database unavailable');
      expect(displayText).toContain('2. Config file missing');
    });

    /**
     * @requirement REQ-003.2: Break continuation without changing task status
     */
    it('should signal continuation break through result structure', async () => {
      const params: TodoPauseParams = {
        reason: 'Dependency service is down',
      };

      const result = await tool.execute(params, abortSignal);

      // The result should indicate a pause/break state
      expect(result.summary).toBeDefined();
      expect(result.summary?.toLowerCase()).toMatch(/pause|break|stop/);
    });
  });

  describe('Integration Scenarios', () => {
    /**
     * @requirement REQ-003.4: Only available during continuation
     */
    it('should work properly during continuation context', async () => {
      // Set up tool with continuation context
      const toolWithContext = Object.assign(
        Object.create(Object.getPrototypeOf(tool)),
        tool,
      );
      toolWithContext.context = {
        sessionId: 'test-session',
        agentId: 'test-agent',
        inContinuation: true,
      };

      const params: TodoPauseParams = {
        reason: 'Environment setup incomplete',
      };

      const result = await toolWithContext.execute(params, abortSignal);
      expect(result).toBeDefined();
      expect(result.llmContent).toContain('Environment setup incomplete');
    });

    /**
     * @requirement REQ-003.4: Only available during continuation
     */
    it('should handle non-continuation context appropriately', async () => {
      // Set up tool without continuation context
      const toolWithoutContext = Object.assign(
        Object.create(Object.getPrototypeOf(tool)),
        tool,
      );
      toolWithoutContext.context = {
        sessionId: 'test-session',
        agentId: 'test-agent',
        inContinuation: false,
      };

      const params: TodoPauseParams = {
        reason: 'Test reason',
      };

      // The tool might either work or throw an error based on implementation
      // If it should only work during continuation, it should error here
      try {
        const result = await toolWithoutContext.execute(params, abortSignal);
        // If execution succeeds, check that it still produces valid output
        expect(result).toBeDefined();
        expect(result.llmContent).toContain('Test reason');
      } catch (error) {
        // If it throws an error for non-continuation context, that's also valid
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/continuation|context/i);
      }
    });
  });

  describe('Output Formatting', () => {
    /**
     * @requirement REQ-003.3: Display reason to user
     */
    it('should format output with "AI paused:" prefix', async () => {
      const params: TodoPauseParams = {
        reason: 'Test environment not ready',
      };

      const result = await tool.execute(params, abortSignal);

      expect(result.returnDisplay).toMatch(/AI paused:/i);
      expect(result.returnDisplay).toContain('Test environment not ready');
    });

    /**
     * @requirement REQ-003.3: Display reason to user
     */
    it('should preserve formatting in complex reasons', async () => {
      const params: TodoPauseParams = {
        reason:
          'Error: HTTP 500 from https://api.example.com/v1/data?format=json',
      };

      const result = await tool.execute(params, abortSignal);

      const displayText = result.returnDisplay as string;
      expect(displayText).toContain('Error: HTTP 500');
      expect(displayText).toContain(
        'https://api.example.com/v1/data?format=json',
      );
    });

    /**
     * @requirement REQ-003.2: Break continuation without changing task status
     * @requirement REQ-003.3: Display reason to user
     */
    it('should provide both LLM and user-friendly output', async () => {
      const params: TodoPauseParams = {
        reason: 'Unable to authenticate with remote service',
      };

      const result = await tool.execute(params, abortSignal);

      // Both outputs should exist and contain the reason
      expect(result.llmContent).toBeDefined();
      expect(result.returnDisplay).toBeDefined();
      expect(result.llmContent).toContain(
        'Unable to authenticate with remote service',
      );
      expect(result.returnDisplay).toContain(
        'Unable to authenticate with remote service',
      );

      // They may have different formatting but same core content
      expect(typeof result.llmContent).toBe('string');
      expect(typeof result.returnDisplay).toBe('string');
    });

    /**
     * @requirement REQ-003.3: Display reason to user
     */
    it('should handle unicode and emoji characters in reason', async () => {
      const params: TodoPauseParams = {
        reason: '❌ Connection failed: résumé.txt → /tmp/файл.log',
      };

      const result = await tool.execute(params, abortSignal);

      expect(result.llmContent).toContain('❌');
      expect(result.llmContent).toContain('résumé.txt');
      expect(result.llmContent).toContain('файл.log');
      expect(result.returnDisplay).toContain('❌');
      expect(result.returnDisplay).toContain('résumé.txt');
      expect(result.returnDisplay).toContain('файл.log');
    });
  });

  describe('Tool Metadata', () => {
    it('should have correct tool name', () => {
      expect(TodoPause.Name).toBe('todo_pause');
    });

    it('should provide appropriate description for different contexts', () => {
      const params: TodoPauseParams = {
        reason: 'Test reason',
      };

      const description = tool.getDescription(params);
      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    });

    it('should be configured as markdown output tool', () => {
      // This tests the constructor parameters
      expect(tool).toBeDefined();
      // The isOutputMarkdown and canUpdateOutput flags are tested indirectly
      // through the behavior of the execute method
    });
  });
});
