/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolve the active image profile to an OpenAI Images or Codex transport.
 * Profile selection and the active provider are read when the resolver runs;
 * the OAuth manager is supplied when the resolver is created. Credentials are
 * fetched separately for every generate or edit operation.
 */

import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type {
  ImageBackend,
  ImageGenerateRequest,
} from '@vybestack/llxprt-code-providers/imageBackend.js';
import { OpenAIImagesBackend } from './openaiImagesBackend.js';
import {
  isLocalImageEndpoint,
  ImageBackendBaseUrlError,
  validateCodexImageProfileBaseUrl,
} from './imageEndpoint.js';
import type { ImageProfile } from '@vybestack/llxprt-code-settings';
import type { ImageBackendAuth } from '../imageBackendAuth.js';
import { resolveCodexImageCredential } from '../image-auth-resolution.js';

import {
  CodexImageBackend,
  type CodexImageBackendDeps,
  type CodexImageCredential,
} from './codexImageBackend.js';
import { getBaseUrlFromProvider } from '../baseUrlResolver.js';
import type { IProvider } from '../IProvider.js';

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
  readonly operations?: ImageProfile['operations'];
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

export { ImageBackendBaseUrlError } from './imageEndpoint.js';

function resolveAuthContext(
  profile: ImageProfile,
  profileName: string,
): ImageBackendAuthContext {
  if (profile.backend === 'codex') {
    validateCodexImageProfileBaseUrl(profile.baseUrl, profileName);
    return 'codex';
  }

  try {
    if (isLocalImageEndpoint(profile.baseUrl)) return 'local';
  } catch (cause) {
    throw new ImageBackendBaseUrlError(profileName, profile.baseUrl, { cause });
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
    ...(profile.operations === undefined
      ? {}
      : { operations: profile.operations }),
    overrides,
  };
}

export interface CodexImageBackendResolverDeps {
  readonly getImageApiKey?: (
    auth: ImageBackendAuth,
  ) => Promise<string | undefined>;
  readonly oauthManager: OAuthManager | undefined;
  readonly getActiveProvider: () => IProvider | undefined;
  readonly getActiveImageProfile?: () => ImageProfile | undefined;
  readonly getActiveImageProfileName?: () => string | undefined;
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
 * Build a resolver that validates an active image profile and selects its
 * OpenAI Images or Codex backend. Without a profile, return the default Codex
 * backend if an OAuth manager exists, or null otherwise. Conversational
 * provider selection does not gate image capability.
 *
 * Explicit Codex profiles resolve even without OAuth machinery; attempting an
 * operation then raises an authentication error. Each Codex operation resolves
 * a fresh paired token and account id. OpenAI Images operations use only the
 * profile's credential resolver, or no credentials for local endpoints.
 */
export function createCodexImageBackendResolver(
  deps: CodexImageBackendResolverDeps,
): () => ImageBackend | null {
  return () => {
    const imageProfile = deps.getActiveImageProfile?.();
    const profileConfig =
      imageProfile === undefined
        ? undefined
        : resolveImageProfileBackendConfig(
            imageProfile,
            deps.getActiveImageProfileName?.(),
          );
    if (profileConfig?.backend === 'openai-images') {
      const getImageApiKey = deps.getImageApiKey;
      return new OpenAIImagesBackend({
        config: profileConfig,
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        ...(getImageApiKey === undefined
          ? {}
          : { getApiKey: () => getImageApiKey(profileConfig.auth) }),
      });
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

    const getCredential = (): Promise<CodexImageCredential> =>
      resolveCodexImageCredential(oauthManager);
    const backendDeps: CodexImageBackendDeps = {
      mode: profileConfig === undefined ? 'legacy' : 'profile',
      getCredential,
      getBaseUrl: () => baseUrl,
      ...(profileConfig === undefined
        ? {}
        : {
            model: profileConfig.model,
            defaults: profileConfig.overrides,
          }),
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    };

    return new CodexImageBackend(backendDeps);
  };
}
