/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { fromConfig } from '../fromConfig.js';
import { prepareAgentPreflight } from '../profile-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('isolated runtime construction requirements', () => {
  const credentials = useOwnedCredentials();

  it('rejects a missing caller Config before building runtime collaborators', async () => {
    await expect(
      Reflect.apply(fromConfig, undefined, [
        { credentialAuthority: credentials().authority },
        new SettingsService(),
        {},
        credentials().authority,
      ]),
    ).rejects.toThrow(/existing Config/);
  });

  it('rejects missing credential authority while another preflight is live', async () => {
    const owner = await prepareAgentPreflight(
      { runtimeId: 'binding-owner' },
      credentials().authority,
    );
    try {
      await expect(
        Reflect.apply(prepareAgentPreflight, undefined, [
          { runtimeId: 'missing-authority' },
        ]),
      ).rejects.toThrow(/requires CredentialAuthority/);
    } finally {
      await owner.dispose();
    }
  });
});
