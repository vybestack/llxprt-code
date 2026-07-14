/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * safe-neutral-names.ts — P02 FALSE-POSITIVE-GUARD fixture.
 *
 * Imports the SAME-NAMED identifiers Content, Tool, Schema, Type from a SAFE,
 * non-banned local module (./safe-domain-types). These are banned NAMES but
 * bound to a SAFE module — checkB MUST SPARE them (provenance, not name).
 *
 * `--enforce-imports` MUST exit 0 on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 */

import type { Content, Tool, Schema, Type } from './safe-domain-types.js';

export function useNeutralNames(
  content: Content,
  tool: Tool,
  schema: Schema,
  type: Type,
): void {
  void content;
  void tool;
  void schema;
  void type;
}
