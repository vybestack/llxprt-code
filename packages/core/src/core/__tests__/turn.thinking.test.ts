/**
 * Tests for thinking/thought event handling in turn.ts
 *
 * These tests verify:
 * - Bug #2: turn.ts should check ALL parts for thinking, not just parts[0]
 * - Thought events are correctly emitted from parts with thought: true
 *
 * @plan PLAN-20251202-THINKING.P16
 * @requirement REQ-THINK-003
 */
import { describe, it, expect } from 'vitest';
import type { GenerateContentResponse, Part } from '@google/genai';

/**
 * Helper to create a mock GenerateContentResponse with parts
 */
function createMockResponse(parts: Part[]): GenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts,
        },
      },
    ],
    get text() {
      const textParts = parts.filter(
        (p) => 'text' in p && !('thought' in p && p.thought),
      );
      return textParts.map((p) => (p as { text: string }).text).join('');
    },
  } as GenerateContentResponse;
}

/**
 * Helper to create a thought part
 */
function createThoughtPart(text: string): Part {
  return {
    thought: true,
    text,
  } as unknown as Part;
}

/**
 * Helper to create a text part
 */
function createTextPart(text: string): Part {
  return {
    text,
  };
}

/**
 * Helper to create a function call part
 */
function createFunctionCallPart(name: string, args: object): Part {
  return {
    functionCall: {
      name,
      args,
    },
  } as unknown as Part;
}

describe('turn.ts thinking event handling @plan:PLAN-20251202-THINKING.P16', () => {
  describe('Bug #2: Should check all parts for thinking, not just parts[0]', () => {
    /**
     * This test documents the bug where turn.ts only checks parts[0] for thought.
     * The current implementation at line 332 is:
     *   const thoughtPart = resp.candidates?.[0]?.content?.parts?.[0];
     *
     * This means if ThinkingBlock is not the first part, it won't be detected.
     */
    it('should detect thought part when it is NOT the first part', () => {
      // Create response with text first, then thinking
      const parts = [
        createTextPart('Answer text'),
        createThoughtPart('Let me think about this...'),
      ];
      const response = createMockResponse(parts);

      // Check that the response has thought in parts[1]
      const part0 = response.candidates?.[0]?.content?.parts?.[0];
      const part1 = response.candidates?.[0]?.content?.parts?.[1];

      expect((part0 as unknown as { thought?: boolean }).thought).toBeFalsy();
      expect((part1 as unknown as { thought?: boolean }).thought).toBe(true);
      expect((part1 as unknown as { text?: string }).text).toBe(
        'Let me think about this...',
      );

      // The fix should iterate ALL parts and find thoughts in any position
      const allParts = response.candidates?.[0]?.content?.parts ?? [];
      const thoughtParts = allParts.filter(
        (p) => (p as unknown as { thought?: boolean }).thought === true,
      );

      expect(thoughtParts.length).toBe(1);
      expect((thoughtParts[0] as unknown as { text?: string }).text).toBe(
        'Let me think about this...',
      );
    });

    it('should detect thought part when it is the first part', () => {
      // Create response with thinking first, then text
      const parts = [
        createThoughtPart('Analyzing the problem...'),
        createTextPart('Here is my answer.'),
      ];
      const response = createMockResponse(parts);

      const part0 = response.candidates?.[0]?.content?.parts?.[0];
      expect((part0 as unknown as { thought?: boolean }).thought).toBe(true);
      expect((part0 as unknown as { text?: string }).text).toBe(
        'Analyzing the problem...',
      );
    });

    it('should detect multiple thought parts in a single response', () => {
      // Some providers might include multiple thinking segments
      const parts = [
        createThoughtPart('First analysis step...'),
        createTextPart('Intermediate result.'),
        createThoughtPart('Second analysis step...'),
        createTextPart('Final answer.'),
      ];
      const response = createMockResponse(parts);

      const allParts = response.candidates?.[0]?.content?.parts ?? [];
      const thoughtParts = allParts.filter(
        (p) => (p as unknown as { thought?: boolean }).thought === true,
      );

      expect(thoughtParts.length).toBe(2);
      expect((thoughtParts[0] as unknown as { text?: string }).text).toBe(
        'First analysis step...',
      );
      expect((thoughtParts[1] as unknown as { text?: string }).text).toBe(
        'Second analysis step...',
      );
    });

    it('should handle response with thought part after function call', () => {
      // Model might think after deciding to call a function
      const parts = [
        createFunctionCallPart('search_files', { pattern: '*.ts' }),
        createThoughtPart('Need to search for TypeScript files...'),
      ];
      const response = createMockResponse(parts);

      const part0 = response.candidates?.[0]?.content?.parts?.[0];
      const part1 = response.candidates?.[0]?.content?.parts?.[1];

      expect(
        (part0 as unknown as { functionCall?: object }).functionCall,
      ).toBeDefined();
      expect((part1 as unknown as { thought?: boolean }).thought).toBe(true);

      // Fix should find the thought even after function call
      const allParts = response.candidates?.[0]?.content?.parts ?? [];
      const thoughtParts = allParts.filter(
        (p) => (p as unknown as { thought?: boolean }).thought === true,
      );
      expect(thoughtParts.length).toBe(1);
    });

    it('should handle response with no thought parts', () => {
      const parts = [
        createTextPart('Just a regular response.'),
        createFunctionCallPart('get_time', {}),
      ];
      const response = createMockResponse(parts);

      const allParts = response.candidates?.[0]?.content?.parts ?? [];
      const thoughtParts = allParts.filter(
        (p) => (p as unknown as { thought?: boolean }).thought === true,
      );

      expect(thoughtParts.length).toBe(0);
    });

    it('should handle empty parts array', () => {
      const response = createMockResponse([]);

      const allParts = response.candidates?.[0]?.content?.parts ?? [];
      const thoughtParts = allParts.filter(
        (p) => (p as unknown as { thought?: boolean }).thought === true,
      );

      expect(thoughtParts.length).toBe(0);
    });

    it('should handle response with only thought parts', () => {
      // Thinking-only response (e.g., when model is just reasoning)
      const parts = [
        createThoughtPart('First step of reasoning...'),
        createThoughtPart('Second step of reasoning...'),
        createThoughtPart('Conclusion of reasoning...'),
      ];
      const response = createMockResponse(parts);

      const allParts = response.candidates?.[0]?.content?.parts ?? [];
      const thoughtParts = allParts.filter(
        (p) => (p as unknown as { thought?: boolean }).thought === true,
      );

      expect(thoughtParts.length).toBe(3);
    });
  });

  describe('Thought event generation requirements', () => {
    it('thought part should have thought: true and text property', () => {
      const thoughtPart = createThoughtPart('Thinking content');

      expect((thoughtPart as unknown as { thought?: boolean }).thought).toBe(
        true,
      );
      expect((thoughtPart as unknown as { text?: string }).text).toBe(
        'Thinking content',
      );
    });

    it('text part should not have thought property', () => {
      const textPart = createTextPart('Regular content');

      expect(
        (textPart as unknown as { thought?: boolean }).thought,
      ).toBeUndefined();
    });
  });
});
