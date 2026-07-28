/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Factory that builds a lazy resolveBackend closure for GenerateImageTool.
 *
 * Returns a CodexImageBackend when the active provider's base URL is a Codex
 * URL and a Codex OAuth token is available; returns null otherwise.
 *
 * The closure is deliberately lazy: it reads the active provider and OAuth
 * state at invocation time (when the model calls generate_image), NOT at
 * registration time. This is critical because the provider manager and OAuth
 * manager are wired onto Config AFTER the tool registry is constructed.
 */

import type { OAuthManager } from '@vybestack/llxprt-code-auth';

import { CodexImageBackend } from './codexImageBackend.js';
import type { CodexImageBackendDeps } from './codexImageBackend.js';
import { getBaseUrlFromProvider } from '../baseUrlResolver.js';
import type { IProvider } from '../IProvider.js';

/**
 * Structural shape the GenerateImageTool expects from a resolved backend.
 * Duplicated here because the tools package is a leaf dependency that cannot
 * be imported from providers. TypeScript structural typing makes the concrete
 * CodexImageBackend assignable to this shape.
 */
export interface ResolvedImageBackendLike {
  readonly name: string;
  generate(
    request: {
      readonly prompt: string;
      readonly model?: string;
      readonly background?: string;
      readonly quality?: string;
      readonly size?: string;
      readonly n?: number;
      readonly sessionId?: string;
    },
    signal: AbortSignal,
  ): Promise<{
    readonly mimeType: string;
    readonly data: string;
    readonly encoding: 'url' | 'base64';
    readonly caption?: string;
  }>;
}

export interface CodexImageBackendResolverDeps {
  readonly oauthManager: OAuthManager | undefined;
  readonly getActiveProvider: () => IProvider | undefined;
  readonly fetchImpl?: typeof fetch;
}

function isCodexBaseUrl(baseUrl: string | undefined): boolean {
  return baseUrl?.includes('chatgpt.com/backend-api/codex') ?? false;
}

/**
 * Build a lazy resolver that returns a CodexImageBackend when the active
 * provider is in Codex mode, or null otherwise.
 *
 * Auth is resolved lazily inside the backend's getAccessToken/getAccountId
 * so the token is fetched fresh on each generate() call, not cached.
 */
export function createCodexImageBackendResolver(
  deps: CodexImageBackendResolverDeps,
): () => ResolvedImageBackendLike | null {
  return () => {
    const provider = deps.getActiveProvider();
    if (provider === undefined) {
      return null;
    }

    const baseUrl = getBaseUrlFromProvider(provider);
    if (!isCodexBaseUrl(baseUrl)) {
      return null;
    }

    if (deps.oauthManager === undefined) {
      return null;
    }

    const backendDeps: CodexImageBackendDeps = {
      getAccessToken: async () => {
        const token = await deps.oauthManager!.getOAuthToken?.('codex');
        if (token === null || token === undefined) {
          throw new Error(
            'Codex image generation requires OAuth authentication. Run /auth codex enable.',
          );
        }
        return token.access_token;
      },
      getAccountId: async () => {
        const token = await deps.oauthManager!.getOAuthToken?.('codex');
        if (token === null || token === undefined) {
          throw new Error(
            'Codex image generation requires OAuth authentication. Run /auth codex enable.',
          );
        }
        const accountId = (token as Record<string, unknown>)['account_id'];
        if (typeof accountId !== 'string' || accountId === '') {
          throw new Error(
            'Codex image generation requires an OAuth token with account_id.',
          );
        }
        return accountId;
      },
      getBaseUrl: () => baseUrl,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    };

    return new CodexImageBackend(
      backendDeps,
    ) as unknown as ResolvedImageBackendLike;
  };
}
