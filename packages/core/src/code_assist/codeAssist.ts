/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '../core/contentGenerator.js';
import { getOauthClient } from './oauth2.js';
import { setupUser } from './setup.js';
import type { HttpOptions } from './server.js';
import { CodeAssistServer } from './server.js';
import type { Config } from '../config/config.js';
import { LoggingContentGenerator } from '../core/loggingContentGenerator.js';
import { DebugLogger } from '../debug/index.js';

export async function createCodeAssistContentGenerator(
  httpOptions: HttpOptions,
  config: Config,
  baseURL?: string, // Add baseURL parameter
  _sessionId?: string, // PRIVACY FIX: parameter kept for backward compatibility but not used
): Promise<ContentGenerator> {
  const logger = new DebugLogger('llxprt:code:assist');

  logger.debug(
    () =>
      `createCodeAssistContentGenerator: config=${!!config}, baseURL=${baseURL}`,
  );

  try {
    logger.debug(
      () => `createCodeAssistContentGenerator: calling getOauthClient`,
    );
    const authClient = await getOauthClient(config);
    logger.debug(
      () =>
        `createCodeAssistContentGenerator: OAuth client created, calling setupUser`,
    );
    const userData = await setupUser(authClient);
    logger.debug(
      () =>
        `createCodeAssistContentGenerator: setupUser completed, projectId=${userData.projectId}, userTier=${userData.userTier}`,
    );
    return new CodeAssistServer(
      authClient,
      userData.projectId,
      httpOptions,
      // PRIVACY FIX: sessionId removed to prevent transmission to Google servers
      // sessionId, // removed
      userData.userTier,
      baseURL, // Pass baseURL to constructor
    );
  } catch (error) {
    logger.debug(
      () =>
        `createCodeAssistContentGenerator: ERROR during OAuth setup: ${error}`,
    );
    logger.debug(
      () => `createCodeAssistContentGenerator: Error details: ${error}`,
    );
    throw error;
  }
}

export function getCodeAssistServer(
  config: Config,
): CodeAssistServer | undefined {
  let server = config.getGeminiClient().getContentGenerator();

  // Unwrap LoggingContentGenerator if present
  if (server instanceof LoggingContentGenerator) {
    server = server.getWrapped();
  }

  if (!(server instanceof CodeAssistServer)) {
    return undefined;
  }
  return server;
}

/**
 * Emits a citation event if citation display is enabled for the current user.
 * This function integrates with llxprt's provider abstraction to work across all providers.
 */
export function emitCitationEvent(config: Config, citationText: string): void {
  // Get provider manager to emit citation through the event system
  const providerManager = config.getProviderManager();
  if (providerManager) {
    // Use the provider manager's event system to emit citation events
    // This ensures the event flows through the proper channels to reach the CLI
    try {
      // TODO: Implement provider-neutral event emission
      // For now, this is a placeholder that can be extended when we have
      // a provider-neutral event emission system
      console.debug('Citation event would be emitted:', citationText);
    } catch (error) {
      console.debug('Failed to emit citation event:', error);
    }
  }
}
