/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const PROVIDER = 'keyfile-fixture';

describe('preflight adoption boundaries', () => {
  const credentials = useOwnedCredentials();

  it('adopts a keyfile activation after the source keyfile is gone', async () => {
    const provider = createRecordingProvider({ alias: PROVIDER });
    const route = await openRouteBPreflight({
      authority: credentials().authority,
      contributions: provider.contributions,
      config: { provider: PROVIDER, model: 'recording-default' },
    });
    const directory = await mkdtemp(join(tmpdir(), 'preflight-owner-key-'));
    try {
      await route.prepare();
      const keyfile = join(directory, 'provider.key');
      await writeFile(keyfile, 'local-test-key');
      const activation = {
        provider: PROVIDER,
        authMode: 'auto',
        cliOverrides: { keyfile },
      } as const;
      const result = await route.preflight.preflight(activation);
      if (!result.token) throw new Error('Missing receipt');
      await rm(keyfile);
      const agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        activation,
        {},
      );
      expect(route.settings.getProviderSettings(PROVIDER)['auth-key']).toBe(
        'local-test-key',
      );
      await agent.dispose();
    } finally {
      await route.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
