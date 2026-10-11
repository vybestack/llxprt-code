/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Information about a discovered subagent. */
export interface SubagentInfo {
  name: string;
  description?: string;
  profile?: string;
  updatedAt?: string;
}

/** Metadata for a configured subagent. */
export interface SubagentConfig {
  name: string;
  instructions?: string;
  systemPrompt?: string;
  model?: string;
  profile?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ISubagentCatalog {
  listSubagents(): Promise<SubagentInfo[]>;
  getSubagentConfig(name: string): Promise<SubagentConfig | undefined>;
}
