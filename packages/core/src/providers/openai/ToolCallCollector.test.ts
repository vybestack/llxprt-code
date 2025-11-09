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
});
