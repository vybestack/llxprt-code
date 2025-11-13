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

/**
 * ToolCallCollector - Collects and assembles ToolCall fragments
 *
 * Fundamental solution to OpenAIProvider streaming accumulation defects.
 * Avoid using += operator to accumulate names, instead collect fragments and assemble.
 */

import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:providers:openai:toolCallCollector');

/**
 * Tool call fragment interface
 */
export interface ToolCallFragment {
  index: number;
  name?: string;
  args?: string;
  timestamp: number;
}

/**
 * Tool call candidate interface
 */
export interface ToolCallCandidate {
  index: number;
  name?: string;
  args?: string;
  fragments: ToolCallFragment[];
}

/**
 * ToolCallCollector - Responsible for collecting and assembling tool call fragments
 *
 * Core functionality:
 * 1. Collect fragments from each streaming chunk
 * 2. Avoid collecting duplicate fragments
 * 3. Determine when collection is complete
 * 4. Assemble complete tool calls
 */
export class ToolCallCollector {
  private fragments = new Map<number, ToolCallFragment[]>();

  /**
   * Add tool call fragment
   */
  addFragment(index: number, fragment: Partial<ToolCallFragment>): void {
    if (!this.fragments.has(index)) {
      this.fragments.set(index, []);
    }

    const existingFragments = this.fragments.get(index)!;
    const completeFragment: ToolCallFragment = {
      index,
      timestamp: Date.now(),
      ...fragment,
    };

    // Check if it's a duplicate fragment
    const isDuplicate = existingFragments.some((existing) =>
      this.isDuplicateFragment(existing, completeFragment),
    );

    if (!isDuplicate) {
      existingFragments.push(completeFragment);
      logger.debug(`Added fragment to tool call ${index}`);
    }
  }

  /**
   * Get all completed tool calls
   */
  getCompleteCalls(): ToolCallCandidate[] {
    const completeCalls: ToolCallCandidate[] = [];

    for (const [index, fragments] of this.fragments.entries()) {
      if (this.isComplete(fragments)) {
        const assembledCall = this.assembleCall(index, fragments);
        if (assembledCall) {
          completeCalls.push(assembledCall);
        }
      }
    }

    return completeCalls;
  }

  /**
   * Check if fragment is complete
   */
  private isComplete(fragments: ToolCallFragment[]): boolean {
    if (fragments.length === 0) {
      return false;
    }

    // Check if name exists
    const hasName = fragments.some((f) => f.name && f.name.trim());
    if (!hasName) {
      return false;
    }

    return true;
  }

  /**
   * Assemble complete tool call
   */
  private assembleCall(
    index: number,
    fragments: ToolCallFragment[],
  ): ToolCallCandidate | null {
    const result: ToolCallCandidate = {
      index,
      fragments: [...fragments].sort((a, b) => a.timestamp - b.timestamp),
    };

    // Assemble final result - name uses override, args use accumulation
    let accumulatedArgs = '';
    for (const fragment of result.fragments) {
      if (fragment.name) {
        result.name = fragment.name; // name uses override logic
      }
      if (fragment.args) {
        accumulatedArgs += fragment.args; // args use accumulation logic
      }
    }
    result.args = accumulatedArgs;

    if (!result.name) {
      logger.error(`Assembled tool call ${index} missing name`);
      return null;
    }

    logger.debug(`Assembled complete tool call ${index}: ${result.name}`);
    return result;
  }

  /**
   * Check if two fragments are duplicates
   */
  private isDuplicateFragment(
    existing: ToolCallFragment,
    newFragment: ToolCallFragment,
  ): boolean {
    // Only check for duplicate names, not args
    // Args fragments should be accumulated, not treated as duplicates
    if (
      existing.name &&
      newFragment.name &&
      existing.name === newFragment.name
    ) {
      return true;
    }
    return false;
  }

  /**
   * Get collector statistics
   */
  getStats() {
    let completedCalls = 0;
    let pendingFragments = 0;

    for (const fragments of this.fragments.values()) {
      if (this.isComplete(fragments)) {
        completedCalls++;
      }
      pendingFragments += fragments.length;
    }

    return {
      totalCalls: this.fragments.size,
      completedCalls,
      pendingFragments,
    };
  }

  /**
   * Reset collector state
   */
  reset(): void {
    this.fragments.clear();
    logger.debug('ToolCallCollector reset');
  }
}
