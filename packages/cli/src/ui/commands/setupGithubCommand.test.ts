/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, expect, it, afterEach, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import * as gitUtils from '../../utils/gitUtils.js';
import {
  setupGithubCommand,
  updateGitignore,
  GITHUB_WORKFLOW_PATHS,
} from './setupGithubCommand.js';
import {
  CommandContext,
  ToolActionReturn,
  MessageActionReturn,
} from './types.js';
import * as commandUtils from '../utils/commandUtils.js';

vi.mock('child_process');

// Mock fetch globally
global.fetch = vi.fn();

vi.mock('../../utils/gitUtils.js', () => ({
  isGitHubRepository: vi.fn(),
  getGitRepoRoot: vi.fn(),
  getLatestGitHubRelease: vi.fn(),
  getGitHubRepoInfo: vi.fn(),
}));

describe('setupGithubCommand', async () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a message indicating the command is disabled', () => {
    const result = setupGithubCommand.action?.(
      {} as CommandContext,
      '',
    ) as MessageActionReturn;

    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('currently disabled');
    expect(result.content).toContain('llxprt-code');
    expect(result.content).toContain('multi-provider');
  });

  // TODO: Re-enable these tests when the command is adapted for llxprt
  it.skip('returns a tool action to download github workflows and handles paths', async () => {
    const fakeRepoOwner = 'fake';
    const fakeRepoName = 'repo';
    const fakeRepoRoot = `/github.com/${fakeRepoOwner}/${fakeRepoName}/root`;
    const fakeReleaseVersion = 'v1.2.3';

    const workflows = GITHUB_WORKFLOW_PATHS.map((p) => path.basename(p));
    for (const workflow of workflows) {
      vi.mocked(global.fetch).mockReturnValueOnce(
        Promise.resolve(new Response(workflow)),
      );
    }
    vi.mocked(gitUtils.isGitHubRepository).mockReturnValueOnce(true);
    vi.mocked(gitUtils.getGitRepoRoot).mockReturnValueOnce(fakeRepoRoot);
    vi.mocked(gitUtils.getLatestGitHubRelease).mockResolvedValueOnce(
      fakeReleaseVersion,
    );
    vi.mocked(gitUtils.getGitHubRepoInfo).mockReturnValue({
      owner: fakeRepoOwner,
      repo: fakeRepoName,
    });

    const result = (await setupGithubCommand.action?.(
      {} as CommandContext,
      '',
    )) as ToolActionReturn;

    const { command } = result.toolArgs;

    // TODO: Update these expectations for llxprt workflows
    const expectedSubstrings = [
      `set -eEuo pipefail`,
      `mkdir -p "${fakeRepoRoot}/.github/workflows"`,
      `curl --fail --location --output "/github.com/fake/repo/root/.github/workflows/llxprt-cli.yml" --show-error --silent`,
      `curl --fail --location --output "/github.com/fake/repo/root/.github/workflows/llxprt-issue-automated-triage.yml" --show-error --silent`,
      `curl --fail --location --output "/github.com/fake/repo/root/.github/workflows/llxprt-issue-scheduled-triage.yml" --show-error --silent`,
      `curl --fail --location --output "/github.com/fake/repo/root/.github/workflows/llxprt-pr-review.yml" --show-error --silent`,
      `https://raw.githubusercontent.com/acoliver/run-llxprt-code/refs/tags/`,
    ];

    for (const substring of expectedSubstrings) {
      expect(command).toContain(substring);
    }
  });

  it.skip('throws an error if git root cannot be determined', () => {
    vi.mocked(gitUtils.isGitHubRepository).mockReturnValueOnce(false);
    expect(() => {
      setupGithubCommand.action?.({} as CommandContext, '');
    }).toThrow(
      'Unable to determine the GitHub repository. /setup-github must be run from a git repository.',
    );
  });
});

describe('updateGitignore', () => {
  let scratchDir = '';

  beforeEach(async () => {
    scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'update-gitignore-'));
  });

  afterEach(async () => {
    if (scratchDir) await fs.rm(scratchDir, { recursive: true });
  });

  it('creates a new .gitignore file when none exists', async () => {
    await updateGitignore(scratchDir);

    const gitignorePath = path.join(scratchDir, '.gitignore');
    const content = await fs.readFile(gitignorePath, 'utf8');

    expect(content).toBe('.gemini/\ngha-creds-*.json\n');
  });

  it('appends entries to existing .gitignore file', async () => {
    const gitignorePath = path.join(scratchDir, '.gitignore');
    const existingContent = '# Existing content\nnode_modules/\n';
    await fs.writeFile(gitignorePath, existingContent);

    await updateGitignore(scratchDir);

    const content = await fs.readFile(gitignorePath, 'utf8');

    expect(content).toBe(
      '# Existing content\nnode_modules/\n\n.gemini/\ngha-creds-*.json\n',
    );
  });

  it('does not add duplicate entries', async () => {
    const gitignorePath = path.join(scratchDir, '.gitignore');
    const existingContent = '.gemini/\nsome-other-file\ngha-creds-*.json\n';
    await fs.writeFile(gitignorePath, existingContent);

    await updateGitignore(scratchDir);

    const content = await fs.readFile(gitignorePath, 'utf8');

    expect(content).toBe(existingContent);
  });

  it('adds only missing entries when some already exist', async () => {
    const gitignorePath = path.join(scratchDir, '.gitignore');
    const existingContent = '.gemini/\nsome-other-file\n';
    await fs.writeFile(gitignorePath, existingContent);

    await updateGitignore(scratchDir);

    const content = await fs.readFile(gitignorePath, 'utf8');

    // Should add only the missing gha-creds-*.json entry
    expect(content).toBe('.gemini/\nsome-other-file\n\ngha-creds-*.json\n');
    expect(content).toContain('gha-creds-*.json');
    // Should not duplicate .gemini/ entry
    expect((content.match(/\.gemini\//g) || []).length).toBe(1);
  });

  it('does not get confused by entries in comments or as substrings', async () => {
    const gitignorePath = path.join(scratchDir, '.gitignore');
    const existingContent = [
      '# This is a comment mentioning .gemini/ folder',
      'my-app.gemini/config',
      '# Another comment with gha-creds-*.json pattern',
      'some-other-gha-creds-file.json',
      '',
    ].join('\n');
    await fs.writeFile(gitignorePath, existingContent);

    await updateGitignore(scratchDir);

    const content = await fs.readFile(gitignorePath, 'utf8');

    // Should add both entries since they don't actually exist as gitignore rules
    expect(content).toContain('.gemini/');
    expect(content).toContain('gha-creds-*.json');

    // Verify the entries were added (not just mentioned in comments)
    const lines = content
      .split('\n')
      .map((line) => line.split('#')[0].trim())
      .filter((line) => line);
    expect(lines).toContain('.gemini/');
    expect(lines).toContain('gha-creds-*.json');
    expect(lines).toContain('my-app.gemini/config');
    expect(lines).toContain('some-other-gha-creds-file.json');
  });

  it('handles file system errors gracefully', async () => {
    // Try to update gitignore in a non-existent directory
    const nonExistentDir = path.join(scratchDir, 'non-existent');

    // This should not throw an error
    await expect(updateGitignore(nonExistentDir)).resolves.toBeUndefined();
  });

  it('handles permission errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const fsModule = await import('node:fs');
    const writeFileSpy = vi
      .spyOn(fsModule.promises, 'writeFile')
      .mockRejectedValue(new Error('Permission denied'));

    await expect(updateGitignore(scratchDir)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to update .gitignore:',
      expect.any(Error),
    );

    writeFileSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
