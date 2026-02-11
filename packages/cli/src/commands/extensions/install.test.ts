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

  it.each([
    {
      source: 'http://google.com',
      name: 'http-extension',
      type: 'http source',
    },
    {
      source: 'https://google.com',
      name: 'https-extension',
      type: 'https source',
    },
    { source: 'git@some-url', name: 'git-extension', type: 'git source' },
    { source: 'sso://google.com', name: 'sso-extension', type: 'sso source' },
    {
      source: '/some/path',
      name: 'local-extension',
      type: 'local path',
      needsStat: true,
    },
  ])(
    'should install an extension from a $type',
    async ({ source, name, needsStat }) => {
      if (needsStat) {
        mockStat.mockResolvedValue({} as Stats);
      }
      mockInstallOrUpdateExtension.mockResolvedValue(name);
      mockLoadExtensionByName.mockReturnValue({
        name,
      } as unknown as GeminiCLIExtension);

      await handleInstall({ source });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Extension "${name}" installed successfully and enabled.`,
      );
    },
  );

  it('throws an error from an unknown source', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    await handleInstall({
      source: 'test://google.com',
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Install source not found.');
    expect(processSpy).toHaveBeenCalledWith(1);
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
