/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P19,P20
 * @requirement:HOOK-134
 *
 * Test utility for creating minimal Config objects with hooks configured.
 * Used by behavioral tests to verify hook integration actually works.
 */

import type { Config } from '../../config/config.js';
import type { HookDefinition, HookType } from '../types.js';
import { HookSystem } from '../hookSystem.js';

/**
 * Options for creating a test config with a hook
 */
export interface TestHookOptions {
  /**
   * The hook event type
   */
  event:
    | 'BeforeTool'
    | 'AfterTool'
    | 'BeforeModel'
    | 'AfterModel'
    | 'BeforeToolSelection';

  /**
   * Shell command to execute
   */
  command: string;

  /**
   * Optional matcher pattern for the hook
   */
  matcher?: string;

  /**
   * Optional timeout in milliseconds (default: 5000)
   */
  timeout?: number;
}

/**
 * Creates a minimal Config object with a single hook configured for testing.
 *
 * This utility builds a Config with just enough functionality to:
 * 1. Enable hooks
 * 2. Register a single hook for the specified event
 * 3. Provide session/working directory context
 * 4. Lazily initialize a HookSystem singleton
 *
 * @param options - Hook configuration options
 * @returns A Config object suitable for testing hook triggers
 */
export function createTestConfigWithHook(options: TestHookOptions): Config {
  const hookDef: HookDefinition = {
    matcher: options.matcher,
    hooks: [
      {
        type: 'command' as HookType.Command,
        command: options.command,
        timeout: options.timeout ?? 5000,
      },
    ],
  };

  // Build hooks map keyed by event name (as expected by HookRegistry)
  // The registry expects { [HookEventName]: HookDefinition[] }
  const hooks: Record<string, HookDefinition[]> = {
    [options.event]: [hookDef],
  };

  // HookSystem singleton for this config
  let hookSystem: HookSystem | undefined;

  // Create a minimal Config mock that satisfies hook system requirements
  const config = {
    getEnableHooks: () => true,
    getHooks: () => hooks,
    getSessionId: () => 'test-session-' + Date.now(),
    getWorkingDir: () => '/tmp/test',
    getTargetDir: () => '/tmp/test',
    getExtensions: () => [],
    getModel: () => 'test-model',
    getHookSystem: () => {
      // Lazy initialization of HookSystem singleton
      if (!hookSystem) {
        hookSystem = new HookSystem(config as Config);
      }
      return hookSystem;
    },
  } as unknown as Config;

  return config;
}

/**
 * Creates a Config with hooks disabled for testing disabled-hooks path
 */
export function createTestConfigWithHooksDisabled(): Config {
  return {
    getEnableHooks: () => false,
    getHooks: () => ({}),
    getSessionId: () => 'test-session-disabled',
    getWorkingDir: () => '/tmp/test',
    getTargetDir: () => '/tmp/test',
    getExtensions: () => [],
    getModel: () => 'test-model',
    getHookSystem: () => undefined,
  } as unknown as Config;
}
