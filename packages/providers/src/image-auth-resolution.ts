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
  | 'api_key_empty'
  | 'keyfile_invalid'
  | 'named_key_missing'
  | 'keyfile_unreadable'
  | 'keyfile_empty'
  | 'oauth_unavailable';

export class ImageCredentialError extends Error {
  constructor(
    readonly code: ImageCredentialErrorCode,
    message: string,
    readonly reference?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ImageCredentialError';
  }
}

type CodexTokenSource = Pick<OAuthManager, 'getOAuthToken'>;

export interface ImageApiKeyResolverDeps {
  readonly readFile?: typeof readFile;
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
  let token;
  try {
    token = await oauthManager?.getOAuthToken?.('codex');
  } catch (cause) {
    if (cause instanceof ImageCredentialError) throw cause;
    throw new ImageCredentialError(
      'oauth_unavailable',
      'Codex image OAuth authentication failed.',
      undefined,
      { cause },
    );
  }
  if (token === null || token === undefined) {
    throw new ImageCredentialError(
      'oauth_unavailable',
      'Codex image generation requires OAuth authentication. Run /auth codex enable.',
    );
  }
  const accessToken = token.access_token.trim();
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new ImageCredentialError(
      'oauth_unavailable',
      'Codex image generation requires an OAuth token with a non-empty access_token.',
    );
  }
  const accountId =
    'account_id' in token && typeof token.account_id === 'string'
      ? token.account_id.trim()
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
      case 'api-key': {
        const key = auth.apiKey.trim();
        if (key === '')
          throw new ImageCredentialError(
            'api_key_empty',
            'Image profile API key is empty.',
          );
        return key;
      }
      case 'named-key': {
        const storage = (deps.getKeyStorage ?? createProviderKeyStorage)();
        const key = await storage.getKey(auth.keyName);
        if (key === null || key.trim() === '') {
          throw new ImageCredentialError(
            'named_key_missing',
            `Image profile key '${auth.keyName}' was not found.`,
            auth.keyName,
          );
        }
        return key;
      }
      case 'keyfile': {
        let content: string;
        try {
          content = await (deps.readFile ?? readFile)(auth.path, 'utf8');
        } catch (cause) {
          throw new ImageCredentialError(
            'keyfile_unreadable',
            `Image profile keyfile '${auth.path}' could not be read.`,
            auth.path,
            { cause },
          );
        }
        const key = content.trimEnd();
        if (key === '') {
          throw new ImageCredentialError(
            'keyfile_empty',
            `Image profile keyfile '${auth.path}' is empty.`,
            auth.path,
          );
        }
        if (
          [...key].some(
            (character) =>
              character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
          )
        ) {
          throw new ImageCredentialError(
            'keyfile_invalid',
            `Image profile keyfile '${auth.path}' contains control characters.`,
            auth.path,
          );
        }
        return key;
      }
      case 'oauth':
        return (await resolveCodexImageCredential(deps.oauthManager))
          .accessToken;
      default: {
        const exhaustive: never = auth;
        throw new Error(`Unsupported image credential mode: ${exhaustive}`);
      }
    }
  };
}
