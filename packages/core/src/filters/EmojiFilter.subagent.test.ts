/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for EmojiFilter integration with SubAgentScope
 * @plan PLAN-ISSUE-623
 */

import { describe, it, expect } from 'vitest';
import {
  EmojiFilter,
  type EmojiFilterMode,
  getMostRestrictiveFilter,
} from './EmojiFilter';

describe('EmojiFilter for Subagent Output', () => {
  describe('getMostRestrictiveFilter', () => {
    it('should return error when comparing error vs allowed', () => {
      expect(getMostRestrictiveFilter('error', 'allowed')).toBe('error');
      expect(getMostRestrictiveFilter('allowed', 'error')).toBe('error');
    });

    it('should return error when comparing error vs warn', () => {
      expect(getMostRestrictiveFilter('error', 'warn')).toBe('error');
      expect(getMostRestrictiveFilter('warn', 'error')).toBe('error');
    });

    it('should return error when comparing error vs auto', () => {
      expect(getMostRestrictiveFilter('error', 'auto')).toBe('error');
      expect(getMostRestrictiveFilter('auto', 'error')).toBe('error');
    });

    it('should return warn when comparing warn vs allowed', () => {
      expect(getMostRestrictiveFilter('warn', 'allowed')).toBe('warn');
      expect(getMostRestrictiveFilter('allowed', 'warn')).toBe('warn');
    });

    it('should return warn when comparing warn vs auto', () => {
      expect(getMostRestrictiveFilter('warn', 'auto')).toBe('warn');
      expect(getMostRestrictiveFilter('auto', 'warn')).toBe('warn');
    });

    it('should return auto when comparing auto vs allowed', () => {
      expect(getMostRestrictiveFilter('auto', 'allowed')).toBe('auto');
      expect(getMostRestrictiveFilter('allowed', 'auto')).toBe('auto');
    });

    it('should return the same mode when both are equal', () => {
      const modes: EmojiFilterMode[] = ['error', 'warn', 'auto', 'allowed'];
      for (const mode of modes) {
        expect(getMostRestrictiveFilter(mode, mode)).toBe(mode);
      }
    });
  });

  describe('Subagent text filtering', () => {
    const rocketEmoji = String.fromCodePoint(0x1f680);
    const textWithEmoji = `Hello ${rocketEmoji} World`;

    it('should filter emojis from subagent text response in warn mode', () => {
      const filter = new EmojiFilter({ mode: 'warn' });
      const result = filter.filterText(textWithEmoji);
      expect(result.emojiDetected).toBe(true);
      expect(result.filtered).toBe('Hello  World');
      expect(result.systemFeedback).toBeDefined();
    });

    it('should filter emojis from subagent text response in auto mode without feedback', () => {
      const filter = new EmojiFilter({ mode: 'auto' });
      const result = filter.filterText(textWithEmoji);
      expect(result.emojiDetected).toBe(true);
      expect(result.filtered).toBe('Hello  World');
      expect(result.systemFeedback).toBeUndefined();
    });

    it('should block content in error mode', () => {
      const filter = new EmojiFilter({ mode: 'error' });
      const result = filter.filterText(textWithEmoji);
      expect(result.emojiDetected).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.filtered).toBeNull();
    });

    it('should pass through content in allowed mode', () => {
      const filter = new EmojiFilter({ mode: 'allowed' });
      const result = filter.filterText(textWithEmoji);
      expect(result.emojiDetected).toBe(false);
      expect(result.filtered).toBe(textWithEmoji);
      expect(result.blocked).toBe(false);
    });
  });
});
