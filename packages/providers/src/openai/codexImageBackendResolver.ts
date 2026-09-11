/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Factory that builds a lazy resolveBackend closure for GenerateImageTool.
 *
 * Returns a CodexImageBackend whenever an OAuth manager is available, and null
 * otherwise. Image generation is NOT gated on the active conversational
 * provider: it is a Codex-backed capability usable from any provider. Whether
 * the user actually holds Codex credentials is resolved per operation, so a
 * missing token produces an actionable authentication error rather than the
 * capability appearing absent.
 *
 * The closure is deliberately lazy: it reads the active provider and OAuth
 * state at invocation time (when the model calls generate_image), NOT at
 * registration time. This is critical because the provider manager and OAuth
 * manager are wired onto Config AFTER the tool registry is constructed.
 */

import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { ImageGenerateRequest } from '@vybestack/llxprt-code-core';
import type { ImageProfile } from '@vybestack/llxprt-code-settings';
import type { ImageBackendAuth } from '../imageBackendAuth.js';

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
export type ImageProfileOperationOverrides = Pick<
  ImageGenerateRequest,
  'quality' | 'size' | 'background'
>;

export interface ResolvedImageProfileBackendConfig {
  readonly backend: ImageProfile['backend'];
  readonly model: string;
  readonly baseUrl: string;
  readonly auth: ImageBackendAuth;
  readonly overrides: ImageProfileOperationOverrides;
}

type ImageBackendAuthContext = 'codex' | 'openai' | 'local';

export class ImageBackendAuthModeError extends Error {
  readonly profileName: string;
  readonly backend: ImageBackendAuthContext;
  readonly authType: ImageBackendAuth['type'];

  constructor(
    profileName: string,
    backend: ImageBackendAuthContext,
    authType: ImageBackendAuth['type'],
  ) {
    super(
      `Image profile '${profileName}' cannot use auth mode '${authType}' with the '${backend}' backend`,
    );
    this.name = 'ImageBackendAuthModeError';
    this.profileName = profileName;
    this.backend = backend;
    this.authType = authType;
  }
}

export class ImageBackendBaseUrlError extends Error {
  readonly profileName: string;
  readonly baseUrl: string;

  constructor(profileName: string, baseUrl: string) {
    super(`Image profile '${profileName}' has an invalid base URL: ${baseUrl}`);
    this.name = 'ImageBackendBaseUrlError';
    this.profileName = profileName;
    this.baseUrl = baseUrl;
  }
}

function resolveAuthContext(
  profile: ImageProfile,
  profileName: string,
): ImageBackendAuthContext {
  if (profile.backend === 'codex') {
    return 'codex';
  }

  let hostname: string;
  try {
    hostname = new URL(profile.baseUrl).hostname.toLowerCase();
  } catch {
    throw new ImageBackendBaseUrlError(profileName, profile.baseUrl);
  }
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.startsWith('127.')
  ) {
    return 'local';
  }
  return 'openai';
}

export function validateImageProfileAuth(
  profile: ImageProfile,
  profileName = '<active>',
): void {
  const backend = resolveAuthContext(profile, profileName);
  const authType = profile.auth.type;
  const allowedModes: Readonly<
    Record<ImageBackendAuthContext, ReadonlyArray<ImageBackendAuth['type']>>
  > = {
    codex: ['oauth'],
    openai: ['api-key', 'named-key', 'keyfile'],
    local: ['none'],
  };
  const valid = allowedModes[backend].includes(authType);
  if (!valid) {
    throw new ImageBackendAuthModeError(profileName, backend, authType);
  }
}

export function resolveImageProfileBackendConfig(
  profile: ImageProfile,
  profileName = '<active>',
): ResolvedImageProfileBackendConfig {
  validateImageProfileAuth(profile, profileName);
  const defaults = profile.defaults;
  const overrides: ImageProfileOperationOverrides = {
    ...(defaults?.quality === undefined ? {} : { quality: defaults.quality }),
    ...(defaults?.size === undefined ? {} : { size: defaults.size }),
    ...(defaults?.background === undefined
      ? {}
      : { background: defaults.background }),
  };
  return {
    backend: profile.backend,
    model: profile.model,
    baseUrl: profile.baseUrl,
    auth: profile.auth,
    overrides,
  };
}

export interface CodexImageBackendResolverDeps {
  readonly oauthManager: OAuthManager | undefined;
  readonly getActiveProvider: () => IProvider | undefined;
  readonly getActiveImageProfile?: () => ImageProfile | undefined;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Canonical Codex backend endpoint, used when the active provider is not a
 * Codex provider (image generation does not require one — see the resolver).
 */
const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function isCodexBaseUrl(baseUrl: string | undefined): baseUrl is string {
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
  const accountId =
    'account_id' in token && typeof token.account_id === 'string'
      ? token.account_id
      : undefined;
  if (accountId === undefined || accountId === '') {
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
    const imageProfile = deps.getActiveImageProfile?.();
    const profileConfig =
      imageProfile === undefined
        ? undefined
        : resolveImageProfileBackendConfig(imageProfile);
    if (profileConfig?.backend === 'openai-images') {
      return null;
    }

    const oauthManager = deps.oauthManager;
    if (oauthManager === undefined && profileConfig === undefined) {
      return null;
    }

    const provider = deps.getActiveProvider();
    const activeBaseUrl =
      provider === undefined ? undefined : getBaseUrlFromProvider(provider);
    const baseUrl =
      profileConfig?.baseUrl ??
      (isCodexBaseUrl(activeBaseUrl) ? activeBaseUrl : DEFAULT_CODEX_BASE_URL);

    const getCredential = (): Promise<CodexImageCredential> => {
      if (oauthManager === undefined) {
        throw new Error('Codex image backend requires OAuth authentication');
      }
      return resolveFreshCredential(oauthManager);
    };
    const backendDeps: CodexImageBackendDeps = {
      getCredential,
      getBaseUrl: () => baseUrl,
      ...(profileConfig === undefined
        ? {}
        : {
            model: profileConfig.model,
            defaults: profileConfig.overrides,
            allowCustomBaseUrl: true,
          }),
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    };

    return new CodexImageBackend(backendDeps);
  };
}
