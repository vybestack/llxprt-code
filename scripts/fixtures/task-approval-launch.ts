/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ProfileManager } from '../../packages/settings/src/profiles/ProfileManager.js';
import { SubagentManager } from '../../packages/core/src/config/subagentManager.js';

await mkdir(resolve('tmp'), { recursive: true });
const directory = await mkdtemp(resolve('tmp/task-approval-'));
try {
  const profiles = new ProfileManager(join(directory, 'profiles'));
  await profiles.saveProfile('approval-child', {
    version: 1,
    provider: 'fake',
    model: 'fake-model',
    modelParams: {},
    ephemeralSettings: {},
  });
  const subagents = new SubagentManager(join(directory, 'subagents'), profiles);
  await subagents.saveSubagent(
    'approval-child',
    'approval-child',
    'Run the requested shell tool and return its result.',
  );
  // Each provider loads its fixture at construction. The parent's first shell
  // call replaces this private file before Task constructs the child provider.
  const responses = join(directory, 'active.responses.jsonl');
  await copyFile(
    'scripts/fixtures/task-approval-parent.responses.jsonl',
    responses,
  );
  const child = spawn(
    process.execPath,
    ['packages/cli/index.ts', '--provider', 'fake', '--model', 'fake-model'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        LLXPRT_CONFIG_HOME: directory,
        LLXPRT_FAKE_RESPONSES: responses,
      },
    },
  );
  process.exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
