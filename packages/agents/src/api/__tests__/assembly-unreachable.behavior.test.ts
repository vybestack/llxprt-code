/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { PreferredAgentAssembly } from '../agentRuntimeAssembly.js';
import type { Agent } from '../agent.js';
import { drain } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

/**
 * Construction-time assemblies must not stay reachable from the live agent.
 * The preferred path is observed through a `WeakRef` to the assembly it built;
 * the adopted and preflight paths create their assemblies inside production
 * code, so they are observed by counting assembly class instances in a heap
 * snapshot.
 */
const ASSEMBLY_CLASS_NAMES = [
  'ForegroundAssembly',
  'PreferredAgentAssembly',
  'AdoptedAgentAssembly',
  'AdoptedProviderAssembly',
  'AgentActivationBootstrap',
] as const;

interface BunHeap {
  readonly gc: (force: boolean) => void;
  readonly generateHeapSnapshot: () => {
    readonly nodeClassNames: readonly string[];
  };
}

function hasFunction(value: object, name: string): boolean {
  return name in value && typeof Reflect.get(value, name) === 'function';
}

function isBunHeap(value: unknown): value is BunHeap {
  if (typeof value !== 'object' || value === null) return false;
  return hasFunction(value, 'gc') && hasFunction(value, 'generateHeapSnapshot');
}

function bunHeap(): BunHeap {
  const runtime: unknown = Reflect.get(globalThis, 'Bun');
  if (!isBunHeap(runtime))
    throw new Error('This test needs the Bun runtime heap APIs');
  return runtime;
}

async function settleGarbage(): Promise<void> {
  const { gc } = bunHeap();
  gc(true);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gc(true);
}

function countHeapInstances(classNames: readonly string[]): number {
  const snapshot = bunHeap().generateHeapSnapshot();
  return snapshot.nodeClassNames.filter((name) => classNames.includes(name))
    .length;
}

async function runTurn(agent: Agent): Promise<void> {
  await drain(agent.stream('first'));
}

describe('assembly reachability from the live agent', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();

  it('keeps a WeakRef target set while the test still references it (control)', async () => {
    const kept = { name: 'kept' };
    const ref = new WeakRef(kept);
    await settleGarbage();
    expect(ref.deref()).toBe(kept);
  });

  it('clears a WeakRef target once nothing references it (control)', async () => {
    const ref = (() => new WeakRef({ name: 'dropped' }))();
    await settleGarbage();
    expect(ref.deref()).toBeUndefined();
  });

  it('sees the live AgentImpl in a heap snapshot (control)', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'assembly-unreachable-control-')),
    );
    const assembly = new PreferredAgentAssembly(
      {
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        credentialAuthority: credentials().authority,
      },
      [],
      undefined,
    );
    const agent = await assembly.assemble();
    try {
      expect(countHeapInstances(['AgentImpl'])).toBeGreaterThanOrEqual(1);
      expect(agent.getProvider()).toBe('fake');
    } finally {
      await agent.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not keep the preferred-path assembly reachable from the agent', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'assembly-unreachable-preferred-')),
    );
    const build = async (): Promise<{
      readonly agent: Agent;
      readonly assembly: WeakRef<PreferredAgentAssembly>;
    }> => {
      const assembly = new PreferredAgentAssembly(
        {
          provider: 'fake',
          model: 'fake-model',
          workingDir: directory,
          credentialAuthority: credentials().authority,
        },
        [],
        undefined,
      );
      const ref = new WeakRef(assembly);
      return { agent: await assembly.assemble(), assembly: ref };
    };
    const { agent, assembly } = await build();
    try {
      await runTurn(agent);
      await settleGarbage();
      expect(assembly.deref() === undefined).toBe(true);
      expect(countHeapInstances(ASSEMBLY_CLASS_NAMES)).toBe(0);
      await runTurn(agent);
    } finally {
      await agent.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not keep the adopted-path assemblies reachable from the agent', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      await runTurn(built.agent);
      await settleGarbage();
      expect(countHeapInstances(ASSEMBLY_CLASS_NAMES)).toBe(0);
      await runTurn(built.agent);
    } finally {
      await built.close();
    }
  });

  it('does not keep the preflight-path assemblies reachable from the agent', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
    });
    try {
      await route.prepare();
      const agent = await route.createAgent();
      await runTurn(agent);
      await settleGarbage();
      expect(countHeapInstances(ASSEMBLY_CLASS_NAMES)).toBe(0);
      await runTurn(agent);
      await agent.dispose();
    } finally {
      await route.close();
    }
  });
});
