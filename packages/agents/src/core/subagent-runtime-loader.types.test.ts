/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  loadAgentRuntime,
  type ToolSelectedRuntimeLoader,
  type ToolSelectedRuntimeLoaderResult,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { ReadonlySettingsSnapshot } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { SubAgentRuntimeInput } from './subagent.js';

function requireType<T extends true>(): T {
  return true as T;
}

type RejectsUndefined<T> = undefined extends T ? false : true;

describe('child runtime contracts', () => {
  it('require the tool selection and settings snapshot at compile time', () => {
    const childLoader: ToolSelectedRuntimeLoader = loadAgentRuntime;

    expect(typeof childLoader).toBe('function');
    expect(
      requireType<
        RejectsUndefined<ToolSelectedRuntimeLoaderResult['toolRegistry']>
      >(),
    ).toBe(true);
    expect(
      requireType<
        RejectsUndefined<ToolSelectedRuntimeLoaderResult['settingsSnapshot']>
      >(),
    ).toBe(true);
    expect(
      requireType<RejectsUndefined<SubAgentRuntimeInput['toolRegistry']>>(),
    ).toBe(true);
    expect(
      requireType<RejectsUndefined<SubAgentRuntimeInput['settingsSnapshot']>>(),
    ).toBe(true);
    expect(
      requireType<
        SubAgentRuntimeInput['settingsSnapshot'] extends ReadonlySettingsSnapshot
          ? true
          : false
      >(),
    ).toBe(true);
    expect(
      requireType<
        ToolSelectedRuntimeLoaderResult['toolRegistry'] extends ToolSelection
          ? true
          : false
      >(),
    ).toBe(true);
  });
});
