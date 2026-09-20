/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260608-ISSUE1588.P06
 * @requirement REQ-SVC-001
 *
 * Issue #2616 PR A: this module is reduced to the pure single-owner
 * construction seam used by composition sites (agents, CLI bootstrap, core
 * config construction). Every ambient helper that read or mutated
 * process-wide runtime state — resolve/get/maybeGet runtime settings
 * service, settings runtime context creation, activation/deactivation —
 * and the import-time factory registration are deleted. Consumers receive
 * their SettingsService explicitly.
 */

import {
  SettingsService,
  type SettingsServiceInit,
} from '@vybestack/llxprt-code-settings';

export function createRuntimeSettingsService(
  options?: SettingsServiceInit,
): SettingsService {
  return new SettingsService(options);
}
