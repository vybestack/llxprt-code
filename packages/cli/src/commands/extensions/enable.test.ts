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
} from 'bun:test';
import { handleEnable, enableCommand } from './enable.js';
import yargs from 'yargs';
import { FatalConfigError } from '@vybestack/llxprt-code-core';
import { SettingScope } from '../../config/settings.js';

void vi.mock('../utils.js', () => ({
  exitCli: vi.fn(),
}));

const mockEnableExtension: Mock<
  (name: string, scope: SettingScope, cwd?: string) => Promise<void>
> = vi.fn();

const actual = { ...(await import('../../config/extension.js')) };
void vi.mock('../../config/extension.js', () => ({
  ...actual,
  enableExtension: mockEnableExtension,
}));

void vi.mock('../../utils/errors.js', () => ({
  getErrorMessage: vi.fn((error: Error) => error.message),
}));

describe('extensions enable command', () => {
  it('should reject invalid scope values', () => {
    const validationParser = yargs([])
      .command(enableCommand)
      .fail(false)
      .locale('en');
    expect(() =>
      validationParser.parse('enable --scope invalid test-ext'),
    ).toThrow(/Invalid scope: invalid/);
  });

  it.each([
    { scope: 'user', expectedScope: SettingScope.User },
    { scope: 'workspace', expectedScope: SettingScope.Workspace },
  ])('should accept valid scope value: $scope', ({ scope }) => {
    const validationParser = yargs([])
      .command(enableCommand)
      .fail(false)
      .locale('en');
    expect(() =>
      validationParser.parse(`enable --scope ${scope} test-ext`),
    ).not.toThrow();
  });
});

describe('handleEnable', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockEnableExtension.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockEnableExtension.mockClear();
    vi.clearAllMocks();
  });

  it('should enable extension with no scope (all scopes message)', async () => {
    await handleEnable({ name: 'test-ext' });

    expect(mockEnableExtension).toHaveBeenCalledWith(
      'test-ext',
      SettingScope.User,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "test-ext" successfully enabled in all scopes.',
    );
  });

  it.each([
    {
      scope: 'user',
      expectedScope: SettingScope.User,
      expectedMessage:
        'Extension "test-ext" successfully enabled for scope "user".',
    },
    {
      scope: 'workspace',
      expectedScope: SettingScope.Workspace,
      expectedMessage:
        'Extension "test-ext" successfully enabled for scope "workspace".',
    },
    {
      scope: 'WORKSPACE',
      expectedScope: SettingScope.Workspace,
      expectedMessage:
        'Extension "test-ext" successfully enabled for scope "WORKSPACE".',
    },
  ])(
    'should enable extension with $scope scope',
    async ({ scope, expectedScope, expectedMessage }) => {
      await handleEnable({ name: 'test-ext', scope });

      expect(mockEnableExtension).toHaveBeenCalledWith(
        'test-ext',
        expectedScope,
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expectedMessage);
    },
  );

  it('should wrap enableExtension errors in FatalConfigError', async () => {
    mockEnableExtension.mockImplementation(() => {
      throw new Error('Configuration error');
    });

    await expect(handleEnable({ name: 'test-ext' })).rejects.toThrow(
      FatalConfigError,
    );
    await expect(handleEnable({ name: 'test-ext' })).rejects.toThrow(
      'Configuration error',
    );
  });

  it('should handle non-Error exceptions', async () => {
    const nonErrorValue: unknown = 'String error';
    mockEnableExtension.mockImplementation(() => {
      throw nonErrorValue;
    });

    await expect(handleEnable({ name: 'test-ext' })).rejects.toThrow(
      FatalConfigError,
    );
  });
});
