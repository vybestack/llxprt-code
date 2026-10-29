/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { restoreEnv } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
  type Mock,
} from 'bun:test';
import { createAboutCommand } from './aboutCommand.js';
import { bindAboutDetails } from './aboutCommandHost.js';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import * as versionUtils from '../../utils/version.js';
import { MessageType } from '../types.js';

import { assertDefined } from '../../__tests__/assertions.js';

const runtimeMocks = {
  getRuntimeApiMock: vi.fn(),
};

void vi.mock('../../utils/version.js', () => ({
  getCliVersion: vi.fn(),
}));

let ideDisplayName: string | undefined;
describe('aboutCommand', () => {
  const getRuntimeApiMock = runtimeMocks.getRuntimeApiMock;
  let mockContext: CommandOwnerFixture;
  let aboutCommand: ReturnType<typeof createAboutCommand>;
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    getRuntimeApiMock.mockReturnValue({
      getRuntimeDiagnosticsSnapshot: () => ({
        providerName: null,
        modelName: null,
        profileName: null,
        modelParams: {},
        ephemeralSettings: {},
      }),
      getActiveProviderName: () => '',
      getActiveProviderDetails: () => undefined,
      getEphemeralSetting: () => undefined,
    });

    mockContext = createMockCommandContext({
      runtimeApi: getRuntimeApiMock(),
      services: {
        config: {
          getModel: vi.fn(),
        },
        settings: {
          merged: {},
        },
      },
      ui: {
        addItem: vi.fn(),
      },
    } as unknown as CommandOwnerFixture);

    (
      versionUtils.getCliVersion as Mock<typeof versionUtils.getCliVersion>
    ).mockResolvedValue('test-version');
    vi.spyOn(mockContext.services.config!, 'getModel').mockReturnValue(
      'test-model',
    );
    aboutCommand = createAboutCommand(
      bindAboutDetails(
        () => mockContext.runtimeApi.getRuntimeDiagnosticsSnapshot(),
        () => mockContext.runtimeApi.getActiveProviderName(),
        () => mockContext.runtimeApi.getActiveProviderDetails(),
        (key) => mockContext.runtimeApi.getEphemeralSetting(key),
        () => mockContext.services.config?.getModel(),
        (key) => mockContext.services.config?.getEphemeralSetting(key),
        () => mockContext.services.config?.getProvider(),
        () => ideDisplayName ?? '',
        () => mockContext.runtimeApi.providerStatus(),
        (provider) =>
          mockContext.services.settings.getProviderKeyfile(provider),
      ),
      mockContext.ui.addItem,
    );
    process.env.GOOGLE_CLOUD_PROJECT = 'test-gcp-project';
    Object.defineProperty(process, 'platform', {
      value: 'test-os',
    });
    ideDisplayName = 'test-ide';
  });

  afterEach(() => {
    restoreEnv();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
    process.env = originalEnv;
    vi.clearAllMocks();
    getRuntimeApiMock.mockReset();
  });

  it('should have the correct name and description', () => {
    expect(aboutCommand.name).toBe('about');
    expect(aboutCommand.description).toBe('show version info');
  });

  it('should call addItem with all version info', async () => {
    process.env.SANDBOX = '';
    assertDefined(aboutCommand.action);

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith({
      type: MessageType.ABOUT,
      cliVersion: 'test-version',
      osVersion: 'test-os',
      sandboxEnv: 'no sandbox',
      modelVersion: 'test-model',
      keyfile: '',
      key: '',
      ideClient: 'test-ide',
      provider: 'Unknown',
      baseURL: '',
    });
  });

  it('should show the correct sandbox environment variable', async () => {
    process.env.SANDBOX = 'gemini-sandbox';
    assertDefined(aboutCommand.action);

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxEnv: 'gemini-sandbox',
      }),
    );
  });

  it('should show sandbox-exec profile when applicable', async () => {
    process.env.SANDBOX = 'sandbox-exec';
    process.env.SEATBELT_PROFILE = 'test-profile';
    assertDefined(aboutCommand.action);

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxEnv: 'sandbox-exec (test-profile)',
      }),
    );
  });

  it('should not show ide client when it is not detected', async () => {
    ideDisplayName = undefined;

    process.env.SANDBOX = '';
    assertDefined(aboutCommand.action);

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ABOUT,
        cliVersion: 'test-version',
        osVersion: 'test-os',
        sandboxEnv: 'no sandbox',
        modelVersion: 'test-model',
        ideClient: '',
        provider: 'Unknown',
        baseURL: '',
      }),
    );
  });
});
