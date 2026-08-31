/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
} from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type {
  Agent,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
} from '@vybestack/llxprt-code-agents';
import type { Mock } from 'bun:test';

/**
 * Minimal typed Agent double for the /provider switch path. The command only
 * invokes `agent.setProvider(...)`, so a stub typed to that exact Mock surface
 * is a properly-typed test double (no `as never` / `as any`). The double is
 * cast to `Agent` via the established `as unknown as Agent` idiom at the
 * CommandContext boundary (see mockCommandContext.ts).
 */
const realProviderAliasesModule = {
  ...(await import(
    '@vybestack/llxprt-code-providers/composition/providerAliases.js'
  )),
};

interface AgentDouble {
  setProvider: Mock<
    (
      provider: string,
      model?: string,
      options?: AgentProviderSwitchOptions,
    ) => Promise<AgentProviderSwitchResult>
  >;
}

const mocks = (() => {
  const runtimeApi = {
    getActiveProviderName: vi.fn(),
    getActiveModelName: vi.fn(),
  };
  const agent: AgentDouble = {
    setProvider: vi.fn(),
  };
  return {
    getProviderManagerMock: vi.fn(),
    refreshAliasProvidersMock: vi.fn(),
    runtimeApi,
    getRuntimeApiMock: vi.fn(() => runtimeApi),
    agent,
  };
})();

// This test writes real alias files, so it opts out of the preload's
// providerAliases stub (see bun-test-setup.ts) and re-exports the genuine
// functions through the composition.js mock that providerCommand.ts imports.
void vi.mock('@vybestack/llxprt-code-providers/composition.js', () => {
  const real = realProviderAliasesModule;
  return {
    getProviderManager: mocks.getProviderManagerMock,
    refreshAliasProviders: mocks.refreshAliasProvidersMock,
    writeProviderAliasConfig: real.writeProviderAliasConfig,
    loadProviderAliasEntries: real.loadProviderAliasEntries,
    getUserAliasDir: real.getUserAliasDir,
    getAliasFilePath: real.getAliasFilePath,
  };
});

void vi.mock(
  '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js',
  () => ({
    getProviderManager: mocks.getProviderManagerMock,
    refreshAliasProviders: mocks.refreshAliasProvidersMock,
  }),
);

void vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: mocks.getRuntimeApiMock,
}));

// Import after mocks are set up
import { providerCommand } from './providerCommand.js';
import { assertDefined } from '../../test-utils/assertions.js';

function baseUrlSetting(key: string, baseUrl: string): string | undefined {
  return key === 'base-url' ? baseUrl : undefined;
}

describe('providerCommand /provider save', () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalConfigHome: string | undefined;
  let originalDataHome: string | undefined;

  beforeAll(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalConfigHome = process.env['LLXPRT_CONFIG_HOME'];
    originalDataHome = process.env['LLXPRT_DATA_HOME'];
  });

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-provider-save-'));
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    process.env['LLXPRT_CONFIG_HOME'] = path.join(tempDir, '.llxprt');
    // Alias configs are written to <dataDir>/providers; the global
    // test-storage isolation sets LLXPRT_DATA_HOME, so redirect it to this
    // test's own root for the existsSync assertion below.
    process.env['LLXPRT_DATA_HOME'] = path.join(tempDir, '.llxprt');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalConfigHome === undefined) {
      delete process.env['LLXPRT_CONFIG_HOME'];
    } else {
      process.env['LLXPRT_CONFIG_HOME'] = originalConfigHome;
    }
    if (originalDataHome === undefined) {
      delete process.env['LLXPRT_DATA_HOME'];
    } else {
      process.env['LLXPRT_DATA_HOME'] = originalDataHome;
    }
  });

  it('saves provider alias configuration and refreshes aliases', async () => {
    const baseUrl = 'https://myotherprovider.com:123/v1/';
    const defaultModel = 'my-test-model';

    const activeProvider = {
      name: 'openai',
      getDefaultModel: vi.fn(() => defaultModel),
      getCurrentModel: vi.fn(() => defaultModel),
      setBaseUrl: vi.fn(),
    };

    const providerManager = {
      getActiveProviderName: vi.fn(() => 'openai'),
      getActiveProvider: vi.fn(() => activeProvider),
      listProviders: vi.fn(() => ['openai']),
    };

    mocks.getProviderManagerMock.mockReturnValue(providerManager);
    mocks.refreshAliasProvidersMock.mockImplementation(() => {});

    const configMock = {
      getEphemeralSetting: vi
        .fn()
        .mockImplementation((key: string) => baseUrlSetting(key, baseUrl)),
    };

    const context = createMockCommandContext({
      services: {
        config: configMock,
      },
    });

    assertDefined(providerCommand.action);

    const result = await providerCommand.action(context, 'save myalias');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('myalias'),
    });

    const aliasPath = path.join(
      tempDir,
      '.llxprt',
      'providers',
      'myalias.config',
    );
    expect(fs.existsSync(aliasPath)).toBe(true);

    const aliasConfig = JSON.parse(fs.readFileSync(aliasPath, 'utf-8'));
    expect(aliasConfig).toMatchObject({
      baseProvider: 'openai',
      'base-url': baseUrl,
      defaultModel,
    });

    expect(mocks.refreshAliasProvidersMock).toHaveBeenCalledTimes(1);
  });
});

