/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  HookEventName,
  HookType,
  AfterModelHookOutput,
  AfterAgentHookOutput,
  DefaultHookOutput,
  BeforeAgentHookOutput,
  BeforeModelHookOutput,
} from './types.js';
import type { LLMResponse } from './types.js';
import { parseHookLLMRequestBoundaryResult } from './hookTranslator.js';

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

    it('should return translated modified response when llm_response exists', () => {
      const llmResponse: LLMResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: ['Modified response text'],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const hookOutput = new AfterModelHookOutput({
        hookSpecificOutput: {
          llm_response: llmResponse,
        },
      });

      const modifiedResponse = hookOutput.getModifiedResponse();

      expect(modifiedResponse).toBeDefined();
      expect(modifiedResponse?.candidates?.[0]?.content?.parts).toBeDefined();
    });

    it('should return modified response even when stop is requested if llm_response exists', () => {
      const llmResponse: LLMResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: ['Modified response text'],
            },
            finishReason: 'STOP',
          },
        ],
      };

      const hookOutput = new AfterModelHookOutput({
        continue: false,
        reason: 'Test stop',
        hookSpecificOutput: {
          llm_response: llmResponse,
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
    // H2: a messages-less llm_request (only model/config) must not throw and
    // must not destroy contents. The defensive guard in fromHookLLMRequest
    // handles undefined messages gracefully.
    it('H2: does not throw when llm_request has no messages array (only model)', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: {
            model: 'other-model',
            // NO messages array
          },
        },
      });
      const target = {
        model: 'original',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      };

      // Must not throw — defensive guard handles missing messages.
      expect(() =>
        hookOutput.applyLLMRequestModifications(target),
      ).not.toThrow();
    });

    it('H2: preserves the target model override when llm_request has no messages', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: {
            model: 'overridden-model',
          },
        },
      });
      const target = {
        model: 'original',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      };

      const result = hookOutput.applyLLMRequestModifications(target);
      // The model override is applied even without messages.
      expect(result.model).toBe('overridden-model');
    });

    it('H2: preserves the base request model when llm_request omits model (config-only hook)', () => {
      // A config-only hook (no model, no messages) must not clobber the
      // target's model with an explicit `undefined`. The defensive fallback
      // in fromHookLLMRequest preserves the base request's model.
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request: {
            // NO model, NO messages — config-only override
            config: { temperature: 0.5 },
          },
        },
      });
      const target = {
        model: 'original-model',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      };

      const result = hookOutput.applyLLMRequestModifications(target);
      // The target's original model is preserved (not clobbered by undefined).
      expect(result.model).toBe('original-model');
      // Contents are preserved.
      expect(result.contents).toStrictEqual([
        { role: 'user', parts: [{ text: 'hello' }] },
      ]);
    });

    it('returns the same target reference when no llm_request is present', () => {
      const hookOutput = new BeforeModelHookOutput({
        systemMessage: 'context',
      });
      const target = {
        model: 'm',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      };

      const result = hookOutput.applyLLMRequestModifications(target);
      expect(result).toBe(target);
    });
  });

  describe('BeforeModelHookOutput.getLLMRequestBoundary', () => {
    it('returns a typed boundary object when valid metadata is present', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            version: 1,
            pendingMessageStartIndex: 2,
            pendingMessageCount: 1,
          },
        },
      });
      const boundary = hookOutput.getLLMRequestBoundary();
      expect(boundary).toStrictEqual({
        version: 1,
        pendingMessageStartIndex: 2,
        pendingMessageCount: 1,
      });
    });

    it('returns undefined when no boundary metadata is present', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
        },
      });
      expect(hookOutput.getLLMRequestBoundary()).toBeUndefined();
    });

    it('returns undefined when hookSpecificOutput is absent', () => {
      const hookOutput = new BeforeModelHookOutput({});
      expect(hookOutput.getLLMRequestBoundary()).toBeUndefined();
    });

    it('returns undefined for a negative pendingMessageStartIndex', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: -1,
          },
        },
      });
      expect(hookOutput.getLLMRequestBoundary()).toBeUndefined();
    });

    it('returns undefined for a non-integer pendingMessageStartIndex', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: 1.5,
          },
        },
      });
      expect(hookOutput.getLLMRequestBoundary()).toBeUndefined();
    });

    it('returns undefined for a wrong version literal', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            version: 2,
            pendingMessageStartIndex: 0,
          },
        },
      });
      expect(hookOutput.getLLMRequestBoundary()).toBeUndefined();
    });

    it('returns undefined for an invalid onInvalidBoundary enum value', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: 0,
            onInvalidBoundary: 'panic',
          },
        },
      });
      expect(hookOutput.getLLMRequestBoundary()).toBeUndefined();
    });

    it('tolerates an omitted pendingMessageCount', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: 1,
          },
        },
      });
      const boundary = hookOutput.getLLMRequestBoundary();
      expect(boundary).toStrictEqual({ pendingMessageStartIndex: 1 });
    });

    it('strips unknown extra fields (zod strips unknown fields by default)', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            pendingMessageStartIndex: 0,
            pendingMessageCount: 1,
            bogus: 'nope',
          } as unknown,
        },
      });
      const boundary = hookOutput.getLLMRequestBoundary();
      expect(boundary).toStrictEqual({
        pendingMessageStartIndex: 0,
        pendingMessageCount: 1,
      });
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
            version: 1,
            pendingMessageStartIndex: 2,
            pendingMessageCount: 1,
          },
        },
      });
      const result = hookOutput.getLLMRequestBoundaryResult();
      expect(result).toStrictEqual({
        status: 'valid',
        boundary: {
          version: 1,
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
    // is 1). The discriminated result must be malformed with the default
    // skip-compression policy, NOT absent.
    it('F3: returns status malformed (skip-compression) for a wrong version literal', () => {
      const hookOutput = new BeforeModelHookOutput({
        hookSpecificOutput: {
          hookEventName: 'BeforeModel',
          llm_request_boundary: {
            version: 2,
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
