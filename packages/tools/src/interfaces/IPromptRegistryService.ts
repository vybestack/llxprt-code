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
 * Tools-owned interface for prompt registry access.
 *
 * Provides prompt registry retrieval and prompt lookup
 * needed by the tool-registry tool.
 *
 * Unconditionally defined as a tools-owned interface even though
 * current usage may route through IToolRegistryHost, because
 * prompt registry will get its own package in a future phase.
 *
 * Consumed by: tool-registry.
 * Implemented by: CorePromptRegistryServiceAdapter in packages/core.
 */

/** Opaque handle to the prompt registry. */
export interface PromptRegistry {
  /** Get a prompt by name. */
  getPrompt?: (name: string) => Prompt | undefined;
  /** List all prompt names. */
  getPromptNames?: () => string[];
}

/** A registered prompt. */
export interface Prompt {
  /** The prompt name. */
  name: string;
  /** The prompt content or template. */
  content?: string;
  /** Additional prompt metadata. */
  [key: string]: unknown;
}

export interface IPromptRegistryService {
  /**
   * Get the prompt registry instance.
   * @returns The prompt registry.
   */
  getPromptRegistry(): PromptRegistry;

  /**
   * Get a specific prompt by name.
   * @param name - The prompt name.
   * @returns The prompt, or undefined if not found.
   */
  getPrompt(name: string): Prompt | undefined;
}
