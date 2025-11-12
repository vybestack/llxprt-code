/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallCollector } from './ToolCallCollector.js';

describe('ToolCallCollector', () => {
  let collector: ToolCallCollector;

  beforeEach(() => {
    collector = new ToolCallCollector();
  });

  describe('Basic functionality', () => {
    it('should be able to add fragments', () => {
      collector.addFragment(0, { name: 'test_tool' });

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0].name).toBe('test_tool');
    });

    it('should be able to handle multiple tool calls', () => {
      collector.addFragment(0, { name: 'tool1' });
      collector.addFragment(1, { name: 'tool2' });

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(2);
    });
  });

  describe('Duplicate detection', () => {
    it('should avoid collecting duplicate fragments', () => {
      collector.addFragment(0, { name: 'test_tool' }); // duplicate
      const stats = collector.getStats();
      expect(stats.pendingFragments).toBe(1); // only collect once
    });
  });

  describe('Completion judgment', () => {
    it('should consider complete when name exists', () => {
      collector.addFragment(0, { name: 'test_tool' });

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(1);
    });

    it('should not consider complete when name is missing', () => {
      collector.addFragment(0, { args: '{"param": "value"}' });

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(0);
    });
  });

  describe('Fragment accumulation (Problem 1)', () => {
    it('should correctly accumulate arguments fragments', () => {
      // Simulate streaming fragments like Qwen model produces
      collector.addFragment(0, { name: 'test_tool' });
      collector.addFragment(0, { args: '{"param1": ' });
      collector.addFragment(0, { args: '"value1", ' });
      collector.addFragment(0, { args: '"param2": ' });
      collector.addFragment(0, { args: '"value2"}' });

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0].name).toBe('test_tool');
      expect(completeCalls[0].args).toBe(
        '{"param1": "value1", "param2": "value2"}',
      );

      // Verify it's valid JSON
      const parsedArgs = JSON.parse(completeCalls[0].args || '');
      expect(parsedArgs).toEqual({
        param1: 'value1',
        param2: 'value2',
      });
    });

    it('should handle arguments split across multiple fragments', () => {
      // Test case that would fail with overwrite logic (old bug)
      collector.addFragment(0, { name: 'test_tool' });
      collector.addFragment(0, { args: 'incomplete_json' }); // First fragment
      collector.addFragment(0, { args: '_continuation' }); // Second fragment

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0].args).toBe('incomplete_json_continuation');
    });

    it('should accumulate empty args correctly', () => {
      collector.addFragment(0, { name: 'test_tool' });
      collector.addFragment(0, { args: '' });
      collector.addFragment(0, { args: '{}' });

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0].args).toBe('{}');
    });

    it('should handle name fragments correctly (last name wins)', () => {
      // Name should use override logic (last fragment wins)
      collector.addFragment(0, { name: 'partial' });
      collector.addFragment(0, { name: 'partial_tool' });
      collector.addFragment(0, { name: 'test_tool' });
      collector.addFragment(0, { args: '{}' });

      const completeCalls = collector.getCompleteCalls();
      expect(completeCalls).toHaveLength(1);
      expect(completeCalls[0].name).toBe('test_tool'); // Last name wins
      expect(completeCalls[0].args).toBe('{}');
    });
  });
});
