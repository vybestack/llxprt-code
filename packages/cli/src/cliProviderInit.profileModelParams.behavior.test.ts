/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '@vybestack/llxprt-code-core';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { openRouteBPreflight } from '../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { useFakeResponsesReplay } from '../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { parseArguments } from './config/cliArgParser.js';
import { loadSettings } from './config/settings.js';
import { activateConfiguredProvider } from './cliProviderInit.js';
import { transferActivation } from './__tests__/startup-activation-fixture.js';

type ConfigWithModelParams = Config & {
  _profileModelParams?: Record<string, unknown>;
  _cliModelParams?: Record<string, unknown>;
};

/**
 * Profile model params are kept when `--provider` overrides the profile's
 * provider and model selection: `prepareProfileForApplication`
 * (`config/profileResolution.ts`) drops only the selection and states that
 * model params "apply regardless of provider source". The CLI's startup
 * activation must therefore write them, merged with `--set` params, into the
 * provider settings of the provider the override names.
 */
describe('activateConfiguredProvider profile model params with --provider', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  let directory: string;
  let previousArgv: string[];
  let previousConfigHome: string | undefined;

  beforeEach(async () => {
    previousArgv = process.argv;
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    directory = await mkdtemp(join(tmpdir(), 'llxprt-provider-params-'));
    process.env.LLXPRT_CONFIG_HOME = directory;
  });

  afterEach(async () => {
    process.argv = previousArgv;
    if (previousConfigHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    await rm(directory, { recursive: true, force: true });
  });

  async function activateWithArgs(args: string[]): Promise<{
    readonly authFailed: boolean;
    readonly providerSettings: Record<string, unknown>;
  }> {
    process.argv = ['bun', 'llxprt', ...args, '--prompt', 'hello'];
    const argv = await parseArguments(loadSettings(directory).merged);
    const route = await openRouteBPreflight({
      authority: new CredentialAuthority(),
    });
    try {
      await route.prepare();
      const operation = transferActivation(route.preflight);
      try {
        const config: ConfigWithModelParams = route.config;
        config._profileModelParams = { temperature: 0.4 };
        config._cliModelParams = { top_p: 0.9 };
        const activation = await activateConfiguredProvider(
          config,
          route.preflight,
          argv,
          operation,
        );
        return {
          authFailed: activation.authFailed,
          providerSettings: route.settings.getProviderSettings('fake'),
        };
      } finally {
        await operation.dispose();
      }
    } finally {
      await route.close();
    }
  }

  it('writes the profile and --set model params for the provider the --provider override names', async () => {
    const result = await activateWithArgs([
      '--provider',
      'fake',
      '--model',
      'fake-model',
    ]);

    expect(result.authFailed).toBe(false);
    expect(result.providerSettings).toMatchObject({
      model: 'fake-model',
      temperature: 0.4,
      top_p: 0.9,
    });
  });
});
