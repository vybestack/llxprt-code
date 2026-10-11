/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ProviderMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import {
  createProviderFileCredentialHash,
  createProviderFileWorkspaceScopeId,
  resolveProviderFilePolicy,
  type ProviderFileIdentity,
  type ProviderFilePolicy,
} from '../providerFilePolicy.js';

interface KimiMediaSupport {
  readonly fileUpload?: boolean;
  readonly videoSupport?: boolean;
}

export interface KimiProviderFileRequestPolicy {
  readonly policy: Extract<ProviderFilePolicy, { mode: 'enabled' }>;
  readonly allowFileUpload: boolean;
  readonly allowVideo: boolean;
  readonly scopeId: string;

  readonly identity: ProviderFileIdentity;
}

function workspaceScopeId(
  targetDirectory: string | undefined,
  credential: string,
): string {
  if (targetDirectory === undefined) {
    throw new Error(
      'Provider Files workspace mode requires a non-empty target directory',
    );
  }
  if (targetDirectory.trim().length === 0) {
    throw new Error(
      'Provider Files workspace mode requires a non-empty target directory',
    );
  }
  return createProviderFileWorkspaceScopeId(targetDirectory, credential);
}

function providerFileCredential(client: OpenAI): string {
  if (typeof client.apiKey !== 'string' || client.apiKey.trim().length === 0) {
    throw new Error('Provider Files requires a non-empty credential');
  }
  return client.apiKey;
}

export function resolveKimiProviderFileRequestPolicy(
  options: Pick<NormalizedGenerateChatOptions, 'invocation'>,
  providerName: string,
  mediaSupport: KimiMediaSupport | undefined,
  capabilities: ProviderMediaTransportCapabilities,
  client: OpenAI,
  workspaceDirectory?: string,
): KimiProviderFileRequestPolicy | undefined {
  const providerSettings =
    options.invocation.getProviderOverrides<Record<string, unknown>>(
      providerName,
    ) ?? {};
  const policy = resolveProviderFilePolicy({
    configuredMode:
      providerSettings['provider-files'] ??
      options.invocation.getEphemeral('provider-files'),
    configuredRetentionMs:
      providerSettings['provider-files-retention-ms'] ??
      options.invocation.getEphemeral('provider-files-retention-ms') ??
      86_400_000,
    configuredDeletion:
      providerSettings['provider-files-delete'] ??
      options.invocation.getEphemeral('provider-files-delete') ??
      'delete',
    providerFileReferences: capabilities.providerFileReferences,
    zeroDataRetention: capabilities.zeroDataRetention,
    zeroDataRetentionRequired:
      (providerSettings['provider-files-zdr'] ??
        options.invocation.getEphemeral('provider-files-zdr')) === 'require',
  });
  if (policy.mode !== 'enabled') return undefined;
  const videoSetting =
    providerSettings['kimi.experimental-video'] ??
    options.invocation.getEphemeral('kimi.experimental-video');
  const allowFileUpload = mediaSupport?.fileUpload === true;
  const allowVideo =
    mediaSupport?.videoSupport === true && videoSetting === true;
  if (!allowFileUpload && !allowVideo) return undefined;
  const credential = providerFileCredential(client);
  return {
    policy,
    allowFileUpload,
    allowVideo,
    scopeId:
      policy.scope === 'session'
        ? options.invocation.runtimeId
        : workspaceScopeId(workspaceDirectory, credential),
    identity: {
      provider: providerName,
      baseURL: client.baseURL,
      credentialHash: createProviderFileCredentialHash(credential),
    },
  };
}
