/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';

describe('adoption validation precedes host acquisition', () => {
  let previousDescriptor: string | undefined;
  let previousSocket: string | undefined;
  beforeEach(() => {
    previousDescriptor = process.env.LLXPRT_CAPABILITY_FD;
    previousSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.env.LLXPRT_CAPABILITY_FD = 'invalid-adoption-descriptor';
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/unused-adoption-socket';
  });
  afterEach(() => {
    if (previousDescriptor === undefined)
      delete process.env.LLXPRT_CAPABILITY_FD;
    else process.env.LLXPRT_CAPABILITY_FD = previousDescriptor;
    if (previousSocket === undefined)
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    else process.env.LLXPRT_CREDENTIAL_SOCKET = previousSocket;
  });

  it.each([undefined, null, {}, { config: null }])(
    'rejects a missing Config without consuming the inherited capability %#',
    async (input) => {
      const construction: unknown = Reflect.apply(fromConfig, undefined, [
        input,
        new SettingsService(),
        {},
        new CredentialAuthority(),
      ]);
      await expect(construction).rejects.toThrow(
        'fromConfig requires an existing Config',
      );
      expect(process.env.LLXPRT_CAPABILITY_FD).toBe(
        'invalid-adoption-descriptor',
      );
    },
  );
});
