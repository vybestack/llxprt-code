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
import { handleLink } from './link.js';
import type * as extensionModule from '../../config/extension.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';

const mockInstallOrUpdateExtension: Mock<
  typeof extensionModule.installOrUpdateExtension
> = vi.hoisted(() => vi.fn());
const mockLoadExtensionByName: Mock<
  typeof extensionModule.loadExtensionByName
> = vi.hoisted(() => vi.fn());
const mockRequestConsentNonInteractive: Mock<
  typeof extensionModule.requestConsentNonInteractive
> = vi.hoisted(() => vi.fn());

vi.mock('../../config/extension.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../config/extension.js')>();
  return {
    ...actual,
    installOrUpdateExtension: mockInstallOrUpdateExtension,
    loadExtensionByName: mockLoadExtensionByName,
    requestConsentNonInteractive: mockRequestConsentNonInteractive,
  };
});

vi.mock('../../utils/errors.js', () => ({
  getErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return String(error);
  }),
}));

describe('handleLink', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let processSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockInstallOrUpdateExtension.mockClear();
    mockLoadExtensionByName.mockClear();
    mockRequestConsentNonInteractive.mockClear();
    vi.clearAllMocks();
  });

  it('should link extension successfully with extension found', async () => {
    const extensionPath = '/path/to/extension';
    const extensionName = 'test-extension';
    mockInstallOrUpdateExtension.mockResolvedValue(extensionName);
    mockLoadExtensionByName.mockReturnValue({
      name: extensionName,
    } as GeminiCLIExtension);

    await handleLink({ path: extensionPath });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      { source: extensionPath, type: 'link' },
      mockRequestConsentNonInteractive,
      process.cwd(),
    );
    expect(mockLoadExtensionByName).toHaveBeenCalledWith(
      extensionName,
      process.cwd(),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `Extension "${extensionName}" linked successfully and enabled.`,
    );
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('should link extension with fallback name when loadExtensionByName returns null', async () => {
    const extensionPath = '/path/to/extension';
    const extensionName = 'fallback-extension';
    mockInstallOrUpdateExtension.mockResolvedValue(extensionName);
    mockLoadExtensionByName.mockReturnValue(null);

    await handleLink({ path: extensionPath });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      { source: extensionPath, type: 'link' },
      mockRequestConsentNonInteractive,
      process.cwd(),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `Extension "${extensionName}" linked successfully and enabled.`,
    );
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('should link extension with fallback name when loadExtensionByName returns nullish', async () => {
    const extensionPath = '/path/to/extension';
    const extensionName = 'fallback-extension';
    mockInstallOrUpdateExtension.mockResolvedValue(extensionName);
    mockLoadExtensionByName.mockReturnValue(null);

    await handleLink({ path: extensionPath });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      `Extension "${extensionName}" linked successfully and enabled.`,
    );
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('should handle installOrUpdateExtension error', async () => {
    const extensionPath = '/path/to/extension';
    mockInstallOrUpdateExtension.mockRejectedValue(
      new Error('Installation failed'),
    );

    await handleLink({ path: extensionPath });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Installation failed');
    expect(processSpy).toHaveBeenCalledWith(1);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should handle non-Error exceptions', async () => {
    const extensionPath = '/path/to/extension';
    mockInstallOrUpdateExtension.mockRejectedValue('String error');

    await handleLink({ path: extensionPath });

    expect(consoleErrorSpy).toHaveBeenCalledWith('String error');
    expect(processSpy).toHaveBeenCalledWith(1);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should pass correct metadata type', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('test-ext');
    mockLoadExtensionByName.mockReturnValue({
      name: 'test-ext',
    } as GeminiCLIExtension);

    await handleLink({ path: '/custom/path' });

    const callArgs = mockInstallOrUpdateExtension.mock.calls[0];
    expect(callArgs[0]).toEqual({ source: '/custom/path', type: 'link' });
    expect(callArgs[1]).toBe(mockRequestConsentNonInteractive);
    expect(callArgs[2]).toBe(process.cwd());
  });
});
