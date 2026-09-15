/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  parseImageProfile,
  type ImageProfile,
} from '@vybestack/llxprt-code-settings';
import { loadProviderAliasEntries } from './providerAliases.js';
import { isLocalImageEndpoint } from '../openai/imageEndpoint.js';

export class ImageProviderAliasError extends Error {
  constructor(
    readonly aliasName: string,
    readonly availableAliases: readonly string[],
  ) {
    super(
      `Unknown image provider alias '${aliasName}'. Available aliases: ${availableAliases.join(', ')}`,
    );
    this.name = 'ImageProviderAliasError';
  }
}

/**
 * Derive a persistable image profile from provider alias configuration.
 * @param aliasName Registered provider alias name.
 * @returns Profile with provider-specific transport, authentication and model.
 * @throws ImageProviderAliasError for an unknown alias; schema error for incomplete configuration.
 */
export function buildProviderDerivedImageProfile(
  aliasName: string,
): ImageProfile {
  const aliases = loadProviderAliasEntries();
  const entry = aliases.find((candidate) => candidate.alias === aliasName);
  if (entry === undefined) {
    throw new ImageProviderAliasError(aliasName, [
      ...new Set(aliases.map((candidate) => candidate.alias)),
    ]);
  }
  const config = entry.config;
  const common = { version: 1, type: 'image' };
  if (aliasName === 'codex') {
    return parseImageProfile(aliasName, {
      ...common,
      backend: 'codex',
      model: config.imageModels?.[0],
      auth: { type: 'oauth', provider: 'codex' },
    });
  }
  const baseUrl = config['base-url'];
  const noAuth =
    config['requires-auth'] === false ||
    (baseUrl !== undefined && isLocalImageEndpoint(baseUrl));
  return parseImageProfile(aliasName, {
    ...common,
    backend: 'openai-images',
    baseUrl,
    model: config.imageModels?.[0] ?? config.defaultModel,
    auth: noAuth ? { type: 'none' } : { type: 'named-key', keyName: aliasName },
  });
}
