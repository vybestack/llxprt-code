/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '../core/contentGenerator.js';
import type {
  ModelGenerationRequest,
  ModelOutput,
  ModelStreamChunk,
  CountTokensRequest,
  CountTokensResult,
  EmbedContentRequest,
  EmbedContentResult,
} from '../llm-types/index.js';
import {
  toGenerateContentParameters,
  fromGenerateContentResponse,
  toCountTokensParameters,
  fromCountTokensResponse,
  mapGeminiStreamToChunks,
} from './contentGeneratorAdapters.js';
import { getOauthClient } from './oauth2.js';
import { setupUser } from './setup.js';
import type { HttpOptions } from './server.js';
import { CodeAssistServer } from './server.js';
import type { Config } from '../config/config.js';
import { DebugLogger } from '../debug/index.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { UserTierId } from './types.js';

/**
 * Neutral ContentGenerator adapter that wraps a Google-native CodeAssistServer.
 * Converts neutral requests to Google parameters and Google responses back to
 * neutral ModelOutput. Preserves projectId so usePrivacySettings can detect
 * code-assist via structural probing.
 */
export class CodeAssistContentGeneratorAdapter implements ContentGenerator {
  readonly server: CodeAssistServer;

  constructor(server: CodeAssistServer) {
    this.server = server;
  }

  get projectId(): string | undefined {
    return this.server.projectId;
  }

  get userTier(): UserTierId | undefined {
    return this.server.userTier;
  }

  async generateContent(
    request: ModelGenerationRequest,
    userPromptId: string,
  ): Promise<ModelOutput> {
    const params = toGenerateContentParameters(request);
    const response = await this.server.generateContent(params, userPromptId);
    return fromGenerateContentResponse(response);
  }

  async generateContentStream(
    request: ModelGenerationRequest,
    userPromptId: string,
  ): Promise<AsyncGenerator<ModelStreamChunk>> {
    const params = toGenerateContentParameters(request);
    const stream = await this.server.generateContentStream(
      params,
      userPromptId,
    );
    return mapGeminiStreamToChunks(stream);
  }

  async countTokens(request: CountTokensRequest): Promise<CountTokensResult> {
    const params = toCountTokensParameters(request);
    const response = await this.server.countTokens(params);
    return fromCountTokensResponse(response);
  }

  async embedContent(
    _request: EmbedContentRequest,
  ): Promise<EmbedContentResult> {
    throw new Error('embedContent not supported for code_assist');
  }
}

export async function createCodeAssistContentGenerator(
  httpOptions: HttpOptions,
  config: Config,
  baseURL?: string, // Add baseURL parameter
  _sessionId?: string, // PRIVACY FIX: parameter kept for backward compatibility but not used
): Promise<ContentGenerator> {
  const logger = new DebugLogger('llxprt:code:assist');

  logger.debug(
    () =>
      `createCodeAssistContentGenerator: config=defined, baseURL=${baseURL}`,
  );

  const server = await createCodeAssistServer(
    httpOptions,
    config,
    baseURL,
    logger,
  );
  return new CodeAssistContentGeneratorAdapter(server);
}

/**
 * Create a raw CodeAssistServer (Google-native). Used by the Gemini provider's
 * OAuth path which calls the Google-native methods directly.
 */
export async function createCodeAssistServer(
  httpOptions: HttpOptions,
  config: Config,
  baseURL?: string,
  logger?: DebugLogger,
): Promise<CodeAssistServer> {
  const log = logger ?? new DebugLogger('llxprt:code:assist');

  log.debug(() => `createCodeAssistServer: calling getOauthClient`);
  const authClient = await getOauthClient(config);
  log.debug(
    () => `createCodeAssistServer: OAuth client created, calling setupUser`,
  );
  const userData = await setupUser(authClient);
  log.debug(
    () =>
      `createCodeAssistServer: setupUser completed, projectId=${userData.projectId}, userTier=${userData.userTier}`,
  );
  return new CodeAssistServer(
    authClient,
    userData.projectId,
    httpOptions,
    userData.userTier,
    baseURL,
  );
}

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

  // Unwrap the neutral adapter if present
  if (generator instanceof CodeAssistContentGeneratorAdapter) {
    return generator.server;
  }

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
  // Get provider manager to emit citation through the event system
  const providerManager = config.getProviderManager();
  if (providerManager) {
    // Use the provider manager's event system to emit citation events
    // This ensures the event flows through the proper channels to reach the CLI
    try {
      // Follow-up (#1569): Implement provider-neutral event emission
      // For now, this is a placeholder that can be extended when we have
      // a provider-neutral event emission system
      debugLogger.debug('Citation event would be emitted:', citationText);
    } catch (error) {
      debugLogger.debug('Failed to emit citation event:', error);
    }
  }
}
