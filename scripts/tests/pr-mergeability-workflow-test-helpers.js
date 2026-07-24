/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

export function runFetchHeadStepWithRealRepository(
  step,
  { expectedHeadSha } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), 'pr-review-real-head-'));
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  const workspace = path.join(root, 'workspace');
  const githubEnv = path.join(root, 'github-env');
  const githubOutput = path.join(root, 'github-output');

  try {
    mkdirSync(seed);
    runGit(root, ['init', '--bare', remote]);
    runGit(seed, ['init', '--initial-branch=main']);
    runGit(seed, ['config', 'user.name', 'Workflow Test']);
    runGit(seed, ['config', 'user.email', 'workflow-test@example.com']);
    writeFileSync(path.join(seed, 'base.txt'), 'base\n');
    runGit(seed, ['add', 'base.txt']);
    runGit(seed, ['commit', '-m', 'base']);
    const baseSha = runGit(seed, ['rev-parse', 'HEAD']);
    runGit(seed, ['remote', 'add', 'origin', remote]);
    runGit(seed, ['push', 'origin', 'main']);
    runGit(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    runGit(seed, ['checkout', '-b', 'feature-branch']);
    writeFileSync(path.join(seed, 'feature.txt'), 'feature\n');
    runGit(seed, ['add', 'feature.txt']);
    runGit(seed, ['commit', '-m', 'feature']);
    const headSha = runGit(seed, ['rev-parse', 'HEAD']);
    runGit(seed, ['push', 'origin', 'feature-branch']);
    runGit(root, ['clone', remote, workspace]);
    writeFileSync(githubEnv, '');
    writeFileSync(githubOutput, '');

    const script = step.run.replace(
      "'${{ github.event.pull_request.base.sha }}'",
      `'${baseSha}'`,
    );
    const result = spawnSync('bash', ['-c', script], {
      cwd: workspace,
      encoding: 'utf8',
      env: {
        ...process.env,
        PR_NUMBER: '42',
        REPO: 'owner/repo',
        GITHUB_TOKEN: 'test-token',
        HEAD_REF_VALUE: 'feature-branch',
        HEAD_REPO_VALUE: 'owner/repo',
        EXPECTED_HEAD_SHA: expectedHeadSha ?? headSha,
        GITHUB_ENV: githubEnv,
        GITHUB_OUTPUT: githubOutput,
      },
    });

    return {
      status: result.status,
      stderr: result.stderr,
      baseSha,
      headSha,
      fetchedHeadSha: runGit(workspace, ['rev-parse', 'refs/pr/42']),
      exportedEnvironment: readFileSync(githubEnv, 'utf8'),
      exportedOutputs: readFileSync(githubOutput, 'utf8'),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
