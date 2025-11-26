/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { AgentDefinition } from './types.js';
import type { z } from 'zod';
import { DebugLogger } from '../debug/DebugLogger.js';

/**
 * Manages the discovery, loading, validation, and registration of
 * AgentDefinitions.
 */
export class AgentRegistry {
  // Using unknown output type for the internal map to handle generic variance correctly
  // Callers will cast to specific types as needed
  private readonly agents = new Map<string, AgentDefinition>();
  private readonly logger = new DebugLogger('llxprt:agents:registry');

  constructor(private readonly config: Config) {
    // Access config to satisfy lint and allow future conditional logging
    void this.config;
  }

  /**
   * Discovers and loads agents.
   */
  async initialize(): Promise<void> {
    this.loadBuiltInAgents();

    this.logger.debug(
      () => `[AgentRegistry] Initialized with ${this.agents.size} agents.`,
    );
  }

  private loadBuiltInAgents(): void {
    // No built-in agents registered - CodebaseInvestigatorAgent was removed
    // because it hardcodes DEFAULT_GEMINI_MODEL, violating multi-provider support
  }

  /**
   * Registers an agent definition. If an agent with the same name exists,
   * it will be overwritten, respecting the precedence established by the
   * initialization order.
   */
  protected registerAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): void {
    // Basic validation
    if (!definition.name || !definition.description) {
      this.logger.warn(
        `[AgentRegistry] Skipping invalid agent definition. Missing name or description.`,
      );
      return;
    }

    if (this.agents.has(definition.name)) {
      this.logger.debug(
        `[AgentRegistry] Overriding agent '${definition.name}'`,
      );
    }

    // Cast to default AgentDefinition type for storage - callers will cast back as needed
    this.agents.set(definition.name, definition as unknown as AgentDefinition);
  }

  /**
   * Retrieves an agent definition by name.
   * Callers should cast to their expected AgentDefinition<TOutput> shape before invoking typed callbacks.
   */
  getDefinition(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Returns all active agent definitions.
   */
  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
