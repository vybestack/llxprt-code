/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  HookEventName,
  HookType,
  AfterModelHookOutput,
  AfterAgentHookOutput,
  DefaultHookOutput,
  BeforeAgentHookOutput,
  BeforeModelHookOutput,
} from './types.js';
import type { IContent } from '../services/history/IContent.js';
import type { HookLLMRequest } from './hookTranslator.js';
import { parseHookLLMRequestBoundaryResult } from './hookTranslator.js';

const v2Response = (text: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'text', text }],
});

describe('Hook Types', () => {
  describe('HookEventName', () => {
    it('should contain all required event names', () => {
      const expectedEvents = [
        'BeforeTool',
        'AfterTool',
        'BeforeAgent',
        'Notification',
        'AfterAgent',
        'SessionStart',
        'SessionEnd',
        'PreCompress',
        'BeforeModel',
        'AfterModel',
        'BeforeToolSelection',
      ];

      for (const event of expectedEvents) {
        expect(Object.values(HookEventName)).toContain(event);
      }
    });
  });

  describe('HookType', () => {
    it('should contain command type', () => {
      expect(HookType.Command).toBe('command');
    });
  });

  describe('AfterModelHookOutput.getModifiedResponse', () => {
    it('should return undefined when stop is requested and no llm_response', () => {
      const hookOutput = new AfterModelHookOutput({
        continue: false,
        reason: 'Test stop',
      });

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeUndefined();
    });

    it('should return decoded modified response when llm_response exists', () => {
      const hookOutput = new AfterModelHookOutput({
        hookSpecificOutput: {
          llm_response: {
            version: 2,
            content: v2Response('Modified response text'),
            finishReason: 'stop',
          },
        },
      });

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeDefined();
      expect(modifiedResponse?.version).toBe(2);
      expect(modifiedResponse?.content.blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Modified response text',
      });
      expect(modifiedResponse?.finishReason).toBe('stop');
    });

    it('should return modified response even when stop is requested if llm_response exists', () => {
      const hookOutput = new AfterModelHookOutput({
        continue: false,
        reason: 'Test stop',
        hookSpecificOutput: {
          llm_response: {
            content: v2Response('Modified response text'),
          },
        },
      });

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeDefined();
    });

    it('should return undefined when no llm_response and no stop', () => {
      const hookOutput = new AfterModelHookOutput({});

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeUndefined();
    });
  });

  describe('DefaultHookOutput.shouldClearContext', () => {
    it('should return false by default', () => {
      const hookOutput = new DefaultHookOutput({});
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput is undefined', () => {
      const hookOutput = new DefaultHookOutput({});
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput has no clearContext', () => {
      const hookOutput = new DefaultHookOutput({
        hookSpecificOutput: { additionalContext: 'test' },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when clearContext is explicitly false', () => {
      const hookOutput = new DefaultHookOutput({
        hookSpecificOutput: { clearContext: false },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });
  });

  describe('AfterAgentHookOutput.shouldClearContext', () => {
    it('should return true when clearContext is true in hookSpecificOutput', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: { clearContext: true },
      });
      expect(hookOutput.shouldClearContext()).toBe(true);
    });

    it('should return true when clearContext is true alongside other fields', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: {
          hookEventName: 'AfterAgent',
          additionalContext: 'some context',
          clearContext: true,
        },
      });
      expect(hookOutput.shouldClearContext()).toBe(true);
    });

    it('should return false when clearContext is not present', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: { additionalContext: 'some context' },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when clearContext is false', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: { clearContext: false },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput is undefined', () => {
      const hookOutput = new AfterAgentHookOutput({});
      expect(hookOutput.shouldClearContext()).toBe(false);
    });

    it('should return false when hookSpecificOutput is empty', () => {
      const hookOutput = new AfterAgentHookOutput({
        hookSpecificOutput: {},
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });
  });

  describe('BeforeAgentHookOutput.shouldClearContext', () => {
    it('should return false (BeforeAgent does not support clearContext)', () => {
      const hookOutput = new BeforeAgentHookOutput({
        hookSpecificOutput: { clearContext: true },
      });
      expect(hookOutput.shouldClearContext()).toBe(false);
    });
  });

  describe('BeforeModelHookOutput.applyLLMRequestModifications', () => {
    const target: HookLLMRequest = {
      version: 2,
      model: 'original',
      contents: [
        { speaker: 'user', blocks: [{ type: 'text', text: 'hello' }] },
      ],
      settings: { temperature: 0.2 },
    };

    // H2: a contents-less llm_request (only model/settings) must not throw
    // and must not destroy the target contents.
    it('H2: does not throw when llm_request has no contents array (only model)', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: {
            model: 'other-model',
            // NO contents array
          },
        },
      });

      expect(() =>
        hookOutput.applyLLMRequestModifications(target),
      ).not.toThrow();
    });

    it('H2: applies the model override when llm_request has no contents', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: {
            model: 'overridden-model',
          },
        },
      });

      const result = hookOutput.applyLLMRequestModifications(target);
      expect(result.model).toBe('overridden-model');
    });

    it('H2: preserves the base request model when llm_request omits model (settings-only hook)', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: {
            // NO model, NO contents — settings-only override
            settings: { temperature: 0.5 },
          },
        },
      });

      const result = hookOutput.applyLLMRequestModifications(target);
      expect(result.model).toBe('original');
      expect(result.contents).toStrictEqual(target.contents);
    });

    it('replaces contents when the hook supplies an array', () => {
      const replacement = [
        { speaker: 'user', blocks: [{ type: 'text', text: 'replaced' }] },
      ];
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: { contents: replacement },
        },
      });

      const result = hookOutput.applyLLMRequestModifications(target);
      expect(result.contents).toBe(replacement);
    });

    // F1 (v2 full fidelity): a hook replacement carrying tool_call blocks
    // must reach the modified request verbatim — no text-only round-trip
    // may strip or re-encode them.
    it('replaces contents verbatim when the hook supplies tool_call blocks', () => {
      const replacement: IContent[] = [
        {
          speaker: 'user',
          blocks: [
            { type: 'text', text: 'run the tool' },
            {
              type: 'tool_call',
              id: 'call-9',
              name: 'bash',
              parameters: { command: 'ls -la' },
            },
          ],
        },
      ];
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: { contents: replacement },
        },
      });

      const result = hookOutput.applyLLMRequestModifications(target);
      expect(result.contents).toBe(replacement);
      expect(result.contents[0]?.blocks[1]).toStrictEqual({
        type: 'tool_call',
        id: 'call-9',
        name: 'bash',
        parameters: { command: 'ls -la' },
      });
    });

    it('shallow-merges settings without clobbering untouched keys', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: { settings: { maxOutputTokens: 512 } },
        },
      });

      const result = hookOutput.applyLLMRequestModifications(target);
      expect(result.settings).toStrictEqual({
        temperature: 0.2,
        maxOutputTokens: 512,
      });
    });

    it('returns the same target reference when no llm_request is present', () => {
      const hookOutput = new BeforeModelHookOutput({
        systemMessage: 'context',
      });

      const result = hookOutput.applyLLMRequestModifications(target);
      expect(result).toBe(target);
    });
  });

  describe('BeforeModelHookOutput.getLLMRequestBoundaryResult', () => {
    it('returns status absent when no boundary metadata is present', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: { hookEventName: 'BeforeModel' },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({ status: 'absent' });
    });

    it('returns status absent when hookSpecificOutput is absent', () => {
      const hookOutput = new BeforeModelHookOutput({});
      expect(hookOutput.getLLMRequestBoundaryResult()).toStrictEqual({
        status: 'absent',
      });
    });

    it('returns status valid with the boundary when metadata is well-formed', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            version: 2,
            pendingMessageStartIndex: 2,
            pendingMessageCount: 1,
          },
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'valid',
        boundary: {
          version: 2,
          pendingMessageStartIndex: 2,
          pendingMessageCount: 1,
        },
      });
    });

    it('returns status malformed with skip-compression default for a negative index', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: { pendingMessageStartIndex: -1 },
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    it('returns status malformed preserving onInvalidBoundary throw when readable', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: -1,
            onInvalidBoundary: 'throw',
          },
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'throw',
      });
    });

    it('returns status malformed for a non-integer index even with a throw policy', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: 1.5,
            onInvalidBoundary: 'throw',
          },
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'throw',
      });
    });

    // F3: a wrong version literal is structurally invalid (zod version literal
    // is 2). The discriminated result must be malformed with the default
    // skip-compression policy, NOT absent.
    it('F3: returns status malformed (skip-compression) for a wrong version literal', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            version: 1,
            pendingMessageStartIndex: 0,
          },
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    it('returns status malformed (skip-compression) for an invalid onInvalidBoundary enum', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: 0,
            onInvalidBoundary: 'panic',
          },
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    // G2: key PRESENCE decides absence, not truthiness. A hook that sets
    // llm_request_boundary: null explicitly attempted to control the boundary.
    it('returns status malformed (skip-compression) when llm_request_boundary is explicitly null', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: null,
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    // G2: explicit undefined is indistinguishable from absent after JSON
    // parsing (key-present-with-explicit-undefined === absent in JS conventions).
    it('returns status absent when llm_request_boundary is explicitly undefined', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: undefined,
        },
      });
      expect(hookOutput.getLLMRequestBoundaryResult()).toStrictEqual({
        status: 'absent',
      });
    });
  });

  describe('parseHookLLMRequestBoundaryResult', () => {
    it('returns absent for undefined (key not present / "not provided")', () => {
      expect(parseHookLLMRequestBoundaryResult(undefined)).toStrictEqual({
        status: 'absent',
      });
    });

    it('returns malformed (skip-compression) for present-but-falsy null', () => {
      // G2: key PRESENCE decides absence, not truthiness. A hook that
      // explicitly sets llm_request_boundary: null attempted to control the
      // boundary; it must be malformed (skip-compression), not absent.
      expect(parseHookLLMRequestBoundaryResult(null)).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    it('returns malformed (skip-compression) for present-but-falsy false', () => {
      expect(parseHookLLMRequestBoundaryResult(false)).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    it('returns malformed (skip-compression) for present-but-falsy 0', () => {
      expect(parseHookLLMRequestBoundaryResult(0)).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    it('returns malformed (skip-compression) for present-but-falsy empty string', () => {
      expect(parseHookLLMRequestBoundaryResult('')).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    it('returns valid for a well-formed boundary', () => {
      expect(
        parseHookLLMRequestBoundaryResult({
          pendingMessageStartIndex: 1,
          pendingMessageCount: 2,
        }),
      ).toStrictEqual({
        status: 'valid',
        boundary: { pendingMessageStartIndex: 1, pendingMessageCount: 2 },
      });
    });

    it('returns malformed (skip-compression) for a structurally invalid value', () => {
      expect(
        parseHookLLMRequestBoundaryResult({ pendingMessageStartIndex: -1 }),
      ).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });

    it('returns malformed preserving a readable throw policy', () => {
      expect(
        parseHookLLMRequestBoundaryResult({
          pendingMessageStartIndex: 'not-a-number',
          onInvalidBoundary: 'throw',
        }),
      ).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'throw',
      });
    });

    // F2: explicit present=false overrides a non-undefined value — the caller
    // (BeforeModelHookOutput.getLLMRequestBoundaryResult) has key context
    // (hasOwnProperty) and passes present explicitly. An absent key with a
    // structurally-valid-looking value in the output object must be absent.
    it('F2: explicit present=false overrides a non-undefined value to absent', () => {
      expect(
        parseHookLLMRequestBoundaryResult(
          { pendingMessageStartIndex: 0 },
          false,
        ),
      ).toStrictEqual({ status: 'absent' });
    });

    // F2: explicit present=true with an undefined value — a present key whose
    // value is structurally invalid (undefined fails zod parse) is malformed,
    // defaulting to skip-compression.
    it('F2: explicit present=true with an undefined value is malformed (skip-compression)', () => {
      expect(parseHookLLMRequestBoundaryResult(undefined, true)).toStrictEqual({
        status: 'malformed',
        onInvalidBoundary: 'skip-compression',
      });
    });
  });
});
