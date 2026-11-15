/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ApprovalMode,
  createAgent,
  type Agent,
  type AgentEvent,
  type AgentHooks,
} from '@vybestack/llxprt-code-agents';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { runCleanupSteps } from '../../../core/subagent-cleanup.js';
import type { StallingProvider } from './stalling-provider.js';

export interface StallingAgentOptions {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly hooks?: AgentHooks;
}

/** A 1x1 PNG, enough for the media admission seam to accept and purge. */
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==';

/**
 * One agent built through `createAgent` over the stalling provider, with the
 * session journal recording so a semantic media purge can persist. The agent
 * is disposed, and the provider's open streams ended, after the scenario.
 */
export async function withStallingAgent(
  authority: CredentialAuthority,
  provider: StallingProvider,
  options: StallingAgentOptions,
  run: (agent: Agent, workingDir: string) => Promise<void>,
): Promise<readonly unknown[]> {
  const workingDir = await realpath(
    await mkdtemp(join(tmpdir(), 'stalling-agent-')),
  );
  const failures: unknown[] = [];
  let agent: Agent | undefined;
  try {
    agent = await createAgent({
      provider: provider.alias,
      model: 'primary-model',
      providerContributions: provider.contributions,
      workingDir,
      credentialAuthority: authority,
      approvalMode: ApprovalMode.YOLO,
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpEnabled: false,
      skillsSupport: false,
      harness: { includeProcessCwd: false },
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
    });
    for (const [key, value] of Object.entries({
      'refusal.retries': 0,
      'refusal.rewrite': false,
      'refusal.backoff-ms': 1,
      ...options.settings,
    }))
      agent.setEphemeralSetting(key, value);
    await agent.session.setRecording({ enabled: true });
    await run(agent, workingDir);
  } finally {
    provider.releaseAll();
    await runCleanupSteps([
      async () => {
        try {
          await agent?.dispose();
        } catch (failure) {
          failures.push(failure);
        }
      },
      () => rm(workingDir, { recursive: true, force: true }),
    ]);
  }
  return failures;
}

/** Everything a prompt streamed, as the host sees it. */
export async function collectStream(
  agent: Agent,
  prompt: string,
  options: {
    readonly signal?: AbortSignal;
    readonly onEvent?: (event: AgentEvent) => void | Promise<void>;
  } = {},
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.stream(
    prompt,
    options.signal === undefined ? undefined : { signal: options.signal },
  )) {
    events.push(event);
    await options.onEvent?.(event);
  }
  return events;
}

/** Fails with `label` when `work` has not settled within `ms`. */
export async function within<T>(
  ms: number,
  label: string,
  work: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not finish within ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
