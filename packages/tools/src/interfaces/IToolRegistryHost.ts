/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for tool registry host queries.
 *
 * Provides core tools list, excluded tools, discovery command,
 * and tool enablement checks needed by the tool-registry tool.
 *
 * Consumed by: tool-registry.
 * Implemented by: CoreToolRegistryHostAdapter in packages/core.
 */
export interface IToolRegistryHost {
  /** Returns ephemeral settings used for tool governance. */
  getEphemeralSettings?(): Record<string, unknown> | null | undefined;

  /** Returns the list of core tool names. */
  getCoreTools?(): string[] | undefined;

  /** Returns the list of excluded tool names. */
  getExcludeTools?(): string[] | undefined;

  /** Returns the tool discovery command, if configured. */
  getToolDiscoveryCommand?(): string | undefined;

  /** Returns the tool call command, if configured. */
  getToolCallCommand?(): string | undefined;

  /** Returns the prompt registry boundary used by discovery refreshes. */
  getPromptRegistry?(): { clear(): void } | undefined;

  /** Returns settings used for schema transforms. */
  getSettingsService?():
    | {
        getAllGlobalSettings?(): Record<string, unknown> | undefined;
        get?(key: string): unknown;
      }
    | undefined;

  /** Whether a specific tool is enabled. */
  isToolEnabled?(name: string): boolean;

  /** Whether the host workspace is trusted for trusted MCP tools. */
  isTrustedFolder?(): boolean;
}
