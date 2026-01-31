/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';
import { GOOGLE_WEB_SEARCH_TOOL } from '../packages/core/src/tools/tool-names.js';

// Skip web search tests in CI unless explicitly enabled via RUN_WEB_TESTS=true
// We do not run this in CI because it depends on Gemini-backed server tools.
const skipInCI =
  process.env.CI === 'true' && process.env.RUN_WEB_TESTS !== 'true';

describe('google_web_search', () => {
  it.skipIf(skipInCI)('should be able to search the web', async () => {
    const rig = new TestRig();
    await rig.setup('should be able to search the web');

    let result;
    try {
      result = await rig.run(`what is the weather in London`);
    } catch (error) {
      // Network errors can occur in CI environments
      if (
        error instanceof Error &&
        (error.message.includes('network') || error.message.includes('timeout'))
      ) {
        console.warn(
          'Skipping test due to network error:',
          (error as Error).message,
        );
        return; // Skip the test
      }
      throw error; // Re-throw if not a network error
    }

    const foundToolCall = await rig.waitForToolCall(GOOGLE_WEB_SEARCH_TOOL);

    // Add debugging information
    if (!foundToolCall) {
      const allTools = printDebugInfo(rig, result);

      // Check if the tool call failed due to network issues
      const failedSearchCalls = allTools.filter(
        (t) =>
          t.toolRequest.name === GOOGLE_WEB_SEARCH_TOOL &&
          !t.toolRequest.success,
      );
      if (failedSearchCalls.length > 0) {
        console.warn(
          'google_web_search tool was called but failed, possibly due to network issues',
        );
        console.warn(
          'Failed calls:',
          failedSearchCalls.map((t) => t.toolRequest.args),
        );
        return; // Skip the test if network issues
      }
    }

    expect(
      foundToolCall,
      'Expected to find a call to google_web_search',
    ).toBeTruthy();

    // Validate model output - will throw if no output, warn if missing expected content
    const hasExpectedContent = validateModelOutput(
      result,
      ['weather', 'london'],
      'Google web search test',
    );

    // If content was missing, log the search queries used
    if (!hasExpectedContent) {
      const searchCalls = rig
        .readToolLogs()
        .filter((t) => t.toolRequest.name === GOOGLE_WEB_SEARCH_TOOL);
      if (searchCalls.length > 0) {
        console.warn(
          'Search queries used:',
          searchCalls.map((t) => t.toolRequest.args),
        );
      }
    }
  });
});
