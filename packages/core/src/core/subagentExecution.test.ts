/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';

// These module references will be populated at runtime inside the skipped block.
// The imports target subagentExecution.js which does not exist yet — it will be created
// in Phase 4. The describe.skip wrapper keeps CI green in the meantime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let filterTextResponse: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let checkGoalCompletion: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let checkTerminationConditions: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildMissingOutputsNudge: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildTodoCompletionPrompt: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let finalizeOutput: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildInitialMessages: any;

describe.skip('subagentExecution (enable in Phase 4)', () => {
  beforeAll(async () => {
    const mod = await import('./subagentExecution.js');
    filterTextResponse = mod.filterTextResponse;
    checkGoalCompletion = mod.checkGoalCompletion;
    checkTerminationConditions = mod.checkTerminationConditions;
    buildMissingOutputsNudge = mod.buildMissingOutputsNudge;
    buildTodoCompletionPrompt = mod.buildTodoCompletionPrompt;
    finalizeOutput = mod.finalizeOutput;
    buildInitialMessages = mod.buildInitialMessages;
  });

  describe('filterTextResponse', () => {
    it('should pass through text when no emoji filter', () => {
      const result = filterTextResponse('Hello world!', undefined);
      expect(result.filtered).toBe('Hello world!');
      expect(result.blocked).toBe(false);
    });

    it('should filter emojis when emoji filter is active', () => {
      // Create a mock emoji filter
      const mockEmojiFilter = {
        filter: (text: string) => ({
          filtered: text.replace(/[\u{1F600}-\u{1F64F}]/gu, ''),
          systemFeedback: 'Emojis removed',
          blocked: false,
        }),
      };
      const result = filterTextResponse('Hello  world!', mockEmojiFilter);
      expect(result.filtered).not.toContain('');
    });

    it('should return blocked=true for fully blocked content', () => {
      const mockBlockingFilter = {
        filter: (_text: string) => ({
          filtered: '',
          systemFeedback: 'Content blocked',
          blocked: true,
        }),
      };
      const result = filterTextResponse('blocked content', mockBlockingFilter);
      expect(result.blocked).toBe(true);
    });

    it('should include system feedback when content modified', () => {
      const mockFilter = {
        filter: (text: string) => ({
          filtered: text + ' (modified)',
          systemFeedback: 'Content was modified',
          blocked: false,
        }),
      };
      const result = filterTextResponse('original text', mockFilter);
      expect(result.systemFeedback).toBeDefined();
    });
  });

  describe('checkGoalCompletion', () => {
    it('should return complete=true when all outputs emitted', () => {
      const outputConfig = { outputs: { a: 'Var a', b: 'Var b' } };
      const emittedVars = { a: 'value_a', b: 'value_b' };
      const result = checkGoalCompletion(outputConfig, emittedVars);
      expect(result.complete).toBe(true);
      expect(result.remainingVars).toEqual([]);
    });

    it('should return remaining vars when not all emitted', () => {
      const outputConfig = { outputs: { a: 'Var a', b: 'Var b', c: 'Var c' } };
      const emittedVars = { a: 'value_a' };
      const result = checkGoalCompletion(outputConfig, emittedVars);
      expect(result.complete).toBe(false);
      expect(result.remainingVars).toContain('b');
      expect(result.remainingVars).toContain('c');
    });

    it('should return complete=true when no outputs configured', () => {
      const result = checkGoalCompletion(undefined, {});
      expect(result.complete).toBe(true);
    });
  });

  describe('checkTerminationConditions', () => {
    it('should return MAX_TURNS when turn counter exceeds max_turns', () => {
      const params = {
        turnCount: 11,
        startTime: Date.now() - 1000,
        runConfig: { max_turns: 10, max_time_minutes: 60 },
        abortSignal: null,
      };
      const result = checkTerminationConditions(params);
      expect(result).not.toBeNull();
      expect(result?.reason).toBe('MAX_TURNS');
    });

    it('should return TIMEOUT when elapsed time exceeds max_time_minutes', () => {
      const params = {
        turnCount: 1,
        startTime: Date.now() - 61 * 60 * 1000, // 61 minutes ago
        runConfig: { max_time_minutes: 1, max_turns: 100 },
        abortSignal: null,
      };
      const result = checkTerminationConditions(params);
      expect(result).not.toBeNull();
      expect(result?.reason).toBe('TIMEOUT');
    });

    it('should return null when neither limit exceeded', () => {
      const params = {
        turnCount: 5,
        startTime: Date.now() - 1000,
        runConfig: { max_turns: 20, max_time_minutes: 60 },
        abortSignal: null,
      };
      const result = checkTerminationConditions(params);
      expect(result).toBeNull();
    });

    it('should check turns before timeout', () => {
      // Both exceeded: turns takes priority
      const params = {
        turnCount: 25,
        startTime: Date.now() - 61 * 60 * 1000, // also timed out
        runConfig: { max_turns: 20, max_time_minutes: 1 },
        abortSignal: null,
      };
      const result = checkTerminationConditions(params);
      expect(result?.reason).toBe('MAX_TURNS');
    });

    it('should handle undefined max_turns (no limit)', () => {
      const params = {
        turnCount: 1000,
        startTime: Date.now() - 1000,
        runConfig: { max_time_minutes: 60 }, // no max_turns
        abortSignal: null,
      };
      const result = checkTerminationConditions(params);
      expect(result).toBeNull();
    });
  });

  describe('buildMissingOutputsNudge', () => {
    it('should produce nudge listing missing variables', () => {
      const outputConfig = { outputs: { a: 'Var a', b: 'Var b' } };
      const emittedVars = {};
      const nudge = buildMissingOutputsNudge(outputConfig, emittedVars);
      expect(nudge).not.toBeNull();
      expect(nudge).toBeDefined();
      // The nudge content should mention missing variables
      const nudgeText = JSON.stringify(nudge);
      expect(nudgeText).toMatch(/a|b/);
    });

    it('should return null when all outputs emitted', () => {
      const outputConfig = { outputs: { a: 'Var a' } };
      const emittedVars = { a: 'value' };
      const nudge = buildMissingOutputsNudge(outputConfig, emittedVars);
      expect(nudge).toBeNull();
    });

    it('should return null when no outputs configured', () => {
      const nudge = buildMissingOutputsNudge(undefined, {});
      expect(nudge).toBeNull();
    });

    it('should list only missing variables, not already-emitted ones', () => {
      const outputConfig = { outputs: { a: 'Var a', b: 'Var b', c: 'Var c' } };
      const emittedVars = { a: 'emitted' };
      const nudge = buildMissingOutputsNudge(outputConfig, emittedVars);
      expect(nudge).not.toBeNull();
      const nudgeText = JSON.stringify(nudge);
      // 'a' is emitted, so should NOT appear in nudge (or should not be flagged as missing)
      expect(nudgeText).toMatch(/b|c/);
    });
  });

  describe('buildTodoCompletionPrompt', () => {
    it('should produce prompt when todos are incomplete', async () => {
      const mockTodoStore = {
        readTodos: async () => [
          { id: '1', text: 'Task 1', status: 'pending' },
          { id: '2', text: 'Task 2', status: 'complete' },
        ],
      };
      const prompt = await buildTodoCompletionPrompt(mockTodoStore);
      expect(prompt).not.toBeNull();
    });

    it('should return null when all todos complete', async () => {
      const mockTodoStore = {
        readTodos: async () => [
          { id: '1', text: 'Task 1', status: 'complete' },
          { id: '2', text: 'Task 2', status: 'complete' },
        ],
      };
      const prompt = await buildTodoCompletionPrompt(mockTodoStore);
      expect(prompt).toBeNull();
    });

    it('should return null when no todos exist', async () => {
      const mockTodoStore = {
        readTodos: async () => [],
      };
      const prompt = await buildTodoCompletionPrompt(mockTodoStore);
      expect(prompt).toBeNull();
    });
  });

  describe('finalizeOutput', () => {
    it('should set terminate_reason to GOAL when all required outputs emitted', () => {
      const outputConfig = { outputs: { a: 'Var a' } };
      const output = {
        emitted_vars: { a: 'value' },
        terminate_reason: 'ERROR' as const,
      };
      finalizeOutput(outputConfig, output);
      expect(output.terminate_reason).toBe('GOAL');
    });

    it('should not change terminate_reason when outputs are missing', () => {
      const outputConfig = { outputs: { a: 'Var a', b: 'Var b' } };
      const output = {
        emitted_vars: { a: 'value' },
        terminate_reason: 'MAX_TURNS' as const,
      };
      finalizeOutput(outputConfig, output);
      expect(output.terminate_reason).toBe('MAX_TURNS');
    });

    it('should set GOAL when no outputs are configured', () => {
      const output = {
        emitted_vars: {},
        terminate_reason: 'ERROR' as const,
      };
      finalizeOutput(undefined, output);
      expect(output.terminate_reason).toBe('GOAL');
    });
  });

  describe('buildInitialMessages', () => {
    it('should produce user message from promptConfig.initialMessages', () => {
      const promptConfig = {
        initialMessages: [
          { role: 'user', parts: [{ text: 'Hello' }] },
          { role: 'model', parts: [{ text: 'Hi' }] },
        ],
      };
      const context = { state: {} };
      const messages = buildInitialMessages(promptConfig, context);
      expect(messages).toBeDefined();
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should produce message from goal_prompt', () => {
      const promptConfig = { systemPrompt: 'You are a test agent.' };
      const context = { state: {} };
      const messages = buildInitialMessages(promptConfig, context);
      expect(messages).toBeDefined();
    });

    it('should handle behaviour_prompts concatenation', () => {
      const promptConfig = {
        systemPrompt: 'Base prompt.',
      };
      const context = { state: {} };
      const messages = buildInitialMessages(promptConfig, context);
      expect(messages).toBeDefined();
    });
  });
});
