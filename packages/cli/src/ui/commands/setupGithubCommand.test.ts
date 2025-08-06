/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, expect, it, afterEach, beforeEach } from 'vitest';
import * as gitUtils from '../../utils/gitUtils.js';
import { setupGithubCommand } from './setupGithubCommand.js';
import {
  CommandContext,
  ToolActionReturn,
  MessageActionReturn,
} from './types.js';

vi.mock('child_process');

// Mock fetch globally
global.fetch = vi.fn();

vi.mock('../../utils/gitUtils.js', () => ({
  isGitHubRepository: vi.fn(),
  getGitRepoRoot: vi.fn(),
  getLatestGitHubRelease: vi.fn(),
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
    const fakeRepoRoot = '/github.com/fake/repo/root';
    const fakeReleaseVersion = 'v1.2.3';

    vi.mocked(gitUtils.isGitHubRepository).mockReturnValueOnce(true);
    vi.mocked(gitUtils.getGitRepoRoot).mockReturnValueOnce(fakeRepoRoot);
    vi.mocked(gitUtils.getLatestGitHubRelease).mockResolvedValueOnce(
      fakeReleaseVersion,
    );

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
