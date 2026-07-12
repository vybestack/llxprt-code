/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * safe-domain-types.ts — companion module for the safe-neutral-names fixture.
 *
 * Defines neutral/domain types that happen to share names with banned Google
 * symbols (Content, Tool, Schema, Type). These are LOCAL NEUTRAL types, NOT
 * imported from any banned module.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 */

export interface Content {
  speaker: 'human' | 'ai';
  blocks: unknown[];
}

export interface Tool {
  name: string;
}

export interface Schema {
  type: string;
}

export type Type = 'string' | 'object' | 'array';
