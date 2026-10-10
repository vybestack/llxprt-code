/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CredentialResolutionError } from '@vybestack/llxprt-code-auth';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createCredentialResolutionError } from '../utils/credentialResolutionError.js';
import { isAnthropicOAuthBaseURL } from './AnthropicEndpointUtils.js';

export function createAnthropicMissingCredentialError(
  options: NormalizedGenerateChatOptions,
  providerName: string,
  baseURL: string | undefined,
  oauthProvider: string | undefined,
): CredentialResolutionError {
  if (!isAnthropicOAuthBaseURL(baseURL)) {
    return createCredentialResolutionError(options, providerName, {
      kind: 'no-credential-configured',
      remediation: `No API key resolved for Anthropic-compatible endpoint "${baseURL}". Configure an explicit credential (auth-key, auth-keyfile, or auth-key-name) for this profile; OAuth against api.anthropic.com is not used for third-party base URLs.`,
    });
  }
  if (oauthProvider === 'claudecode') {
    return createCredentialResolutionError(options, providerName, {
      kind: 'no-credential-configured',
      remediation:
        'No authentication available for Anthropic API calls. Run /auth claudecode login to authenticate (or /auth claudecode logout to clear any expired session).',
    });
  }
  return createCredentialResolutionError(options, providerName, {
    kind: 'no-credential-configured',
    remediation:
      'No Anthropic API key resolved. Set an API key with /key or /keyfile (or ANTHROPIC_API_KEY) to use the Anthropic API.',
  });
}

export async function resolveAnthropicCredential(input: {
  options: NormalizedGenerateChatOptions;
  providerName: string;
  oauthProvider: string | undefined;
  oauthEligible: boolean;
  readToken: () => Promise<string | undefined> | string | undefined;
  readFallback: () => Promise<string>;
}): Promise<string> {
  const { options, providerName } = input;
  try {
    const token = await input.readToken();
    if (!token)
      throw createCredentialResolutionError(options, providerName, {
        kind: 'credential-not-found',
      });
    return token;
  } catch (cause) {
    if (!(cause instanceof CredentialResolutionError))
      throw createCredentialResolutionError(options, providerName, {
        kind: 'credential-source-failed',
        cause,
      });
    if (cause.kind === 'no-credential-configured') {
      const fallback = await input.readFallback().catch(emptyMissingCredential);
      if (fallback) return fallback;
    }
    if (input.oauthEligible && input.oauthProvider) throw cause;
    throw createAnthropicMissingCredentialError(
      { ...options, resolved: { ...options.resolved, authFailure: cause } },
      providerName,
      options.resolved.baseURL,
      input.oauthProvider,
    );
  }
}

function emptyMissingCredential(error: unknown): string {
  if (
    error instanceof CredentialResolutionError &&
    error.kind === 'no-credential-configured'
  )
    return '';
  throw error;
}
