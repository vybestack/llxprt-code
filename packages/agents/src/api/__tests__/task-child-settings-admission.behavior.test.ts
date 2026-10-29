/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleTaskOwner } from '../agent-shell-assembly.js';
import { ChildToolDisplay } from '../../session/childToolDisplay.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import {
  type ChildParameterEndpoint,
  saveInitialChildProfiles,
  saveNextChildProfiles,
  startChildParameterEndpoint,
} from './helpers/child-parameter-http.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

/** The first launch still carries the profile it admitted (0.3 / 0.4). */
function expectInFlightChildParameters(
  child: ChildParameterEndpoint,
  primary: ChildParameterEndpoint | undefined,
): void {
  expect(child.requests().length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(child.requests()[1]?.messages)).toContain(
    '"role":"tool"',
  );
  expect(
    child
      .requests()
      .slice(0, 2)
      .map((request) => [request.temperature, request.presence_penalty]),
  ).toStrictEqual([
    [0.3, 0.4],
    [0.3, 0.4],
  ]);
  if (primary) {
    expect(primary.requests()[0]).toMatchObject({
      model: 'primary-model',
      temperature: 0.3,
      presence_penalty: 0.2,
    });
    expect(
      child
        .requests()
        .slice(0, 2)
        .map((request) => request.frequency_penalty),
    ).toStrictEqual([undefined, undefined]);
  }
}

describe('child settings admission through the session client owner', () => {
  const credentials = useOwnedCredentials();
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'child-settings-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  async function exercise(
    interactive: boolean,
    loadBalanced = false,
  ): Promise<number> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'child-settings-admission-')),
    );
    const child = await startChildParameterEndpoint(!loadBalanced, directory);
    const primary = loadBalanced
      ? await startChildParameterEndpoint(true, undefined, true)
      : undefined;
    let definitions: WorkspaceDefinitionOwner | undefined;
    let opened: Awaited<ReturnType<typeof openClientOwner>> | undefined;
    let tasks: ReturnType<typeof assembleTaskOwner> | undefined;
    let shell: ShellJobOwner | undefined;
    const abort = new AbortController();
    try {
      definitions = new WorkspaceDefinitionOwner(
        join(directory, 'profiles'),
        join(directory, 'subagents'),
      );
      const profiles = definitions.profileWrites;
      const endpoints = { childUrl: child.url, primaryUrl: primary?.url };
      await saveInitialChildProfiles(profiles, endpoints);
      await definitions.subagentWrites.saveSubagent(
        'child',
        'child',
        'Complete the goal.',
      );
      let parentSettings: SettingsService | undefined;
      const childStores: SettingsService[] = [];
      opened = await openClientOwner(
        credentials().authority,
        {
          provider: 'openai',
          model: 'parent-model',
          sessionId: randomUUID(),
          workingDir: directory,
          approvalMode: ApprovalMode.YOLO,
          folderTrust: true,
          interactive,
          coreTools: ['task', 'list_directory'],
          telemetry: { enabled: false },
          recording: { enabled: false },
          definitionOwner: definitions,
          definitionOwnership: 'caller',
          harness: { includeProcessCwd: false },
        },
        {
          provider: 'openai',
          model: 'parent-model',
          cliOverrides: { key: 'test-key', baseUrl: child.url },
        },
        {
          createSettingsOwner: (settings) => {
            parentSettings = settings;
            // The production owner, with its child-store factory wrapped on the
            // instance so the test keeps the stores it hands out.
            const owner = new SessionSettingsOwner(settings);
            const createChildStore = owner.createChildStore.bind(owner);
            owner.createChildStore = () => {
              const store = createChildStore();
              childStores.push(store);
              return store;
            };
            return owner;
          },
        },
      );
      if (parentSettings === undefined) throw new Error('No parent settings');
      const foregroundSettings = parentSettings;
      tasks = assembleTaskOwner(foregroundSettings);
      shell = new ShellJobOwner(() =>
        resolveShellJobSettings(foregroundSettings),
      );
      opened.owner.toolCatalog.bindChildExecution(
        new ChildToolDisplay(),
        tasks,
        shell,
      );
      const task = opened.client.tools.getTool('task');
      if (task === undefined) throw new Error('Missing task tool');
      const taskArguments = {
        subagent_name: 'child',
        goal_prompt: 'Complete the goal.',
        async: false,
        max_turns: 2,
      };
      const first = task.buildAndExecute(taskArguments, abort.signal);
      await Promise.race([
        primary?.received ?? child.received,
        first.then((result) => {
          throw new Error(
            `Child ended before its first HTTP request: ${JSON.stringify(result)}`,
          );
        }),
      ]);
      expect(primary?.requests() ?? child.requests()).toHaveLength(1);
      expect(childStores).toHaveLength(1);
      const [childSettings] = childStores;
      expect(childSettings).not.toBe(parentSettings);
      if (primary) {
        childSettings.set('providers.openai.frequency_penalty', 0.55);
      } else {
        childSettings.set('providers.openai.temperature', 0.6);
        childSettings.set('providers.openai.presence_penalty', 0.65);
      }
      await saveNextChildProfiles(profiles, endpoints);
      expect(childSettings.getProviderSettings('openai')).toMatchObject(
        primary
          ? { frequency_penalty: 0.55 }
          : { temperature: 0.6, presence_penalty: 0.65 },
      );
      primary?.release();
      child.release();
      await first;
      expectInFlightChildParameters(child, primary);
      await task.buildAndExecute(taskArguments, abort.signal);
      expect(childStores).toHaveLength(2);
      expect(child.requests().slice(2)[0]).toMatchObject({
        temperature: 0.7,
        presence_penalty: 0.8,
        ...(primary ? { frequency_penalty: 0.6 } : {}),
      });
      return child.requests().length;
    } finally {
      abort.abort();
      child.release();
      primary?.release();
      tasks?.closeAdmissionAndAbort();
      await Promise.allSettled([shell?.dispose(), tasks?.join()]);
      await opened?.close();
      await definitions?.dispose();
      await child.stop();
      await primary?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('keeps an interactive in-flight child goal parameters when its own settings store changes', async () => {
    expect(await exercise(true)).toBe(3);
  }, 30000);
  it('keeps a noninteractive in-flight child goal parameters when its own settings store changes', async () => {
    expect(await exercise(false)).toBe(3);
  }, 30000);
  it('keeps both load-balancer member partitions on an HTTP failover when the child settings store changes', async () => {
    expect(await exercise(false, true)).toBe(3);
  }, 30000);
});
