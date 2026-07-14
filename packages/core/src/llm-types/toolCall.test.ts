/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-004.1, REQ-004.2, REQ-004.3
 * @pseudocode lines 60-78
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  toolResultContentFromLegacyPartListUnion,
  type ToolCallRequest,
} from './toolCall.js';

describe('toolResultContentFromLegacyPartListUnion - string input', () => {
  it('returns string directly for string input', () => {
    expect(toolResultContentFromLegacyPartListUnion('hello')).toStrictEqual({
      ok: true,
      value: 'hello',
    });
  });

  it('returns empty string for empty string input', () => {
    expect(toolResultContentFromLegacyPartListUnion('')).toStrictEqual({
      ok: true,
      value: '',
    });
  });
});

describe('toolResultContentFromLegacyPartListUnion - single part object', () => {
  it('converts {text} to TextBlock', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      text: 'hello world',
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [{ type: 'text', text: 'hello world' }],
    });
  });

  it('converts {inlineData} to MediaBlock base64', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      inlineData: { mimeType: 'image/png', data: 'base64data==' },
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'base64data==',
          encoding: 'base64',
        },
      ],
    });
  });

  it('converts {fileData} to MediaBlock url', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      fileData: {
        mimeType: 'image/jpeg',
        fileUri: 'https://example.com/img.jpg',
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          type: 'media',
          mimeType: 'image/jpeg',
          data: 'https://example.com/img.jpg',
          encoding: 'url',
        },
      ],
    });
  });

  it('converts {fileData} without mimeType to application/octet-stream', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      fileData: { fileUri: 'https://example.com/file.bin' },
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          type: 'media',
          mimeType: 'application/octet-stream',
          data: 'https://example.com/file.bin',
          encoding: 'url',
        },
      ],
    });
  });

  it('converts {functionResponse} to ToolResponseBlock', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: {
        name: 'searchWeb',
        response: { results: ['a', 'b'] },
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          type: 'tool_response',
          callId: '',
          toolName: 'searchWeb',
          result: { results: ['a', 'b'] },
        },
      ],
    });
  });

  it('converts {functionResponse} with id to ToolResponseBlock preserving callId', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: {
        id: 'call-123',
        name: 'searchWeb',
        response: 'done',
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          type: 'tool_response',
          callId: 'call-123',
          toolName: 'searchWeb',
          result: 'done',
        },
      ],
    });
  });

  it('converts {functionResponse} without response to result {} (JSON-serializable contract)', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: {
        name: 'searchWeb',
      },
    });
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          type: 'tool_response',
          callId: '',
          toolName: 'searchWeb',
          result: {},
        },
      ],
    });
  });

  it('rejects {functionResponse} with a function-valued response (non-JSON-serializable)', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: {
        name: 'searchWeb',
        response: (() => {}) as unknown,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('JSON-serializable');
    }
  });

  it('rejects {functionResponse} with a bigint-valued response (non-JSON-serializable)', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: {
        name: 'searchWeb',
        response: BigInt(42) as unknown,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('JSON-serializable');
    }
  });

  it('rejects {functionResponse} with a symbol-valued response (non-JSON-serializable)', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: {
        name: 'searchWeb',
        response: Symbol('s') as unknown,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('JSON-serializable');
    }
  });

  it('rejects {functionResponse} with explicit undefined response (present-key, non-JSON-serializable)', () => {
    // The absent-key case (no 'response' property) defaults to {} and is
    // valid. Only the present-but-undefined case errors.
    const input: { functionResponse: { name: string; response?: unknown } } = {
      functionResponse: { name: 'searchWeb', response: undefined },
    };
    const result = toolResultContentFromLegacyPartListUnion(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('JSON-serializable');
    }
  });
});

