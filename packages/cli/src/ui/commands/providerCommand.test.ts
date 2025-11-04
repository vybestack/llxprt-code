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
} from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

const mocks = vi.hoisted(() => ({
  getProviderManagerMock: vi.fn(),
  refreshAliasProvidersMock: vi.fn(),
}));

vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: mocks.getProviderManagerMock,
  refreshAliasProviders: mocks.refreshAliasProvidersMock,
}));

// Import after mocks are set up
import { providerCommand } from './providerCommand.js';

describe('providerCommand /provider save', () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeAll(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-provider-save-'));
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
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
        .mockImplementation((key: string) =>
          key === 'base-url' ? baseUrl : undefined,
        ),
    };

    const context = createMockCommandContext({
      services: {
        config: configMock,
      },
    });

    if (!providerCommand.action) {
      throw new Error('providerCommand must have an action');
    }

    const result = await providerCommand.action(context, 'save myalias');

    expect(result).toEqual({
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
      baseUrl,
      defaultModel,
    });

    expect(mocks.refreshAliasProvidersMock).toHaveBeenCalledTimes(1);
  });
});

describe('providerCommand /provider switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call setModelParams on stateless providers like qwen', async () => {
    const qwenProvider = {
      name: 'qwen',
      clearState: vi.fn(),
      getDefaultModel: vi.fn(() => 'qwen/qwen-plus'),
      setModelParams: vi.fn(() => {
        throw new Error(
          'setModelParams should not be called for stateless providers',
        );
      }),
      setModel: vi.fn(),
      setBaseUrl: vi.fn(),
    };

    const providerManager = {
      getActiveProviderName: vi.fn(() => 'openai'),
      setActiveProvider: vi.fn(),
      getActiveProvider: vi.fn(() => qwenProvider),
      getActiveProviderNameOrDefault: vi.fn(() => 'openai'),
      providers: new Map<string, unknown>([['qwen', qwenProvider]]),
    };

    mocks.getProviderManagerMock.mockReturnValue(providerManager);

    const configMock = {
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
      setEphemeralSetting: vi.fn(),
      setProviderManager: vi.fn(),
      setProvider: vi.fn(),
      setModel: vi.fn(),
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getContentGeneratorConfig: vi.fn(() => ({ authType: 'mock-auth-type' })),
    };

    const context = createMockCommandContext({
      services: {
        config: configMock,
      },
    });

    if (!providerCommand.action) {
      throw new Error('providerCommand must have an action');
    }

    const result = await providerCommand.action(context, 'qwen');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('qwen'),
    });

    expect(qwenProvider.setModelParams).not.toHaveBeenCalled();
  });
});
