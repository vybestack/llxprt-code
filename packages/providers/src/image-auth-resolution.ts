/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import { createProviderKeyStorage } from './auth/proxy/credential-store-factory.js';
import type { ImageBackendAuth } from './imageBackendAuth.js';
import type { CodexImageCredential } from './openai/codexImageBackend.js';

export type ImageCredentialErrorCode =
  | 'named_key_missing'
  | 'keyfile_unreadable'
  | 'oauth_unavailable';

export class ImageCredentialError extends Error {
  constructor(
    readonly code: ImageCredentialErrorCode,
    message: string,
    readonly reference?: string,
  ) {
    super(message);
    this.name = 'ImageCredentialError';
  }
}

type CodexTokenSource = Pick<OAuthManager, 'getOAuthToken'>;

export interface ImageApiKeyResolverDeps {
  readonly getKeyStorage?: () => {
    getKey(name: string): Promise<string | null>;
  };
  readonly oauthManager?: CodexTokenSource;
}

/**
 * Resolve one paired identity through the existing OAuth access/refresh machinery.
 * @param oauthManager Runtime-owned Codex token source.
 * @returns Access token and account id from the same token fetch.
 * @throws ImageCredentialError when Codex authentication is unavailable.
 */
export async function resolveCodexImageCredential(
  oauthManager: CodexTokenSource | undefined,
): Promise<CodexImageCredential> {
  const token = await oauthManager?.getOAuthToken?.('codex');
  if (token === null || token === undefined) {
    throw new ImageCredentialError(
      'oauth_unavailable',
      'Codex image generation requires OAuth authentication. Run /auth codex enable.',
    );
  }
  const accessToken = token.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new ImageCredentialError(
      'oauth_unavailable',
      'Codex image generation requires an OAuth token with a non-empty access_token.',
    );
  }
  const accountId =
    'account_id' in token && typeof token.account_id === 'string'
      ? token.account_id
      : undefined;
  if (accountId === undefined || accountId === '') {
    throw new ImageCredentialError(
      'oauth_unavailable',
      'Codex image generation requires an OAuth token with account_id.',
    );
  }
  return { accessToken, accountId };
}

/**
 * Build an uncached resolver for image-profile credentials only.
 * @param deps Runtime token source and optional key-storage factory.
 * @returns A resolver called separately for each image operation.
 * @throws ImageCredentialError for missing named keys or unreadable keyfiles.
 */
export function createImageApiKeyResolver(
  deps: ImageApiKeyResolverDeps = {},
): (auth: ImageBackendAuth) => Promise<string | undefined> {
  return async (auth) => {
    switch (auth.type) {
      case 'none':
        return undefined;
      case 'api-key':
        return auth.apiKey;
      case 'named-key': {
        const storage = (deps.getKeyStorage ?? createProviderKeyStorage)();
        const key = await storage.getKey(auth.keyName);
        if (key === null) {
          throw new ImageCredentialError(
            'named_key_missing',
            `Image profile key '${auth.keyName}' was not found.`,
            auth.keyName,
          );
        }
        return key;
      }
      case 'keyfile':
        try {
          return (await readFile(auth.path, 'utf8')).replace(/\r?\n$/, '');
        } catch {
          throw new ImageCredentialError(
            'keyfile_unreadable',
            `Image profile keyfile '${auth.path}' could not be read.`,
            auth.path,
          );
        }
      case 'oauth':
        return (await resolveCodexImageCredential(deps.oauthManager))
          .accessToken;
      default:
        throw new Error('Unsupported image credential mode.');
    }
  };
}
