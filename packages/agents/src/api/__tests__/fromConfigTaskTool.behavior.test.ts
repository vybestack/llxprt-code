import {
  SessionToolCatalogOwner,
  type WorkspaceToolPorts,
  type SessionToolPorts,
} from '../../session/session-tool-catalog-owner.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countType, drain } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * BEHAVIORAL suite for fromConfig's task-tool reconciliation on Configs the
 * CALLER initialized before adoption (review finding on #3222):
 * ensureAgentRuntimeFactories installs the shipped task-tool registration as
 * a field default, but the registration is consumed only at tool-registry
 * construction and ensureInitialized is a no-op for an already-initialized
 * Config — so the registry the caller built stays without the task tool
 * unless adoption carries the late-installed default into the LIVE registry.
 * These tests adopt a Config the caller built via fromConfig and observe the
 * returned Agent's runtime.
 */

/** The agent runtime's projected tool-name surface. */
function agentToolNames(agent: Agent): readonly string[] {
  return agent.tools.list().map((tool) => tool.name);
}

describe('fromConfig task-tool reconcile @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
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
  const credentials = useOwnedCredentials();
  useFakeResponsesReplay('plain-text.jsonl');

  it('retains caller task registration and its executable across repeated catalog initialization', async () => {
    const initialize = SessionToolCatalogOwner.prototype.initialize;
    let fixture:
      | {
          catalog: SessionToolCatalogOwner;
          workspace: WorkspaceToolPorts;
          session: SessionToolPorts;
          registration: TaskToolRegistration;
        }
      | undefined;
    const capture = spyOn(
      SessionToolCatalogOwner.prototype,
      'initialize',
    ).mockImplementation(function (
      this: SessionToolCatalogOwner,
      workspace,
      session,
    ) {
      const callerTool = session.registration.create();
      Object.defineProperty(callerTool, 'callerIdentity', { value: {} });
      const registration: TaskToolRegistration = {
        ...session.registration,
        create: () => callerTool,
      };
      fixture = {
        catalog: this,
        workspace,
        session: { ...session, registration },
        registration,
      };
      return initialize.call(this, workspace, { ...session, registration });
    });
    let route: Awaited<ReturnType<typeof openRouteAAgent>> | undefined;
    try {
      route = await openRouteAAgent({ authority: credentials().authority });
      if (fixture === undefined)
        throw new Error('Missing caller catalog composition');
      const { catalog, workspace, session, registration } = fixture;
      const before = catalog.selection.getTool('task');
      expect(before instanceof registration.toolClass).toBe(true);
      await initialize.call(catalog, workspace, session);
      if (before === undefined) throw new Error('Missing caller task');
      const after = catalog.selection.getTool('task');
      if (after === undefined) throw new Error('Missing retained task');
      expect(Reflect.get(after, 'callerIdentity')).toBe(
        Reflect.get(before, 'callerIdentity'),
      );
      expect(Reflect.get(before, 'callerIdentity')).toBeDefined();
      expect(agentToolNames(route.agent)).toContain('task');
    } finally {
      capture.mockRestore();
      await route?.close();
    }
  });

  it('T3a a Config the caller initialized WITHOUT a task-tool registration gains the shipped task tool on adoption @requirement:REQ-3222-AC2 @scenario:caller-initialized-reconcile @given:a minimal Config with an agentClientFactory but NO taskToolRegistration, initialized by the caller so the registry is built without the task tool @when:fromConfig({ config, sessionId, messageBus }) @then:the returned Agent\'s runtime lists the shipped "task" tool and a turn still drives', async () => {
    const route = await openRouteAAgent({
      authority: credentials().authority,
      intent: { sessionId: 'issue3222-fromconfig-tasktool-reconcile' },
    });
    try {
      const agent = route.agent;
      expect(agentToolNames(agent)).toContain('task');
      expect(
        agent.tools
          .describeConfiguration()
          .registered.some((record) => record.displayName === 'task'),
      ).toBe(true);

      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await route.close();
    }
  });
});
