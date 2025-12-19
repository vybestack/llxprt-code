/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, type MockInstance } from 'vitest';
import { handleInstall, installCommand } from './install.js';
import yargs from 'yargs';

const mockInstallOrUpdateExtension = vi.hoisted(() => vi.fn());
const mockCheckGitHubReleasesExist = vi.hoisted(() => vi.fn());
const mockParseGitHubRepoForReleases = vi.hoisted(() =>
  vi.fn().mockImplementation((source: string) => {
    const parts = source.split('/');
    return { owner: parts[0], repo: parts[1] };
  }),
);
const mockRequestConsentNonInteractive = vi.hoisted(() => vi.fn());

vi.mock('../../config/extension.js', () => ({
  installOrUpdateExtension: mockInstallOrUpdateExtension,
  requestConsentNonInteractive: mockRequestConsentNonInteractive,
}));

vi.mock('../../config/extensions/github.js', () => ({
  checkGitHubReleasesExist: mockCheckGitHubReleasesExist,
  parseGitHubRepoForReleases: mockParseGitHubRepoForReleases,
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

  it('should fail if both auto update and local path are provided', () => {
    const validationParser = yargs([]).command(installCommand).fail(false);
    expect(() =>
      validationParser.parse(
        'install some-url --path /some/path --auto-update',
      ),
    ).toThrow('Arguments path and auto-update are mutually exclusive');
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
    mockInstallOrUpdateExtension.mockReset();
    mockCheckGitHubReleasesExist.mockReset();
    // Restore the default implementation for parseGitHubRepoForReleases
    mockParseGitHubRepoForReleases.mockReset();
    mockParseGitHubRepoForReleases.mockImplementation((source: string) => {
      const parts = source.split('/');
      return { owner: parts[0], repo: parts[1] };
    });
  });

  afterEach(() => {
    mockInstallOrUpdateExtension.mockClear();
    mockRequestConsentNonInteractive.mockClear();
    vi.resetAllMocks();
  });

  it('installs an extension from org/repo using github-release when releases exist', async () => {
    mockCheckGitHubReleasesExist.mockResolvedValue(true);
    mockInstallOrUpdateExtension.mockResolvedValue('test-extension');

    await handleInstall({ source: 'test-org/test-repo' });

    expect(mockCheckGitHubReleasesExist).toHaveBeenCalledWith(
      'test-org',
      'test-repo',
    );
    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'test-org/test-repo',
        type: 'github-release',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "test-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from org/repo using git when no releases exist', async () => {
    mockCheckGitHubReleasesExist.mockResolvedValue(false);
    mockInstallOrUpdateExtension.mockResolvedValue('test-extension');

    await handleInstall({ source: 'test-org/test-repo' });

    expect(mockCheckGitHubReleasesExist).toHaveBeenCalledWith(
      'test-org',
      'test-repo',
    );
    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'https://github.com/test-org/test-repo.git',
        type: 'git',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "test-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from org/repo using git when release check fails', async () => {
    mockCheckGitHubReleasesExist.mockRejectedValue(new Error('Network error'));
    mockInstallOrUpdateExtension.mockResolvedValue('test-extension');

    await handleInstall({ source: 'test-org/test-repo' });

    expect(mockCheckGitHubReleasesExist).toHaveBeenCalledWith(
      'test-org',
      'test-repo',
    );
    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'https://github.com/test-org/test-repo.git',
        type: 'git',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "test-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from org/repo with --ref as github-release', async () => {
    mockCheckGitHubReleasesExist.mockResolvedValue(true);
    mockInstallOrUpdateExtension.mockResolvedValue('test-extension');

    await handleInstall({ source: 'test-org/test-repo', ref: 'v1.0.0' });

    expect(mockCheckGitHubReleasesExist).toHaveBeenCalledWith(
      'test-org',
      'test-repo',
    );
    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'test-org/test-repo',
        type: 'github-release',
        ref: 'v1.0.0',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "test-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from org/repo with --ref falling back to git', async () => {
    mockCheckGitHubReleasesExist.mockResolvedValue(false);
    mockInstallOrUpdateExtension.mockResolvedValue('test-extension');

    await handleInstall({ source: 'test-org/test-repo', ref: 'my-branch' });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'https://github.com/test-org/test-repo.git',
        type: 'git',
        ref: 'my-branch',
      },
      mockRequestConsentNonInteractive,
    );
  });

  it('installs an extension from a http source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('http-extension');

    await handleInstall({ source: 'http://google.com' });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'http://google.com',
        type: 'git',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "http-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a https source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('https-extension');

    await handleInstall({ source: 'https://google.com' });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'https://google.com',
        type: 'git',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "https-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a git source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('git-extension');

    await handleInstall({ source: 'git@some-url' });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'git@some-url',
        type: 'git',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "git-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a sso source', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('sso-extension');

    await handleInstall({ source: 'sso://google.com' });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: 'sso://google.com',
        type: 'git',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sso:// URLs require a git-remote-sso helper'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "sso-extension" installed successfully and enabled.',
    );
  });

  it('installs an extension from a local path', async () => {
    mockInstallOrUpdateExtension.mockResolvedValue('local-extension');

    await handleInstall({ path: '/some/path' });

    expect(mockInstallOrUpdateExtension).toHaveBeenCalledWith(
      {
        source: '/some/path',
        type: 'local',
      },
      mockRequestConsentNonInteractive,
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Extension "local-extension" installed successfully and enabled.',
    );
  });

  it('logs an error for an unknown source scheme', async () => {
    mockParseGitHubRepoForReleases.mockImplementationOnce(() => {
      throw new Error(
        'Invalid GitHub repository source: test://google.com. Expected "owner/repo" or a github repo uri.',
      );
    });

    await handleInstall({ source: 'test://google.com' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'The source "test://google.com" is not a valid URL or "org/repo" format.',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockInstallOrUpdateExtension).not.toHaveBeenCalled();
  });

  it('logs an error when no source or path is provided', async () => {
    await handleInstall({});

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Either --source or --path must be provided.',
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(mockInstallOrUpdateExtension).not.toHaveBeenCalled();
  });

  it('logs an error when installOrUpdateExtension fails', async () => {
    mockInstallOrUpdateExtension.mockRejectedValue(new Error('Install failed'));

    await handleInstall({ source: 'git@some-url' });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Install failed');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
