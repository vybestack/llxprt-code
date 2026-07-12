/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P04
 * @requirement:REQ-001.1, REQ-001.2, REQ-001.3
 *
 * Behavioral TDD tests for the neutral gap types. These are RED tests that
 * fail via VALUE MISMATCH against the P03 stubs (which return empty values).
 * P05 implements the real logic that makes them green.
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  iContentFromAgentMessageInput,
  iContentFromLegacyInput,
  iContentFromBlocks,
  sendParamsToRequest,
  type AgentMessageInput,
} from './agentMessageInput.js';
import type {
  IContent,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  MediaBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '../services/history/IContent.js';
import type { ModelGenerationSettings } from './modelRequest.js';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function textBlock(text: string): TextBlock {
  return { type: 'text', text };
}

function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [textBlock(text)] };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      value.forEach(deepFreeze);
    } else {
      Object.values(value).forEach(deepFreeze);
    }
  }
  return Object.freeze(value);
}

const GOOGLE_KEYS = ['role', 'parts', 'candidates'];

function hasNoGoogleKeys(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return true;
  return GOOGLE_KEYS.every((k) => !(k in obj));
}

// ---------------------------------------------------------------------------
// iContentFromAgentMessageInput — behavioral (REQ-001.1)
// ---------------------------------------------------------------------------

