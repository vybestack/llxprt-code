/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { runCleanupSteps } from '../../../core/subagent-cleanup.js';
import type { GenerationProvider } from './generation-provider.js';

/**
 * One agent built through `createAgent` with the contributed provider, as a
 * host builds it. The agent is disposed after the scenario and the failures
 * disposal reports are returned.
 */
export async function withGenerationAgent(
  authority: CredentialAuthority,
  provider: GenerationProvider,
  run: (agent: Agent) => Promise<void>,
): Promise<readonly unknown[]> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'generation-agent-')),
  );
  const failures: unknown[] = [];
  let agent: Agent | undefined;
  try {
    agent = await createAgent({
      provider: provider.alias,
      model: 'primary-model',
      providerContributions: provider.contributions,
      workingDir: directory,
      credentialAuthority: authority,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
      harness: { includeProcessCwd: false },
    });
    await run(agent);
  } finally {
    await runCleanupSteps([
      async () => {
        try {
          await agent?.dispose();
        } catch (failure) {
          failures.push(failure);
        }
      },
      () => rm(directory, { recursive: true, force: true }),
    ]);
  }
  return failures;
}
