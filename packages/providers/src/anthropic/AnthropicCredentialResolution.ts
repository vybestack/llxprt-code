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

import type { CredentialResolutionError } from '@vybestack/llxprt-code-auth';
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
