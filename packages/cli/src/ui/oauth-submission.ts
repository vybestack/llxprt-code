/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface OAuthProviderLike {
  name: string;
}

interface OAuthProviderWithSubmit extends OAuthProviderLike {
  submitAuthCode: (code: string) => void;
}

interface OAuthManagerLike {
  getProvider: (name: string) => OAuthProviderLike | undefined;
}

function hasSubmitAuthCode(
  provider: OAuthProviderLike | undefined,
): provider is OAuthProviderWithSubmit {
  return (
    !!provider &&
    'submitAuthCode' in provider &&
    typeof (provider as OAuthProviderWithSubmit).submitAuthCode === 'function'
  );
}

export interface OAuthSubmissionDependencies {
  getOAuthManager: () => OAuthManagerLike | null;
  getActiveProvider: () => string | undefined;
}

export function submitOAuthCode(
  deps: OAuthSubmissionDependencies,
  code: string,
): boolean {
  const provider = deps.getActiveProvider();
  if (!provider) {
    return false;
  }

  const oauthManager = deps.getOAuthManager();
  if (!oauthManager) {
    return false;
  }

  const oauthProvider = oauthManager.getProvider(provider);
  if (hasSubmitAuthCode(oauthProvider)) {
    oauthProvider.submitAuthCode(code);
    return true;
  }

  return false;
}
