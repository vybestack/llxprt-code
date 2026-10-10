/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OAuthSubmissionDependencies {
  submitCode: (provider: string, code: string) => boolean;
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

  return deps.submitCode(provider, code);
}