describe('providerCommand /provider switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeApiMock.mockReturnValue(mocks.runtimeApi);
    mocks.runtimeApi.getActiveProviderName.mockReturnValue('openai');
    mocks.runtimeApi.getActiveModelName.mockReturnValue('gpt-4');
    mocks.agent.setProvider.mockResolvedValue({
      changed: true,
      previousProvider: 'openai',
      nextProvider: 'qwen',
      defaultModel: 'qwen/qwen-plus',
      infoMessages: ['Use /key to set API key if needed.'],
    });
  });

  it('delegates provider switching to the agent facade and surfaces info messages', async () => {
    const providerManager = {
      getActiveProviderName: vi.fn(() => 'openai'),
    };
    mocks.getProviderManagerMock.mockReturnValue(providerManager);

    const context = createMockCommandContext({
      services: {
        agent: mocks.agent as unknown as Agent,
      },
    });

    assertDefined(providerCommand.action);

    const result = await providerCommand.action(context, 'qwen');

    expect(mocks.runtimeApi.getActiveProviderName).toHaveBeenCalledTimes(1);
    expect(mocks.agent.setProvider).toHaveBeenCalledWith(
      'qwen',
      undefined,
      expect.objectContaining({ addItem: expect.any(Function) }),
    );
    expect(context.ui.addItem).toHaveBeenCalledWith(
      {
        type: 'info',
        text: 'Use /key to set API key if needed.',
      },
      expect.any(Number),
    );
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Switched from openai to qwen',
    });
  });

  it('returns an error message when agent switching fails', async () => {
    const providerManager = {
      getActiveProviderName: vi.fn(() => 'openai'),
    };
    mocks.getProviderManagerMock.mockReturnValue(providerManager);

    const error = new Error('provider not found');
    mocks.agent.setProvider.mockRejectedValueOnce(error);

    const context = createMockCommandContext({
      services: {
        agent: mocks.agent as unknown as Agent,
      },
    });

    assertDefined(providerCommand.action);

    const result = await providerCommand.action(context, 'unknown');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'Failed to switch provider: provider not found',
    });
  });
  /**
   * @plan PLAN-20260827-ISSUE2562.P05
   * @requirement REQ-2562-4
   */
  it('formats interactive authentication state emitted during a provider switch', async () => {
    const providerManager = {
      getActiveProviderName: vi.fn(() => 'openai'),
    };
    mocks.getProviderManagerMock.mockReturnValue(providerManager);
    mocks.agent.setProvider.mockImplementation(
      async (_provider, _model, options) => {
        options?.addItem?.(
          {
            type: 'oauth_waiting',
            provider: 'codex',
            bucket: 'work',
            requesterRuntimeKind: 'subagent',
            correlationId: 'switch-auth',
            waiterCount: 1,
          },
          101,
        );
        options?.addItem?.(
          {
            type: 'oauth_settled',
            provider: 'codex',
            bucket: 'work',
            requesterRuntimeKind: 'subagent',
            correlationId: 'switch-auth',
            waiterCount: 1,
            kind: 'cancelled',
          },
          102,
        );
        return {
          changed: true,
          previousProvider: 'openai',
          nextProvider: 'qwen',
          defaultModel: 'qwen/qwen-plus',
          infoMessages: [],
        };
      },
    );
    const context = createMockCommandContext({
      services: {
        agent: mocks.agent as unknown as Agent,
      },
    });
    assertDefined(providerCommand.action);

    await providerCommand.action(context, 'qwen');

    expect(context.ui.addItem).toHaveBeenNthCalledWith(
      1,
      {
        type: 'info',
        text: 'Waiting for codex/work authentication (requested by subagent)…',
      },
      101,
    );
    expect(context.ui.addItem).toHaveBeenNthCalledWith(
      2,
      {
        type: 'info',
        text: 'Authentication for codex/work was cancelled',
      },
      102,
    );
  });

  it('rejects reserved sentinel alias name "unconfigured" (#2481)', async () => {
    const context = createMockCommandContext({
      services: {
        config: { getEphemeralSetting: vi.fn(() => undefined) },
      },
    });

    assertDefined(providerCommand.action);

    const result = await providerCommand.action(context, 'save unconfigured');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('reserved name'),
    });
  });
});
