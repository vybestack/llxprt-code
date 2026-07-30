/**
 * @license
 * Copyright 2026 Vybestack LLC
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

import {
  CodexImageBackend,
  type CodexImageBackendDeps,
  type CodexImageCredential,
} from './codexImageBackend.js';
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
  readonly provider: string;
  readonly model: string;
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
  edit(
    request: {
      readonly prompt: string;
      readonly inputPaths: readonly string[];
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
 * Fetch ONE fresh Codex OAuth token and validate it as a typed Codex token,
 * returning a consistently-paired `{ accessToken, accountId }` credential.
 *
 * Called exactly once per generate()/edit() so the access token and account id
 * always originate from the same token fetch and never diverge.
 */
async function resolveFreshCredential(
  oauthManager: NonNullable<OAuthManager>,
): Promise<CodexImageCredential> {
  const token = await oauthManager.getOAuthToken?.('codex');
  if (token === null || token === undefined) {
    throw new Error(
      'Codex image generation requires OAuth authentication. Run /auth codex enable.',
    );
  }
  const accessToken = token.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error(
      'Codex image generation requires an OAuth token with a non-empty access_token.',
    );
  }
  const accountId = (token as Record<string, unknown>)['account_id'];
  if (typeof accountId !== 'string' || accountId === '') {
    throw new Error(
      'Codex image generation requires an OAuth token with account_id.',
    );
  }
  return { accessToken, accountId };
}

/**
 * Build a lazy resolver that returns a CodexImageBackend when the active
 * provider is in Codex mode, or null otherwise.
 *
 * Auth is resolved lazily and exactly once per generate()/edit() call via the
 * backend's injected `getCredential` callback, so each operation fetches a
 * fresh, consistently-paired credential object (not cached globally).
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

    const oauthManager = deps.oauthManager;
    const backendDeps: CodexImageBackendDeps = {
      getCredential: () => resolveFreshCredential(oauthManager),
      getBaseUrl: () => baseUrl,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    };

    return new CodexImageBackend(backendDeps);
  };
}
