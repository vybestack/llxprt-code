/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { env } from 'node:process';
import { logVerbose } from './diagnostics.js';
import type { TestRig } from './test-rig.js';

/**
 * Get the default test timeout based on the execution environment.
 */
export function getDefaultTimeout(): number {
  if (env['CI']) {
    return 60000;
  }
  if (env['LLXPRT_SANDBOX']) {
    return 30000;
  }
  return 15000;
}

/**
 * Poll a predicate until it returns true or the timeout elapses.
 */
export async function poll(
  predicate: () => boolean,
  timeout: number,
  interval: number,
): Promise<boolean> {
  const startTime = Date.now();
  let attempts = 0;
  while (Date.now() - startTime < timeout) {
    attempts++;
    const result = predicate();
    if (env['VERBOSE'] === 'true' && attempts % 5 === 0) {
      logVerbose(
        `Poll attempt ${attempts}: ${result ? 'success' : 'waiting...'}`,
      );
    }
    if (result) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  if (env['VERBOSE'] === 'true') {
    logVerbose(`Poll timed out after ${attempts} attempts`);
  }
  return false;
}

/**
 * Convert an arbitrary test name into a filesystem-safe slug.
 */
export function sanitizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Build a detailed error message describing expected vs found tool calls.
 */
export function createToolCallErrorMessage(
  expectedTools: string | string[],
  foundTools: string[],
  result: string,
): string {
  const expectedStr = Array.isArray(expectedTools)
    ? expectedTools.join(' or ')
    : expectedTools;
  return (
    `Expected to find ${expectedStr} tool call(s). ` +
    `Found: ${foundTools.length > 0 ? foundTools.join(', ') : 'none'}. ` +
    `Output preview: ${formatOutputPreview(result)}`
  );
}

function formatOutputPreview(result: string): string {
  if (result.length === 0) {
    return 'no output';
  }
  if (result.length <= 200) {
    return result;
  }
  return `${result.substring(0, 200)}...`;
}

/**
 * Print debug information for a failing test. Returns the parsed tool logs.
 */
export function printDebugInfo(
  rig: TestRig,
  result: string,
  context: Record<string, unknown> = {},
) {
  const contextEntries = Object.entries(context)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n');
  const preview = result.substring(0, 500);
  const tail = result.substring(result.length - 500);
  const allTools = rig.readToolLogs();

  const dump =
    `Test failed - Debug info:\n` +
    `Result length: ${result.length}\n` +
    `Result (first 500 chars): ${preview}\n` +
    `Result (last 500 chars): ${tail}\n` +
    `${contextEntries.length > 0 ? contextEntries + '\n' : ''}` +
    `All tool calls found: ${allTools.map((t) => t.toolRequest.name).join(', ')}\n`;

  rig.dumpDiagnostic('printDebugInfo', dump);
  return allTools;
}
function formatExpectedContent(content: string | RegExp): string {
  return content instanceof RegExp ? content.toString() : content;
}

type ExpectedContent = string | Array<string | RegExp>;

/**
 * Validate model output and warn about unexpected content. Returns whether all
 * expected content was present.
 */
export function validateModelOutput(
  result: string,
  expectedContent: ExpectedContent | null = null,
  testName = '',
): boolean {
  if (result.length === 0 || result.trim().length === 0) {
    throw new Error('Expected LLM to return some output');
  }

  if (expectedContent === null) {
    return true;
  }

  const contents = Array.isArray(expectedContent)
    ? expectedContent
    : [expectedContent];
  const missingContent = contents.filter((content) => {
    if (content instanceof RegExp) {
      return !content.test(result);
    }
    return !result.toLowerCase().includes(content.toLowerCase());
  });

  if (missingContent.length > 0) {
    const missingDisplay = missingContent.map(formatExpectedContent).join(', ');
    const warning =
      `Warning: LLM did not include expected content in response: ${missingDisplay}.\n` +
      'This is not ideal but not a test failure.\n' +
      'The tool was called successfully, which is the main requirement.\n' +
      `Expected content: ${String(expectedContent)}\n` +
      `Actual output: ${result}`;
    logVerbose(warning);
    return false;
  }

  if (env['VERBOSE'] === 'true') {
    logVerbose(`${testName}: Model output validated successfully.`);
  }
  return true;
}
