/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spyOn } from 'bun:test';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';

export function rejectCredentialTransports(): () => void {
  const keys = spyOn(
    CredentialAuthority.prototype,
    'createProviderKeyStorage',
  ).mockImplementation(() => {
    throw new Error('Credential key transport is unavailable');
  });
  const tokens = spyOn(
    CredentialAuthority.prototype,
    'createTokenStore',
  ).mockImplementation(() => {
    throw new Error('Credential token transport is unavailable');
  });
  return () => {
    tokens.mockRestore();
    keys.mockRestore();
  };
}
