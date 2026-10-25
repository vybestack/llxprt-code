/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buildSlashCommandRuntime,
  type CliUiRuntime,
} from '../ui/cliUiRuntime.js';

/**
 * The one place test code builds a slash-command runtime. Every test that needs
 * a `CliUiRuntime` goes through here, so a change to what the runtime needs at
 * construction is made in this function rather than at each test.
 */
export function buildSlashCommandRuntimeForTest(
  ...args: Parameters<typeof buildSlashCommandRuntime>
): CliUiRuntime {
  return buildSlashCommandRuntime(...args);
}
