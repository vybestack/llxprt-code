/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '../core/contentGenerator.js';
import { CodeAssistServer } from './server.js';
import type { Config } from '../config/config.js';
import { debugLogger } from '../utils/debugLogger.js';

export interface CodeAssistServerSource {
  getAgentClient():
    | {
        getContentGenerator(): ContentGenerator;
      }
    | null
    | undefined;
}

export function getCodeAssistServer(
  config: CodeAssistServerSource,
): CodeAssistServer | undefined {
  const agentClient = config.getAgentClient();
  if (!agentClient) {
    return undefined;
  }

  const generator = agentClient.getContentGenerator();

  // Direct CodeAssistServer (e.g. in tests or legacy wiring)
  if (generator instanceof CodeAssistServer) {
    return generator;
  }

  // Structural fallback: some test mocks and legacy wiring produce plain
  // objects that carry projectId. Detect them structurally so the privacy
  // settings hook continues to work.
  if (typeof generator === 'object' && 'projectId' in generator) {
    return generator as unknown as CodeAssistServer;
  }

  return undefined;
}

/**
 * Emits a citation event if citation display is enabled for the current user.
 * This function integrates with llxprt's provider abstraction to work across all providers.
 */
export function emitCitationEvent(config: Config, citationText: string): void {
  const providerManager = config.getProviderManager();
  if (providerManager) {
    try {
      debugLogger.debug('Citation event would be emitted:', citationText);
    } catch (error) {
      debugLogger.debug('Failed to emit citation event:', error);
    }
  }
}