describe('iContentFromAgentMessageInput', () => {
  it('string → [{speaker:"human", blocks:[{type:"text", text}]}] deep-equal', () => {
    const result = iContentFromAgentMessageInput('hello world');
    expect(result).toStrictEqual<IContent[]>([
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello world' }] },
    ]);
  });

  it('IContent → [input] deep-equal', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [textBlock('response')],
    };
    const result = iContentFromAgentMessageInput(input);
    expect(result).toStrictEqual<IContent[]>([input]);
  });

  it('IContent[] → same array contents deep-equal', () => {
    const input: IContent[] = [
      humanText('first'),
      { speaker: 'ai', blocks: [textBlock('second')] },
    ];
    const result = iContentFromAgentMessageInput(input);
    expect(result).toStrictEqual<IContent[]>(input);
  });

  it('ContentBlock[] → [{speaker:"human", blocks}] deep-equal', () => {
    const blocks: ContentBlock[] = [textBlock('a'), textBlock('b')];
    const result = iContentFromAgentMessageInput(blocks);
    expect(result).toStrictEqual<IContent[]>([{ speaker: 'human', blocks }]);
  });

  it('empty string → [{speaker:"human", blocks:[{type:"text", text:""}]}]', () => {
    const result = iContentFromAgentMessageInput('');
    expect(result).toStrictEqual<IContent[]>([
      { speaker: 'human', blocks: [{ type: 'text', text: '' }] },
    ]);
  });

  it('result has NO role/parts/candidates keys (neutral shape only)', () => {
    const result = iContentFromAgentMessageInput('test');
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      result.forEach((item) => {
        expect(hasNoGoogleKeys(item)).toBe(true);
      });
    }
  });
  // ---------------------------------------------------------------------------
  // iContentFromAgentMessageInput — legacy PartListUnion boundary (REQ-001.1)
  // ---------------------------------------------------------------------------

  describe('iContentFromAgentMessageInput — legacy PartListUnion routing', () => {
    it('non-empty legacy [{text}] → lossless human TextBlock', () => {
      const result = iContentFromAgentMessageInput([
        { text: 'hello' },
      ] as unknown as AgentMessageInput);
      expect(result).toStrictEqual<IContent[]>([
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ]);
    });

    it('non-empty legacy [{text}, {text}] → multiple TextBlocks in one turn', () => {
      const result = iContentFromAgentMessageInput([
        { text: 'first' },
        { text: 'second' },
      ] as unknown as AgentMessageInput);
      expect(result).toHaveLength(1);
      expect(result[0].speaker).toBe('human');
      expect(result[0].blocks).toStrictEqual([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ]);
    });

    it('non-empty legacy [{thought, thoughtSignature}] → ThinkingBlock preserved', () => {
      const result = iContentFromAgentMessageInput([
        { thought: 'reasoning', thoughtSignature: 'sig123' },
      ] as unknown as AgentMessageInput);
      expect(result).toHaveLength(1);
      const block = result[0].blocks[0] as ThinkingBlock;
      expect(block.type).toBe('thinking');
      expect(block.thought).toBe('reasoning');
      expect(block.signature).toBe('sig123');
    });

    it('non-empty legacy [{functionCall}] → ToolCallBlock preserved', () => {
      const result = iContentFromAgentMessageInput([
        {
          functionCall: {
            id: 'call-1',
            name: 'search',
            args: { q: 'test' },
          },
        },
      ] as unknown as AgentMessageInput);
      expect(result).toHaveLength(1);
      const block = result[0].blocks[0] as ToolCallBlock;
      expect(block.type).toBe('tool_call');
      expect(block.id).toBe('call-1');
      expect(block.name).toBe('search');
      expect(block.parameters).toStrictEqual({ q: 'test' });
    });

    it('empty array [] remains a no-op (returns [])', () => {
      const result = iContentFromAgentMessageInput([]);
      expect(result).toStrictEqual<IContent[]>([]);
    });

    it('unsupported non-empty array throws explicit error (never silent)', () => {
      expect(() =>
        iContentFromAgentMessageInput([
          { weird: 1 },
        ] as unknown as AgentMessageInput),
      ).toThrow(/unsupported input shape/);
    });

    it('result has NO role/parts/candidates keys for legacy input', () => {
      const result = iContentFromAgentMessageInput([
        { text: 'hello' },
      ] as unknown as AgentMessageInput);
      result.forEach((item) => {
        expect(hasNoGoogleKeys(item)).toBe(true);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// iContentFromAgentMessageInput — property-based (REQ-001.1)
// ---------------------------------------------------------------------------

describe('iContentFromAgentMessageInput property-based', () => {
  it.prop([fc.string({ minLength: 1, maxLength: 100 })])(
    'for ANY non-empty string, exactly one human IContent with one TextBlock whose text === input',
    (text) => {
      const result = iContentFromAgentMessageInput(text);
      if (!Array.isArray(result) || result.length !== 1) return false;
      const item = result[0];
      if (item.speaker !== 'human') return false;
      if (item.blocks.length !== 1) return false;
      const block = item.blocks[0];
      return block.type === 'text' && block.text === text;
    },
  );

  it.prop([fc.string({ minLength: 1, maxLength: 50 })])(
    'result content has no Google-shaped keys for any string input',
    (text) => {
      const result = iContentFromAgentMessageInput(text);
      if (!Array.isArray(result)) return false;
      return result.every((item) => hasNoGoogleKeys(item));
    },
  );
});

// ---------------------------------------------------------------------------
// iContentFromLegacyInput — behavioral (REQ-001.2)
// ---------------------------------------------------------------------------

describe('iContentFromLegacyInput', () => {
  it('legacy {text} part → TextBlock', () => {
    const result = iContentFromLegacyInput({ text: 'hello' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      expect(blocks).toContainEqual(textBlock('hello'));
    }
  });

  it('{thought, thoughtSignature} → ThinkingBlock with signature preserved (BR-5)', () => {
    const result = iContentFromLegacyInput({
      thought: 'I should think about this',
      thoughtSignature: 'sig-abc-123',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      const thinking = blocks.find(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      expect(thinking).toBeDefined();
      expect(thinking?.thought).toBe('I should think about this');
      expect(thinking?.signature).toBe('sig-abc-123');
    }
  });

  it('Google-style {thought:true, text, thoughtSignature} → ThinkingBlock (not TextBlock)', () => {
    const result = iContentFromLegacyInput({
      thought: true,
      text: 'my thinking content',
      thoughtSignature: 'sig-xyz',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      const thinking = blocks.find(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      expect(thinking).toBeDefined();
      expect(thinking?.thought).toBe('my thinking content');
      expect(thinking?.signature).toBe('sig-xyz');
      expect(thinking?.sourceField).toBe('thought');
      // must NOT produce a TextBlock — thought:true has thinking semantics
      const text = blocks.find((b) => b.type === 'text');
      expect(text).toBeUndefined();
    }
  });

  it('Google-style {thought:true, text} without signature → ThinkingBlock with no signature', () => {
    const result = iContentFromLegacyInput({
      thought: true,
      text: 'just thinking',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const blocks = result.value.flatMap((i) => i.blocks);
      const thinking = blocks.find(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      expect(thinking).toBeDefined();
      expect(thinking?.thought).toBe('just thinking');
      expect(thinking?.signature).toBeUndefined();
    }
  });

  it('Google-style thought part inside legacy Content parts[] is converted correctly', () => {
    const result = iContentFromLegacyInput([
      {
        role: 'model',
        parts: [
          { thought: true, text: 'reasoning here', thoughtSignature: 's1' },
          { text: 'visible answer' },
        ],
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const blocks = result.value.flatMap((i) => i.blocks);
      const thinking = blocks.find(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      const text = blocks.find((b) => b.type === 'text');
      expect(thinking).toBeDefined();
      expect(thinking?.thought).toBe('reasoning here');
      expect(thinking?.signature).toBe('s1');
      expect(text).toBeDefined();
      if (text?.type === 'text') {
        expect(text.text).toBe('visible answer');
      }
    }
  });

  it('{inlineData} → MediaBlock (base64)', () => {
    const result = iContentFromLegacyInput({
      inlineData: { mimeType: 'image/png', data: 'base64data==' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      const media = blocks.find((b): b is MediaBlock => b.type === 'media');
      expect(media).toBeDefined();
      expect(media?.mimeType).toBe('image/png');
      expect(media?.data).toBe('base64data==');
      expect(media?.encoding).toBe('base64');
    }
  });

  it('{functionCall} → ToolCallBlock with id+name+params', () => {
    const result = iContentFromLegacyInput({
      functionCall: {
        id: 'call-1',
        name: 'getWeather',
        args: { city: 'NYC' },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      const tc = blocks.find((b): b is ToolCallBlock => b.type === 'tool_call');
      expect(tc).toBeDefined();
      expect(tc?.id).toBe('call-1');
      expect(tc?.name).toBe('getWeather');
      expect(tc?.parameters).toStrictEqual({ city: 'NYC' });
    }
  });

  it('{functionResponse} → ToolResponseBlock', () => {
    const result = iContentFromLegacyInput({
      functionResponse: {
        id: 'call-1',
        name: 'getWeather',
        response: { temp: 72 },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      const tr = blocks.find(
        (b): b is ToolResponseBlock => b.type === 'tool_response',
      );
      expect(tr).toBeDefined();
      expect(tr?.callId).toBe('call-1');
      expect(tr?.toolName).toBe('getWeather');
      expect(tr?.result).toStrictEqual({ temp: 72 });
    }
  });

  it('unsupported {weird:1} → {ok:false, error} (ES-2: never silent drop)', () => {
    const result = iContentFromLegacyInput({ weird: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('string legacy input → human TextBlock', () => {
    const result = iContentFromLegacyInput('just text');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const items = result.value;
      expect(items[0].speaker).toBe('human');
      expect(items[0].blocks[0].type).toBe('text');
    }
  });
});

// ---------------------------------------------------------------------------
// iContentFromLegacyInput — property-based (REQ-001.2)
// ---------------------------------------------------------------------------

describe('iContentFromLegacyInput property-based', () => {
  it.prop([
    fc.array(
      fc.record({
        text: fc.string({ minLength: 1, maxLength: 50 }),
      }),
      { minLength: 1, maxLength: 10 },
    ),
  ])(
    'for ANY array of {text} parts, blocks length === parts length and texts preserved in order',
    (parts) => {
      const result = iContentFromLegacyInput(parts);
      if (!result.ok) return false;
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      if (blocks.length !== parts.length) return false;
      return blocks.every(
        (b, i) => b.type === 'text' && b.text === parts[i].text,
      );
    },
  );

  it.prop([
    fc.record({
      thought: fc.string({ minLength: 1, maxLength: 80 }),
      thoughtSignature: fc.string({ minLength: 1, maxLength: 40 }),
    }),
  ])(
    '{thought, thoughtSignature} ALWAYS yields a ThinkingBlock whose signature === input (BR-5)',
    ({ thought, thoughtSignature }) => {
      const result = iContentFromLegacyInput({ thought, thoughtSignature });
      if (!result.ok) return false;
      const items = result.value;
      const blocks = items.flatMap((i) => i.blocks);
      const thinking = blocks.find(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      if (!thinking) return false;
      return (
        thinking.thought === thought && thinking.signature === thoughtSignature
      );
    },
  );
});

// ---------------------------------------------------------------------------
// iContentFromBlocks — behavioral (REQ-001.2, C4)
// ---------------------------------------------------------------------------

describe('iContentFromBlocks', () => {
  it('default speaker is "ai"; blocks deep-equal', () => {
    const blocks: ContentBlock[] = [textBlock('hi')];
    const result = iContentFromBlocks(blocks);
    expect(result).toStrictEqual<IContent>({
      speaker: 'ai',
      blocks: [textBlock('hi')],
    });
  });

  it('explicit speaker "human" honored', () => {
    const blocks: ContentBlock[] = [textBlock('hello')];
    const result = iContentFromBlocks(blocks, 'human');
    expect(result).toStrictEqual<IContent>({
      speaker: 'human',
      blocks: [textBlock('hello')],
    });
  });

  it('result has NO role/parts/candidates keys — only speaker/blocks', () => {
    const result = iContentFromBlocks([textBlock('x')]);
    expect(Object.keys(result).sort()).toStrictEqual(['blocks', 'speaker']);
  });

  it('input blocks reference is not mutated', () => {
    const blocks: ContentBlock[] = [textBlock('original')];
    const snapshot = JSON.parse(JSON.stringify(blocks));
    iContentFromBlocks(blocks);
    expect(JSON.parse(JSON.stringify(blocks))).toStrictEqual(snapshot);
  });

  it('returned object is a NEW object (not the input)', () => {
    const blocks: ContentBlock[] = [textBlock('hi')];
    const result = iContentFromBlocks(blocks);
    expect(result).not.toBe(blocks);
  });

  it('works with multiple blocks of different types', () => {
    const blocks: ContentBlock[] = [
      textBlock('a'),
      { type: 'thinking', thought: 'hmm', signature: 'sig' } as ThinkingBlock,
    ];
    const result = iContentFromBlocks(blocks);
    expect(result.speaker).toBe('ai');
    expect(result.blocks).toHaveLength(2);
  });

  it('frozen input blocks do not cause errors', () => {
    const blocks = deepFreeze([textBlock('frozen')]);
    expect(() => iContentFromBlocks(blocks)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// iContentFromBlocks — property-based (REQ-001.2, C4)
// ---------------------------------------------------------------------------

describe('iContentFromBlocks property-based', () => {
  it.prop([
    fc.array(
      fc.record({
        type: fc.constant('text' as const),
        text: fc.string({ minLength: 0, maxLength: 50 }),
      }),
      { minLength: 0, maxLength: 8 },
    ),
  ])(
    'for ANY ContentBlock[], iContentFromBlocks(blocks).blocks deep-equals input and only top-level keys are speaker/blocks',
    (blocks) => {
      const result = iContentFromBlocks(blocks);
      const keys = Object.keys(result).sort();
      if (keys.join(',') !== 'blocks,speaker') return false;
      return JSON.stringify(result.blocks) === JSON.stringify(blocks);
    },
  );

  it.prop([fc.constantFrom('human', 'ai', 'tool')])(
    'explicit speaker is always honored',
    (speaker) => {
      const result = iContentFromBlocks([textBlock('x')], speaker);
      return result.speaker === speaker;
    },
  );
});

// ---------------------------------------------------------------------------
// sendParamsToRequest — behavioral (REQ-001.3)
// ---------------------------------------------------------------------------

describe('sendParamsToRequest', () => {
  const settings: ModelGenerationSettings = {
    temperature: 0.7,
    maxOutputTokens: 4096,
  };

  it('message string + settings → ModelGenerationRequest with contents IContent[] and settings', () => {
    const result = sendParamsToRequest('hi', settings);
    expect(result.contents).toStrictEqual<IContent[]>([
      { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(result.settings).toStrictEqual(settings);
  });

  it('result has NO GenerateContentConfig/PartListUnion leakage (no message/config/role/parts keys)', () => {
    const result = sendParamsToRequest('hi', settings);
    expect(result).not.toHaveProperty('message');
    expect(result).not.toHaveProperty('config');
    expect(result).not.toHaveProperty('role');
    expect(result).not.toHaveProperty('parts');
    expect(result).not.toHaveProperty('candidates');
  });

  it('IContent[] input → contents === iContentFromAgentMessageInput(input)', () => {
    const input: IContent[] = [
      humanText('hello'),
      { speaker: 'ai', blocks: [textBlock('world')] },
    ];
    const result = sendParamsToRequest(input);
    expect(result.contents).toStrictEqual<IContent[]>(input);
  });

  it('without settings → settings undefined', () => {
    const result = sendParamsToRequest('test');
    expect(result.settings).toBeUndefined();
  });

  it('result exposes only neutral request keys (contents/settings/tools/model/abortSignal/modelParams)', () => {
    const result = sendParamsToRequest('hi');
    const allowedKeys = new Set([
      'contents',
      'settings',
      'tools',
      'model',
      'abortSignal',
      'modelParams',
    ]);
    const actualKeys = Object.keys(result);
    actualKeys.forEach((key) => {
      expect(allowedKeys.has(key)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// sendParamsToRequest — property-based (REQ-001.3)
// ---------------------------------------------------------------------------

describe('sendParamsToRequest property-based', () => {
  it.prop([fc.string({ minLength: 1, maxLength: 50 })])(
    'for ANY string message, sendParamsToRequest(msg).contents === iContentFromAgentMessageInput(msg)',
    (msg) => {
      const result = sendParamsToRequest(msg);
      const expected = iContentFromAgentMessageInput(msg);
      return JSON.stringify(result.contents) === JSON.stringify(expected);
    },
  );

  it.prop([
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.array(
        fc.record({
          type: fc.constant('text' as const),
          text: fc.string({ minLength: 1, maxLength: 20 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
    ),
  ])(
    'for ANY AgentMessageInput, request has no Google-shaped keys',
    (input: AgentMessageInput) => {
      const result = sendParamsToRequest(input);
      const requestKeys = Object.keys(result);
      const googleKeys = ['message', 'config', 'role', 'parts', 'candidates'];
      return requestKeys.every((k) => !googleKeys.includes(k));
    },
  );
});

// ---------------------------------------------------------------------------
// iContentFromLegacyInput — boolean thought:true must require string text
// (Finding #6: malformed boolean thought parts must not silently produce
//  empty thinking blocks; they must return {ok:false}).
// ---------------------------------------------------------------------------

describe('iContentFromLegacyInput — boolean thought:true text requirement', () => {
  it('{thought:true} with string text → ThinkingBlock (valid)', () => {
    const result = iContentFromLegacyInput({
      thought: true,
      text: 'my reasoning',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const blocks = result.value.flatMap((i) => i.blocks);
      const thinking = blocks.find(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      expect(thinking).toBeDefined();
      expect(thinking?.thought).toBe('my reasoning');
    }
  });

  it('{thought:true} WITHOUT text → {ok:false} (malformed)', () => {
    const result = iContentFromLegacyInput({
      thought: true,
    });
    expect(result.ok).toBe(false);
  });

  it('{thought:true, text:123} (non-string text) → {ok:false} (malformed)', () => {
    const result = iContentFromLegacyInput({
      thought: true,
      text: 123,
    });
    expect(result.ok).toBe(false);
  });

  it('{thought:true, text:null} → {ok:false} (malformed)', () => {
    const result = iContentFromLegacyInput({
      thought: true,
      text: null,
    });
    expect(result.ok).toBe(false);
  });

  it('{thought:"some text"} (string form, no boolean) → still valid (legacy form)', () => {
    const result = iContentFromLegacyInput({
      thought: 'some reasoning text',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const blocks = result.value.flatMap((i) => i.blocks);
      const thinking = blocks.find(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      expect(thinking).toBeDefined();
      expect(thinking?.thought).toBe('some reasoning text');
    }
  });

  it('{thought:true, text:""} (empty string) → {ok:false} (malformed)', () => {
    const result = iContentFromLegacyInput({
      thought: true,
      text: '',
    });
    expect(result.ok).toBe(false);
  });
});
