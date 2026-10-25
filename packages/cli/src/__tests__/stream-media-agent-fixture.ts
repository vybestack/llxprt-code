/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, afterEach, beforeAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Agent } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { openRouteAAgent } from '../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import type { StreamRuntime } from '../ui/cliUiRuntime.js';
import { createStreamRuntimeForTest } from '../ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.js';

type Release = () => Promise<void> | void;

export interface StreamMediaAgentFixture {
  readonly runtime: StreamRuntime;
  readonly agent: Agent;
  /** The caller-owned `Config`; its `projectTempDir` holds the live media store. */
  readonly config: Config;
  dispose(): Promise<void>;
}

/**
 * Agents for stream-runtime tests, built through the production `fromConfig`
 * entry point. Fixtures created with the same session id share one project
 * directory and are otherwise independent agents. Call inside `describe`.
 */
export function useStreamMediaAgentFixtures(): (
  sessionId?: string,
) => Promise<StreamMediaAgentFixture> {
  useFakeResponsesReplay('plain-text.jsonl');
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  let directory: string;
  let releases: Release[] = [];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'stream-media-fixture-'));
    process.env.LLXPRT_PROMPTS_DIR = join(directory, 'prompts');
    await initializePromptSystem();
  });
  afterEach(async () => {
    const pending = releases;
    releases = [];
    for (const release of pending.reverse()) await release();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(directory, { recursive: true, force: true });
  });
  return async (sessionId = 'same-stream-session') => {
    const route = await openRouteAAgent({
      config: { sessionId, workingDir: directory },
    });
    releases.push(route.close);
    return {
      runtime: createStreamRuntimeForTest(route.config, {
        projectTempDir: route.config.projectTempDir,
      }),
      agent: route.agent,
      config: route.config,
      dispose: () => route.agent.dispose(),
    };
  };
}