describe('toolResultContentFromLegacyPartListUnion - array input', () => {
  it('converts array of mixed parts element-wise', () => {
    const result = toolResultContentFromLegacyPartListUnion([
      { text: 'hello' },
      { text: 'world' },
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });
  });

  it('handles array with string elements', () => {
    const result = toolResultContentFromLegacyPartListUnion(['a', 'b']);
    expect(result).toStrictEqual({
      ok: true,
      value: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });
  });

  it('handles array with mixed text and inlineData', () => {
    const result = toolResultContentFromLegacyPartListUnion([
      { text: 'desc' },
      { inlineData: { mimeType: 'image/png', data: 'abc' } },
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: [
        { type: 'text', text: 'desc' },
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'abc',
          encoding: 'base64',
        },
      ],
    });
  });

  it('handles empty array', () => {
    const result = toolResultContentFromLegacyPartListUnion([]);
    expect(result).toStrictEqual({ ok: true, value: [] });
  });

  it('propagates error from unsupported element without dropping it', () => {
    const result = toolResultContentFromLegacyPartListUnion([
      { text: 'ok' },
      { executableCode: { code: 'print(1)' } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe('toolResultContentFromLegacyPartListUnion - unsupported shapes', () => {
  it('rejects null with descriptive error', () => {
    const result = toolResultContentFromLegacyPartListUnion(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects number with descriptive error', () => {
    const result = toolResultContentFromLegacyPartListUnion(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects unsupported object shape (executableCode)', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      executableCode: { language: 'PYTHON', code: 'print(1)' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects empty object', () => {
    const result = toolResultContentFromLegacyPartListUnion({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects inlineData with missing data field', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      inlineData: { mimeType: 'image/png' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('malformed inlineData');
    }
  });

  it('rejects inlineData with missing mimeType', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      inlineData: { data: 'abc' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('malformed inlineData');
    }
  });

  it('rejects malformed fileData with missing fileUri', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      fileData: { mimeType: 'image/png' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('malformed fileData');
    }
  });

  it('rejects functionResponse with missing name', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: { response: 'ok' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('malformed functionResponse');
    }
  });

  it('rejects malformed functionResponse that is not a record', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      functionResponse: 'not-a-record',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('malformed functionResponse');
    }
  });

  it('never silently stringifies or drops unsupported shapes', () => {
    const result = toolResultContentFromLegacyPartListUnion({
      mysteryField: 42,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The error should mention "unsupported" — the shape was NOT stringified
      expect(result.error.toLowerCase()).toContain('unsupported');
    }
  });
});

describe('ToolCallRequest type usage', () => {
  it('constructs without optional id', () => {
    const req: ToolCallRequest = { name: 'search', args: { q: 'hello' } };
    expect(req.name).toBe('search');
    expect(req.args).toStrictEqual({ q: 'hello' });
    expect(req.id).toBeUndefined();
  });

  it('constructs with optional id', () => {
    const req: ToolCallRequest = { id: 'call-1', name: 'search', args: {} };
    expect(req.id).toBe('call-1');
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('toolCall property-based', () => {
  it.prop([
    fc.array(fc.record({ text: fc.string({ maxLength: 50 }) }), {
      minLength: 0,
      maxLength: 10,
    }),
  ])(
    'array of {text: string} yields TextBlocks preserving order and content',
    (parts) => {
      const result = toolResultContentFromLegacyPartListUnion(parts);
      if (!result.ok) return false;
      if (!Array.isArray(result.value)) return false;
      return (
        result.value.length === parts.length &&
        parts.every((p, i) => {
          const block = result.value[i];
          return block.type === 'text' && block.text === p.text;
        })
      );
    },
  );

  it.prop([fc.string({ maxLength: 100 })])(
    'any string input yields ok with value === input',
    (s: string) => {
      const result = toolResultContentFromLegacyPartListUnion(s);
      return result.ok && result.value === s;
    },
  );

  it.prop([
    fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.constant({}),
      fc.constant({ mystery: 42 }),
      fc.record({ executableCode: fc.record({ code: fc.string() }) }),
    ),
  ])(
    'unsupported shape always returns {ok:false} with non-empty error string',
    (input: unknown) => {
      const result = toolResultContentFromLegacyPartListUnion(input);
      return !result.ok && result.error.length > 0;
    },
  );

  it.prop([
    fc.record({
      inlineData: fc.record({
        mimeType: fc.string({ minLength: 1, maxLength: 30 }),
        data: fc.string({ minLength: 1, maxLength: 50 }),
      }),
    }),
  ])(
    'inlineData with string mimeType+data always yields MediaBlock base64',
    (input) => {
      const result = toolResultContentFromLegacyPartListUnion(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return false;
      expect(Array.isArray(result.value)).toBe(true);
      if (!Array.isArray(result.value)) return false;
      const block = result.value[0];
      expect(block.type).toBe('media');
      if (block.type !== 'media') return false;
      expect(block.encoding).toBe('base64');
      expect(block.mimeType).toBe(input.inlineData.mimeType);
      expect(block.data).toBe(input.inlineData.data);
      return true;
    },
  );

  it.prop([
    fc.record({
      fileData: fc.record({
        fileUri: fc.string({ minLength: 1, maxLength: 50 }),
        mimeType: fc.option(fc.string({ minLength: 1, maxLength: 30 })),
      }),
    }),
  ])('fileData always yields MediaBlock url with correct mimeType', (input) => {
    const result = toolResultContentFromLegacyPartListUnion(input);
    if (!result.ok || !Array.isArray(result.value)) return false;
    const block = result.value[0];
    const expectedMime = input.fileData.mimeType ?? 'application/octet-stream';
    return (
      block.type === 'media' &&
      block.encoding === 'url' &&
      block.mimeType === expectedMime &&
      block.data === input.fileData.fileUri
    );
  });

  it.prop([
    fc
      .oneof(
        // Case 1: response key present (fc.option → null or string)
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 20 }),
          id: fc.option(fc.string({ minLength: 1, maxLength: 10 })),
          response: fc.option(fc.string({ maxLength: 30 })),
        }),
        // Case 2: response key is optional — fast-check will sometimes
        // omit the 'response' key entirely, exercising the result:{} fallback.
        // When present, it's always a string.
        fc.record(
          {
            name: fc.string({ minLength: 1, maxLength: 20 }),
            id: fc.option(fc.string({ minLength: 1, maxLength: 10 })),
            response: fc.string({ maxLength: 30 }),
          },
          { requiredKeys: ['name'] },
        ),
      )
      .map((fnResp) => ({ functionResponse: fnResp })),
  ])(
    'functionResponse always yields ToolResponseBlock with correct fields',
    (input) => {
      const result = toolResultContentFromLegacyPartListUnion(input);
      if (!result.ok || !Array.isArray(result.value)) return false;
      const block = result.value[0];
      if (block.type !== 'tool_response') return false;
      const fnResp = input.functionResponse;
      const expectedResult = 'response' in fnResp ? fnResp['response'] : {};
      expect(block.toolName).toBe(fnResp.name);
      expect(block.callId).toBe(typeof fnResp.id === 'string' ? fnResp.id : '');
      expect(block.result).toStrictEqual(expectedResult);
      return true;
    },
  );

  it.prop([
    fc.array(
      fc.oneof(
        fc.record({ text: fc.string({ maxLength: 20 }) }),
        fc.string({ maxLength: 15 }),
      ),
      { minLength: 0, maxLength: 5 },
    ),
  ])(
    'array of text parts and strings always yields ok with TextBlocks',
    (parts) => {
      const result = toolResultContentFromLegacyPartListUnion(parts);
      if (!result.ok || !Array.isArray(result.value)) return false;
      return (
        result.value.length === parts.length &&
        parts.every((p, i) => {
          const block = result.value[i];
          return (
            block.type === 'text' &&
            block.text === (typeof p === 'string' ? p : p.text)
          );
        })
      );
    },
  );
});
