/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolResult } from '../index.js';

export interface ExecutableTool {
  execute(...args: readonly unknown[]): Promise<ToolResult>;
}

export async function executeToolForBehavioralAssertion(
  tool: ExecutableTool,
  ...args: readonly unknown[]
): Promise<ToolResult> {
  try {
    return await tool.execute(...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      llmContent: '',
      returnDisplay: '',
      error: { message },
    };
  }
}
