/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the ACP initialize response (issue #3095). Drives the REAL
 * initializeZedAgent with a typed Config stub; no mocks of the function under
 * test. The version is driven through the documented __resetVersionCacheForTesting
 * seam so each test observes the version the real getCliVersion() resolves for the
 * process under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core';
import * as acp from '@agentclientprotocol/sdk';
import {
  getCliVersion,
  __resetVersionCacheForTesting,
} from '../utils/version.js';
import { initializeZedAgent } from './zed-initialize.js';

const PROFILE_NAMES = ['default', 'stepfun-37'];

function buildConfig(profileNames: string[] = PROFILE_NAMES): Config {
  return {
    getProfileManager: () => ({
      listProfiles: async () => profileNames,
    }),
  } as unknown as Config;
}

let originalCliVersion: string | undefined;

beforeEach(() => {
  originalCliVersion = process.env.CLI_VERSION;
});

afterEach(() => {
  if (originalCliVersion === undefined) {
    delete process.env.CLI_VERSION;
  } else {
    process.env.CLI_VERSION = originalCliVersion;
  }
  __resetVersionCacheForTesting();
});

describe('initializeZedAgent', () => {
  it('identifies itself as llxprt-code over ACP', async () => {
    const response = await initializeZedAgent(buildConfig());

    expect(response.agentInfo).toEqual({
      name: 'llxprt-code',
      version: expect.any(String),
    });
  });

  it('reports the CLI version resolved by getCliVersion()', async () => {
    process.env.CLI_VERSION = '9.9.9-acp-test';
    __resetVersionCacheForTesting();
    const expected = await getCliVersion();

    const response = await initializeZedAgent(buildConfig());

    expect(response.agentInfo?.version).toBe(expected);
    expect(response.agentInfo?.version).toBe('9.9.9-acp-test');
  });

  it('keeps agentInfo present with a non-empty version when CLI_VERSION is absent', async () => {
    delete process.env.CLI_VERSION;
    __resetVersionCacheForTesting();

    const response = await initializeZedAgent(buildConfig());

    expect(response.agentInfo).toBeDefined();
    expect(response.agentInfo).not.toBeNull();
    const version = response.agentInfo?.version;
    expect(typeof version).toBe('string');
    expect(version?.length ?? 0).toBeGreaterThan(0);
  });

  it('carries version `unknown` untouched when version resolution yields `unknown`', async () => {
    process.env.CLI_VERSION = 'unknown';
    __resetVersionCacheForTesting();

    const response = await initializeZedAgent(buildConfig());

    expect(await getCliVersion()).toBe('unknown');
    expect(response.agentInfo).toEqual({
      name: 'llxprt-code',
      version: 'unknown',
    });
  });

  it('does not change protocolVersion, authMethods, or agentCapabilities', async () => {
    const response = await initializeZedAgent(buildConfig());

    expect(response.protocolVersion).toBe(acp.PROTOCOL_VERSION);
    expect(response.authMethods).toEqual(
      PROFILE_NAMES.map((name) => ({ id: name, name, description: null })),
    );
    expect(response.agentCapabilities).toEqual({
      loadSession: true,
      sessionCapabilities: {
        list: {},
        resume: {},
      },
      promptCapabilities: {
        image: true,
        audio: true,
        embeddedContext: true,
      },
    });
  });
});
