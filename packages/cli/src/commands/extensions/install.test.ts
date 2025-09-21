/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, type MockInstance } from 'vitest';
import { handleInstall, installCommand } from './install.js';
import yargs from 'yargs';

const mockInstallExtension = vi.hoisted(() => vi.fn());

vi.mock('../../config/extension.js', () => ({
  installExtension: mockInstallExtension,
}));

describe('extensions install command', () => {
  it('should fail if no source is provided', () => {
    const validationParser = yargs([]).command(installCommand).fail(false);
    expect(() => validationParser.parse('install')).toThrow(
      'Either --source or --path must be provided.',
    );
  });

  it('should fail if both git source and local path are provided', () => {
    const validationParser = yargs([])
      .command(installCommand)
      .fail(false)
      .locale('en');
    expect(() =>
      validationParser.parse('install --source some-url --path /some/path'),
    ).toThrow('Arguments source and path are mutually exclusive');
  });
});

describe('handleInstall', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let processExitSpy: MockInstance;
  let consoleWarnSpy: MockInstance;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    mockInstallExtension.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockInstallExtension.mockReset();
  });

  it('installs an extension from an org/repo source', async () => {
    mockInstallExtension.mockResolvedValue('test-extension');

    await handleInstall({ source: 'test-org/test-repo' });

    expect(mockInstallExtension).toHaveBeenCalledWith({
      source: 'https://github.com/test-org/test-repo.git',
      type: 'git',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "test-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a http source', async () => {
    mockInstallExtension.mockResolvedValue('http-extension');

    await handleInstall({ source: 'http://google.com' });

    expect(mockInstallExtension).toHaveBeenCalledWith({
      source: 'http://google.com',
      type: 'git',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "http-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a https source', async () => {
    mockInstallExtension.mockResolvedValue('https-extension');

    await handleInstall({ source: 'https://google.com' });

    expect(mockInstallExtension).toHaveBeenCalledWith({
      source: 'https://google.com',
      type: 'git',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "https-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a git source', async () => {
    mockInstallExtension.mockResolvedValue('git-extension');

    await handleInstall({ source: 'git@some-url' });

    expect(mockInstallExtension).toHaveBeenCalledWith({
      source: 'git@some-url',
      type: 'git',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "git-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a sso source', async () => {
    mockInstallExtension.mockResolvedValue('sso-extension');

    await handleInstall({ source: 'sso://google.com' });

    expect(mockInstallExtension).toHaveBeenCalledWith({
      source: 'sso://google.com',
      type: 'git',
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sso:// URLs require a git-remote-sso helper'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "sso-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a local path', async () => {
    mockInstallExtension.mockResolvedValue('local-extension');

    await handleInstall({ path: '/some/path' });

    expect(mockInstallExtension).toHaveBeenCalledWith({
      source: '/some/path',
      type: 'local',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "local-extension" installed successfully and enabled.',
    );
  });

  it('logs an error for an unknown source scheme', async () => {
    await handleInstall({ source: 'test://google.com' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'The source "test://google.com" is not a valid URL or "org/repo" format.',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockInstallExtension).not.toHaveBeenCalled();
  });

  it('logs an error when no source or path is provided', async () => {
    await handleInstall({});

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Either --source or --path must be provided.',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockInstallExtension).not.toHaveBeenCalled();
  });

  it('logs an error when installExtension fails', async () => {
    mockInstallExtension.mockRejectedValue(new Error('Install failed'));

    await handleInstall({ source: 'git@some-url' });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Install failed');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
