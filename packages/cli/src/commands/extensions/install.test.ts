/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, type MockInstance, type Mock } from 'vitest';
import { handleInstall, installCommand } from './install.js';
import yargs from 'yargs';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import type * as extensionModule from '../../config/extension.js';
import type * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';

const mockInstallOrUpdateExtension: Mock<
  typeof extensionModule.installOrUpdateExtension
> = vi.hoisted(() => vi.fn());
const mockLoadExtensionByName: Mock<
  typeof extensionModule.loadExtensionByName
> = vi.hoisted(() => vi.fn());
const mockRequestConsentNonInteractive: Mock<
  typeof extensionModule.requestConsentNonInteractive
> = vi.hoisted(() => vi.fn());
const mockStat: Mock<typeof fs.stat> = vi.hoisted(() => vi.fn());

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
  getErrorMessage: vi.fn((error: Error) => error.message),
}));

vi.mock('node:fs/promises', () => ({
  stat: mockStat,
  default: {
    stat: mockStat,
  },
}));

describe('extensions install command', () => {
  it('should fail if no source is provided', () => {
    const validationParser = yargs([]).command(installCommand).fail(false);
    expect(() => validationParser.parse('install')).toThrow(
      'Either --source or --path must be provided.',
    );
  });
});

describe('handleInstall', () => {
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
    mockStat.mockClear();
    vi.clearAllMocks();
  });

  it('should install an extension from a http source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('http-extension');
    mockLoadExtensionByName.mockReturnValue({
      name: 'http-extension',
    } as unknown as GeminiCLIExtension);

    await handleInstall({
      source: 'http://google.com',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "http-extension" installed successfully and enabled.',
    );
  });

  it('should install an extension from a https source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('https-extension');
    mockLoadExtensionByName.mockReturnValue({
      name: 'https-extension',
    } as unknown as GeminiCLIExtension);

    await handleInstall({
      source: 'https://google.com',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "https-extension" installed successfully and enabled.',
    );
  });

  it('should install an extension from a git source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('git-extension');
    mockLoadExtensionByName.mockReturnValue({
      name: 'git-extension',
    } as unknown as GeminiCLIExtension);

    await handleInstall({
      source: 'git@some-url',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "git-extension" installed successfully and enabled.',
    );
  });

  it('throws an error from an unknown source', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    await handleInstall({
      source: 'test://google.com',
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Install source not found.');
    expect(processSpy).toHaveBeenCalledWith(1);
  });

  it('should install an extension from a sso source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('sso-extension');
    mockLoadExtensionByName.mockReturnValue({
      name: 'sso-extension',
    } as unknown as GeminiCLIExtension);

    await handleInstall({
      source: 'sso://google.com',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "sso-extension" installed successfully and enabled.',
    );
  });

  it('should install an extension from a local path', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('local-extension');
    mockLoadExtensionByName.mockReturnValue({
      name: 'local-extension',
    } as unknown as GeminiCLIExtension);
    mockStat.mockResolvedValue({} as Stats);
    await handleInstall({
      source: '/some/path',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "local-extension" installed successfully and enabled.',
    );
  });

  it('should throw an error if install extension fails', async () => {
    mockInstallOrUpdateExtension.mockRejectedValue(
      new Error('Install extension failed'),
    );

    await handleInstall({ source: 'git@some-url' });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Install extension failed');
    expect(processSpy).toHaveBeenCalledWith(1);
  });
});
