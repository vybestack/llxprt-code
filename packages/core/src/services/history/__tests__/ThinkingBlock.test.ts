/**
 * @plan PLAN-20251202-THINKING.P04
 * @requirement REQ-THINK-001
 */
import { describe, it, expect } from 'vitest';
import type { ThinkingBlock, ContentBlock } from '../IContent';

describe('ThinkingBlock @plan:PLAN-20251202-THINKING.P04', () => {
  describe('REQ-THINK-001.1: sourceField property', () => {
    it('accepts reasoning_content as sourceField', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        sourceField: 'reasoning_content',
      };
      expect(block.sourceField).toBe('reasoning_content');
    });

    it('accepts thinking as sourceField', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        sourceField: 'thinking',
      };
      expect(block.sourceField).toBe('thinking');
    });

    it('accepts thought as sourceField', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        sourceField: 'thought',
      };
      expect(block.sourceField).toBe('thought');
    });

    it('allows sourceField to be undefined (backward compat)', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
      };
      expect(block.sourceField).toBeUndefined();
    });
  });

  describe('REQ-THINK-001.2: signature property', () => {
    it('accepts signature string', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
        signature: 'abc123signature',
      };
      expect(block.signature).toBe('abc123signature');
    });

    it('allows signature to be undefined (backward compat)', () => {
      const block: ThinkingBlock = {
        type: 'thinking',
        thought: 'test thought',
      };
      expect(block.signature).toBeUndefined();
    });
  });

  describe('REQ-THINK-001.3: ContentBlock union', () => {
    it('ThinkingBlock is assignable to ContentBlock', () => {
      const thinkingBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'test',
        sourceField: 'reasoning_content',
      };
      // This assignment should compile
      const contentBlock: ContentBlock = thinkingBlock;
      expect(contentBlock.type).toBe('thinking');
    });
  });

  describe('backward compatibility', () => {
    it('existing ThinkingBlock shape still works', () => {
      // This is what existing code creates
      const legacyBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'existing thought',
        isHidden: false,
      };
      expect(legacyBlock.type).toBe('thinking');
      expect(legacyBlock.thought).toBe('existing thought');
      expect(legacyBlock.isHidden).toBe(false);
    });

    it('full ThinkingBlock with all properties', () => {
      const fullBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'complete thought',
        isHidden: true,
        sourceField: 'reasoning_content',
        signature: 'sig123',
      };
      expect(fullBlock).toMatchObject({
        type: 'thinking',
        thought: 'complete thought',
        isHidden: true,
        sourceField: 'reasoning_content',
        signature: 'sig123',
      });
    });
  });
});
