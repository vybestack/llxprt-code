/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, ContentGenerator } from '../core/contentGenerator.js';
import { getOauthClient } from './oauth2.js';
import { setupUser } from './setup.js';
import { CodeAssistServer, HttpOptions } from './server.js';
import { Config } from '../config/config.js';

export async function createCodeAssistContentGenerator(
  httpOptions: HttpOptions,
  authType: AuthType,
  config: Config,
  baseURL?: string, // Add baseURL parameter
  _sessionId?: string, // PRIVACY FIX: parameter kept for backward compatibility but not used
): Promise<ContentGenerator> {
  console.log(
    `createCodeAssistContentGenerator: authType=${authType}, config=${!!config}, baseURL=${baseURL}`,
  );

  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.CLOUD_SHELL
  ) {
    try {
      console.log(
        `createCodeAssistContentGenerator: calling getOauthClient for authType ${authType}`,
      );
      const authClient = await getOauthClient(authType, config);
      console.log(
        `createCodeAssistContentGenerator: OAuth client created, calling setupUser`,
      );
      const userData = await setupUser(authClient);
      console.log(
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
      console.log(
        `createCodeAssistContentGenerator: ERROR during OAuth setup: ${error}`,
      );
      console.log(`createCodeAssistContentGenerator: Error details:`, error);
      throw error;
    }
  }

  throw new Error(`Unsupported authType: ${authType}`);
}
