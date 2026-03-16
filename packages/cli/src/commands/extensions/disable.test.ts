/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { handleDisable, disableCommand } from './disable.js';
import yargs from 'yargs';
import { FatalConfigError } from '@vybestack/llxprt-code-core';
import { SettingScope } from '../../config/settings.js';
import type * as extensionModule from '../../config/extension.js';

vi.mock('../utils.js', () => ({
  exitCli: vi.fn(),
}));

const mockDisableExtension: Mock<typeof extensionModule.disableExtension> =
  vi.hoisted(() => vi.fn());

vi.mock('../../config/extension.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../config/extension.js')>();
  return {
    ...actual,
    disableExtension: mockDisableExtension,
  };
});

vi.mock('../../utils/errors.js', () => ({
  getErrorMessage: vi.fn((error: Error) => error.message),
}));

describe('extensions disable command', () => {
  it('should reject invalid scope values', () => {
    const validationParser = yargs([])
      .command(disableCommand)
      .fail(false)
      .locale('en');
    expect(() =>
      validationParser.parse('disable --scope invalid test-ext'),
    ).toThrow(/Invalid scope: invalid/);
  });

  it.each([
    { scope: 'user', expectedScope: SettingScope.User },
    { scope: 'workspace', expectedScope: SettingScope.Workspace },
  ])('should accept valid scope value: $scope', ({ scope }) => {
    const validationParser = yargs([])
      .command(disableCommand)
      .fail(false)
      .locale('en');
    expect(() =>
      validationParser.parse(`disable --scope ${scope} test-ext`),
    ).not.toThrow();
  });
});

describe('handleDisable', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mockDisableExtension.mockClear();
    vi.clearAllMocks();
  });

  it.each([
    {
      scope: undefined,
      expectedScope: SettingScope.User,
      description: 'no scope provided',
    },
    {
      scope: 'user',
      expectedScope: SettingScope.User,
      description: 'user scope',
    },
    {
      scope: 'workspace',
      expectedScope: SettingScope.Workspace,
      description: 'workspace scope',
    },
    {
      scope: 'WORKSPACE',
      expectedScope: SettingScope.Workspace,
      description: 'workspace scope (uppercase)',
    },
  ])(
    'should disable extension with $description',
    async ({ scope, expectedScope }) => {
      mockDisableExtension.mockReturnValue(undefined);

      await handleDisable({ name: 'test-ext', scope });

      expect(mockDisableExtension).toHaveBeenCalledWith(
        'test-ext',
        expectedScope,
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Extension "test-ext" successfully disabled for scope "${expectedScope}".`,
      );
    },
  );

  it('should wrap disableExtension errors in FatalConfigError', async () => {
    mockDisableExtension.mockImplementation(() => {
      throw new Error('Configuration error');
    });

    await expect(handleDisable({ name: 'test-ext' })).rejects.toThrow(
      FatalConfigError,
    );
    await expect(handleDisable({ name: 'test-ext' })).rejects.toThrow(
      'Configuration error',
    );
  });

  it('should handle non-Error exceptions', async () => {
    mockDisableExtension.mockImplementation(() => {
      // eslint-disable-next-line no-restricted-syntax
      throw 'String error';
    });

    await expect(handleDisable({ name: 'test-ext' })).rejects.toThrow(
      FatalConfigError,
    );
  });
});
