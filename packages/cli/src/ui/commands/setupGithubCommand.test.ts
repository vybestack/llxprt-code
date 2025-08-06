/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, expect, it, afterEach, beforeEach } from 'vitest';
import * as child_process from 'child_process';
import { setupGithubCommand } from './setupGithubCommand.js';
import {
  CommandContext,
  ToolActionReturn,
  MessageActionReturn,
} from './types.js';

vi.mock('child_process');

describe('setupGithubCommand', () => {
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
  it.skip('returns a tool action to download github workflows and handles paths', () => {
    const fakeRepoRoot = '/github.com/fake/repo/root';
    vi.mocked(child_process.execSync).mockReturnValue(fakeRepoRoot);

    const result = setupGithubCommand.action?.(
      {} as CommandContext,
      '',
    ) as ToolActionReturn;

    expect(result.type).toBe('tool');
    expect(result.toolName).toBe('run_shell_command');
    expect(child_process.execSync).toHaveBeenCalledWith(
      'git rev-parse --show-toplevel',
      {
        encoding: 'utf-8',
      },
    );
    expect(child_process.execSync).toHaveBeenCalledWith('git remote -v', {
      encoding: 'utf-8',
    });

    const { command } = result.toolArgs;

    // TODO: Update these expectations for llxprt workflows
    const expectedSubstrings = [
      `mkdir -p "${fakeRepoRoot}/.github/workflows"`,
      `curl -fsSL -o "${fakeRepoRoot}/.github/workflows/llxprt-cli.yml"`,
      `curl -fsSL -o "${fakeRepoRoot}/.github/workflows/llxprt-issue-automated-triage.yml"`,
      `curl -fsSL -o "${fakeRepoRoot}/.github/workflows/llxprt-issue-scheduled-triage.yml"`,
      `curl -fsSL -o "${fakeRepoRoot}/.github/workflows/llxprt-pr-review.yml"`,
      'https://raw.githubusercontent.com/vybestack/run-llxprt-code/refs/heads/main/workflows/',
    ];

    for (const substring of expectedSubstrings) {
      expect(command).toContain(substring);
    }
  });

  it.skip('throws an error if git root cannot be determined', () => {
    vi.mocked(child_process.execSync).mockReturnValue('');
    expect(() => {
      setupGithubCommand.action?.({} as CommandContext, '');
    }).toThrow(
      'Unable to determine the GitHub repository. /setup-github must be run from a git repository.',
    );
  });
});
