/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseBootstrapArgs,
  prepareRuntimeForProfile,
  createBootstrapResult,
} from '../profileBootstrap.js';

vi.mock('../../runtime/runtimeSettings.js', () => ({
  registerCliProviderInfrastructure: vi.fn(),
}));

type BootstrapProfileArgs = {
  profileName: string | null;
  providerOverride: string | null;
  modelOverride: string | null;
  keyOverride: string | null;
  keyfileOverride: string | null;
  baseurlOverride: string | null;
  setOverrides: string[] | null;
};

type RuntimeMetadata = {
  settingsService?: unknown;
  config?: unknown;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
};

type ParsedBootstrapArgs = {
  bootstrapArgs: BootstrapProfileArgs;
  runtimeMetadata: RuntimeMetadata;
};

type BootstrapRuntimeState = {
  runtime: RuntimeMetadata & { settingsService: unknown };
  providerManager: unknown;
  oauthManager?: unknown;
};

type ProfileApplicationResult = {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
};

const parseArgs = parseBootstrapArgs as unknown as () => ParsedBootstrapArgs;
const prepareRuntime = prepareRuntimeForProfile as unknown as (
  parsed: ParsedBootstrapArgs,
) => Promise<BootstrapRuntimeState>;
const finalizeBootstrap = createBootstrapResult as unknown as (input: {
  runtime: BootstrapRuntimeState['runtime'];
  providerManager: BootstrapRuntimeState['providerManager'];
  oauthManager?: BootstrapRuntimeState['oauthManager'];
  bootstrapArgs: BootstrapProfileArgs;
  profileApplication: ProfileApplicationResult;
}) => {
  runtime: BootstrapRuntimeState['runtime'];
  providerManager: BootstrapRuntimeState['providerManager'];
  oauthManager?: BootstrapRuntimeState['oauthManager'];
  profile: ProfileApplicationResult;
};

describe('profileBootstrap helpers', () => {
  const originalArgv = process.argv.slice();

  beforeEach(() => {
    process.argv = originalArgv.slice();
  });

  afterEach(() => {
    process.argv = originalArgv.slice();
  });

  it('parses CLI args without --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', () => {
    process.argv = ['node', 'llxprt', '--sandbox'];
    // @pseudocode bootstrap-order.md lines 1-9
    const parsed = parseArgs();
    expect(parsed.bootstrapArgs.profileName).toBeNull();
    expect(parsed.bootstrapArgs).toMatchObject({
      providerOverride: null,
      modelOverride: null,
    });
  });

  it('parses CLI args with --profile-load @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', () => {
    process.argv = ['node', 'llxprt', '--profile-load', 'synthetic'];
    // @pseudocode bootstrap-order.md lines 1-9
    const parsed = parseArgs();
    expect(parsed.bootstrapArgs.profileName).toBe('synthetic');
    expect(parsed.bootstrapArgs).toMatchObject({
      providerOverride: null,
      modelOverride: null,
    });
  });

  it('merges repeated --set arguments while preserving their order', () => {
    process.argv = [
      'node',
      'llxprt',
      '--set',
      'modelparam.temperature=1',
      '--set',
      'context-limit=190000',
      '--set=shell-replacement=true',
    ];
    const parsed = parseArgs();
    expect(parsed.bootstrapArgs.setOverrides).toEqual([
      'modelparam.temperature=1',
      'context-limit=190000',
      'shell-replacement=true',
    ]);
  });

  it('prepares runtime before applying profile state @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', async () => {
    process.argv = ['node', 'llxprt', '--profile-load', 'workspace'];
    const parsed = parseArgs();
    const runtimeState = await prepareRuntime(parsed);
    const bootstrapResult = finalizeBootstrap({
      runtime: runtimeState.runtime,
      providerManager: runtimeState.providerManager,
      oauthManager: runtimeState.oauthManager,
      bootstrapArgs: parsed.bootstrapArgs,
      profileApplication: {
        providerName: 'openai',
        modelName: 'gpt-4.1-mini',
        warnings: [],
      },
    });
    // @pseudocode bootstrap-order.md lines 1-9
    expect(bootstrapResult.runtime.metadata).toMatchObject(
      parsed.runtimeMetadata.metadata ?? {},
    );
  });

  it('includes runtime metadata in bootstrap result @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', async () => {
    const parsed: ParsedBootstrapArgs = {
      bootstrapArgs: {
        profileName: 'synthetic',
        providerOverride: null,
        modelOverride: null,
        keyOverride: null,
        keyfileOverride: null,
        baseurlOverride: null,
        setOverrides: null,
      },
      runtimeMetadata: {
        runtimeId: 'cli-runtime',
        metadata: { sessionId: 'bootstrap-session', source: 'test' },
      },
    };
    const runtimeState = await prepareRuntime(parsed);
    const bootstrapResult = finalizeBootstrap({
      runtime: runtimeState.runtime,
      providerManager: runtimeState.providerManager,
      oauthManager: runtimeState.oauthManager,
      bootstrapArgs: parsed.bootstrapArgs,
      profileApplication: {
        providerName: 'openai',
        modelName: 'gpt-4o-mini',
        baseUrl: 'https://api.example.com',
        warnings: ['profile applied after runtime ready'],
      },
    });
    // @pseudocode bootstrap-order.md lines 1-9
    expect(bootstrapResult.profile.providerName).toBe('openai');
    expect(bootstrapResult.runtime.runtimeId).toBe('cli-runtime');
    expect(bootstrapResult.runtime.metadata).toMatchObject({
      sessionId: 'bootstrap-session',
      source: 'test',
    });
  });
});
