/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boundary interface for optional hook configuration access.
 *
 * `Config` implements this surface, but CLI test doubles and partial fakes
 * may omit the hook accessors entirely. The methods are therefore optional;
 * callers dereference them with optional chaining (`?.()`) so that a missing
 * accessor is treated as "hooks disabled" rather than throwing.
 *
 * Shared by lifecycleHookTriggers.ts and coreToolHookTriggers.ts to avoid
 * duplicate local type definitions and unsafe `as unknown as` casts.
 */

import type { HookSystem } from '../hooks/hookSystem.js';

export interface HookConfigBoundary {
  getEnableHooks?(): boolean;
  getHookSystem?(): HookSystem | undefined;
}
