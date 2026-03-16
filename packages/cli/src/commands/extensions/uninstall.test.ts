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
  type MockInstance,
} from 'vitest';
import { handleUninstall, uninstallCommand } from './uninstall.js';
import yargs from 'yargs';
import type * as extensionModule from '../../config/extension.js';

const mockUninstallExtension: Mock<typeof extensionModule.uninstallExtension> =
  vi.hoisted(() => vi.fn());

vi.mock('../../config/extension.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../config/extension.js')>();
  return {
    ...actual,
    uninstallExtension: mockUninstallExtension,
  };
});

describe('extensions uninstall command', () => {
  it('should fail if no name is provided', () => {
    const validationParser = yargs([])
      .command(uninstallCommand)
      .fail(false)
      .locale('en');
    expect(() => validationParser.parse('uninstall')).toThrow(
      'Not enough non-option arguments: got 0, need at least 1',
    );
  });
});

describe('handleUninstall', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let processExitSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockUninstallExtension.mockClear();
    vi.clearAllMocks();
  });

  it('should uninstall a single extension', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['my-ext'] });
    expect(mockUninstallExtension).toHaveBeenCalledWith('my-ext', false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "my-ext" successfully uninstalled.',
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should uninstall multiple extensions', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['ext-a', 'ext-b', 'ext-c'] });
    expect(mockUninstallExtension).toHaveBeenCalledTimes(3);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-a', false);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-b', false);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-c', false);
    expect(consoleLogSpy).toHaveBeenCalledTimes(3);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should deduplicate extension names', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['ext-a', 'ext-b', 'ext-a'] });
    expect(mockUninstallExtension).toHaveBeenCalledTimes(2);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-a', false);
    expect(mockUninstallExtension).toHaveBeenCalledWith('ext-b', false);
  });

  it('should continue after partial failure and exit with code 1', async () => {
    mockUninstallExtension
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(undefined);

    await handleUninstall({ names: ['ext-a', 'ext-b', 'ext-c'] });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "ext-a" successfully uninstalled.',
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "ext-c" successfully uninstalled.',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to uninstall "ext-b": not found',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should log all errors when every extension fails and exit with code 1', async () => {
    mockUninstallExtension
      .mockRejectedValueOnce(new Error('not found'))
      .mockRejectedValueOnce(new Error('permission denied'));

    await handleUninstall({ names: ['ext-a', 'ext-b'] });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to uninstall "ext-a": not found',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to uninstall "ext-b": permission denied',
    );
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle single-name backward compatibility', async () => {
    mockUninstallExtension.mockResolvedValue(undefined);
    await handleUninstall({ names: ['single-ext'] });
    expect(mockUninstallExtension).toHaveBeenCalledTimes(1);
    expect(mockUninstallExtension).toHaveBeenCalledWith('single-ext', false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "single-ext" successfully uninstalled.',
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should exit immediately if names array is empty after dedup', async () => {
    await handleUninstall({ names: [] as string[] });
    expect(mockUninstallExtension).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No valid extension names'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
