/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * event-types.ts (Finding #1 fixture) — path-accurate to allow-list suffix.
 *
 * The full path ends with "packages/agents/src/api/event-types.ts", matching
 * the allow-list entry's file-suffix pattern. Contains BOTH:
 *   - Declared type members (PropertySignature) — legitimate, exempted
 *   - A runtime object literal using promptTokenCount — must FAIL
 *
 * The runtime hit proves Finding #1: event-types.ts key-name entries must
 * require hit.inTypeDecl true.
 *
 * `--enforce-imports` MUST exit non-zero (runtime hit unexempt).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

export type UsageMetadataValue = Readonly<{
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}>;

export function buildUsageRecord(): Record<string, unknown> {
  return {
    promptTokenCount: 42,
  };
}
