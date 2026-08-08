/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OutputFormat } from '../../utils/output-format.js';

/**
 * Role interface for ephemeral (runtime-scoped) settings.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface EphemeralSettings {
  getEphemeralSetting(key: string): unknown;
  setEphemeralSetting(key: string, value: unknown): void;
  getEphemeralSettings(): Record<string, unknown>;
  getOutputFormat(): OutputFormat;
  getQuiet(): boolean;
  getQuestion(): string | undefined;
}
