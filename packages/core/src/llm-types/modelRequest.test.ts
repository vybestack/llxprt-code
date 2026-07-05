/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-006.1, REQ-006.2, REQ-006.3
 * @pseudocode lines 60-64
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import type {
  ReasoningConfig,
  ModelGenerationSettings,
  ModelGenerationRequest,
} from './modelRequest.js';
import type {
  IContent,
  TextBlock,
  ToolCallBlock,
  ThinkingBlock,
} from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// ReasoningConfig
// ---------------------------------------------------------------------------

describe('ReasoningConfig', () => {
  it('constructs with budgetTokens only', () => {
    const rc: ReasoningConfig = { budgetTokens: 1024 };
    expect(rc.budgetTokens).toBe(1024);
  });

  it('constructs with effort only', () => {
    const rc: ReasoningConfig = { effort: 'high' };
    expect(rc.effort).toBe('high');
  });

  it('constructs with includeInOutput only', () => {
    const rc: ReasoningConfig = { includeInOutput: true };
    expect(rc.includeInOutput).toBe(true);
  });

  it('constructs with all fields', () => {
    const rc: ReasoningConfig = {
      budgetTokens: 2048,
      effort: 'medium',
      includeInOutput: false,
    };
    expect(rc).toStrictEqual({
      budgetTokens: 2048,
      effort: 'medium',
      includeInOutput: false,
    });
  });

  it('accepts each effort level', () => {
    const low: ReasoningConfig = { effort: 'low' };
    const med: ReasoningConfig = { effort: 'medium' };
    const high: ReasoningConfig = { effort: 'high' };
    expect(low.effort).toBe('low');
    expect(med.effort).toBe('medium');
    expect(high.effort).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// ModelGenerationSettings
// ---------------------------------------------------------------------------

describe('ModelGenerationSettings', () => {
  it('constructs with all fields', () => {
    const settings: ModelGenerationSettings = {
      temperature: 0.7,
      maxOutputTokens: 4096,
      systemInstruction: 'You are helpful.',
      reasoning: { budgetTokens: 1024 },
      toolChoice: { mode: 'auto' },
    };
    expect(settings.temperature).toBe(0.7);
    expect(settings.maxOutputTokens).toBe(4096);
    expect(settings.systemInstruction).toBe('You are helpful.');
    expect(settings.reasoning?.budgetTokens).toBe(1024);
    expect(settings.toolChoice?.mode).toBe('auto');
  });

  it('constructs empty object', () => {
    const settings: ModelGenerationSettings = {};
    expect(settings).toStrictEqual({});
  });

  it('toolChoice with allowedToolNames', () => {
    const settings: ModelGenerationSettings = {
      toolChoice: { mode: 'required', allowedToolNames: ['a', 'b'] },
    };
    expect(settings.toolChoice?.allowedToolNames).toStrictEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// ModelGenerationRequest
// ---------------------------------------------------------------------------

describe('ModelGenerationRequest', () => {
  function textBlock(text: string): TextBlock {
    return { type: 'text', text };
  }

  it('constructs with contents only', () => {
    const contents: IContent[] = [
      { speaker: 'human', blocks: [textBlock('hi')] },
    ];
    const req: ModelGenerationRequest = { contents };
    expect(req.contents).toBe(contents);
    expect(req.tools).toBeUndefined();
    expect(req.settings).toBeUndefined();
  });

  it('constructs with contents, tools, and settings', () => {
    const req: ModelGenerationRequest = {
      contents: [{ speaker: 'human', blocks: [textBlock('hello')] }],
      tools: [{ name: 'search', parametersJsonSchema: { type: 'object' } }],
      settings: { temperature: 0.5 },
    };
    expect(req.tools).toHaveLength(1);
    expect(req.settings?.temperature).toBe(0.5);
  });

  it('accepts empty contents array', () => {
    const req: ModelGenerationRequest = { contents: [] };
    expect(req.contents).toHaveLength(0);
  });

  it('constructs with model, abortSignal, and modelParams', () => {
    const controller = new AbortController();
    const req: ModelGenerationRequest = {
      contents: [{ speaker: 'human', blocks: [textBlock('hi')] }],
      model: 'gemini-2.5-pro',
      abortSignal: controller.signal,
      modelParams: { responseMimeType: 'application/json' },
    };
    expect(req.model).toBe('gemini-2.5-pro');
    expect(req.abortSignal).toBe(controller.signal);
    expect(req.modelParams?.responseMimeType).toBe('application/json');
  });
});

describe('ModelGenerationSettings additive fields', () => {
  it('constructs with topP', () => {
    const settings: ModelGenerationSettings = { topP: 0.9 };
    expect(settings.topP).toBe(0.9);
  });

  it('constructs with responseJsonSchema', () => {
    const settings: ModelGenerationSettings = {
      responseJsonSchema: { type: 'object' },
    };
    expect(settings.responseJsonSchema).toStrictEqual({ type: 'object' });
  });
});

// ---------------------------------------------------------------------------
// Property-based
// ---------------------------------------------------------------------------

describe('modelRequest property-based', () => {
  it.prop([fc.nat({ max: 100000 })])(
    'ReasoningConfig budgetTokens round-trips through JSON',
    (budgetTokens: number) => {
      const rc: ReasoningConfig = { budgetTokens };
      const rt: ReasoningConfig = JSON.parse(JSON.stringify(rc));
      return rt.budgetTokens === budgetTokens;
    },
  );

  it.prop([
    fc.record({
      temperature: fc.float({ min: 0, max: 2, noNaN: true }),
      maxOutputTokens: fc.nat({ max: 100000 }),
      systemInstruction: fc.string({ maxLength: 100 }),
      reasoning: fc.oneof(
        fc.constant(undefined),
        fc.record({ budgetTokens: fc.nat({ max: 100000 }) }),
      ),
      toolChoice: fc.oneof(
        fc.constant(undefined),
        fc.record({
          mode: fc.constantFrom('auto', 'none', 'required'),
          allowedToolNames: fc.oneof(
            fc.constant(undefined),
            fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
              maxLength: 5,
            }),
          ),
        }),
      ),
    }),
  ])(
    'ModelGenerationSettings round-trips through JSON preserving fields',
    (fields) => {
      const settings: ModelGenerationSettings = fields;
      const rt: ModelGenerationSettings = JSON.parse(JSON.stringify(settings));
      const coreMatches =
        rt.temperature === fields.temperature &&
        rt.maxOutputTokens === fields.maxOutputTokens &&
        rt.systemInstruction === fields.systemInstruction;
      return (
        coreMatches &&
        rt.reasoning?.budgetTokens === fields.reasoning?.budgetTokens &&
        rt.toolChoice?.mode === fields.toolChoice?.mode &&
        JSON.stringify(rt.toolChoice?.allowedToolNames) ===
          JSON.stringify(fields.toolChoice?.allowedToolNames)
      );
    },
  );

  it.prop([
    fc.array(
      fc.record({
        speaker: fc.constantFrom('human', 'ai', 'tool'),
        blocks: fc.array(
          fc.oneof(
            fc.record({
              type: fc.constant('text' as const),
              text: fc.string({ minLength: 1, maxLength: 30 }),
            }),
            fc
              .record({
                type: fc.constant('tool_call' as const),
                id: fc.string({ minLength: 1, maxLength: 10 }),
                name: fc.string({ minLength: 1, maxLength: 15 }),
                parameters: fc.dictionary(
                  fc.string({ minLength: 1, maxLength: 5 }),
                  fc.string({ maxLength: 10 }),
                ),
              })
              .map((b): ToolCallBlock => b),
            fc
              .record({
                type: fc.constant('thinking' as const),
                thought: fc.string({ minLength: 1, maxLength: 30 }),
                signature: fc.option(
                  fc.string({ minLength: 1, maxLength: 20 }),
                ),
              })
              .map((b): ThinkingBlock => b),
          ),
          { minLength: 1, maxLength: 3 },
        ),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  ])(
    'ModelGenerationRequest contents deep-equal after JSON round-trip',
    (contents) => {
      const req: ModelGenerationRequest = { contents };
      const rt: ModelGenerationRequest = JSON.parse(JSON.stringify(req));
      return JSON.stringify(rt.contents) === JSON.stringify(contents);
    },
  );

  it.prop([fc.constantFrom('low', 'medium', 'high')])(
    'ReasoningConfig effort round-trips through JSON',
    (effort) => {
      const rc: ReasoningConfig = { effort };
      const rt: ReasoningConfig = JSON.parse(JSON.stringify(rc));
      return rt.effort === effort;
    },
  );

  it.prop([fc.boolean()])(
    'ReasoningConfig includeInOutput round-trips through JSON',
    (includeInOutput) => {
      const rc: ReasoningConfig = { includeInOutput };
      const rt: ReasoningConfig = JSON.parse(JSON.stringify(rc));
      return rt.includeInOutput === includeInOutput;
    },
  );

  it.prop([
    fc.record({
      contents: fc.array(
        fc.record({
          speaker: fc.constantFrom('human', 'ai', 'tool'),
          blocks: fc.array(
            fc.record({
              type: fc.constant('text' as const),
              text: fc.string({ minLength: 1, maxLength: 20 }),
            }),
            { minLength: 1, maxLength: 3 },
          ),
        }),
        { minLength: 0, maxLength: 3 },
      ),
    }),
  ])(
    'ModelGenerationRequest with only contents deep-equal after JSON round-trip',
    ({ contents }) => {
      const req: ModelGenerationRequest = { contents };
      const rt: ModelGenerationRequest = JSON.parse(JSON.stringify(req));
      return JSON.stringify(rt.contents) === JSON.stringify(contents);
    },
  );
});
