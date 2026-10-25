import { fixtureAgentResources } from '../../api/__tests__/helpers/agent-resource-capture.js';
import { SubAgentScope } from '../subagent.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolRegistry,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { CoreToolRegistryHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolRegistryHostAdapter.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import {
  ContextState,
  SubagentTerminateMode,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import {
  gate,
  withDisposalJoinFixture,
} from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from '../../api/__tests__/helpers/owned-credential-fixture.js';
import { createTestChildOrchestrator } from './child-launch-fixture.js';

const parentSignal = new AbortController().signal;

class HeldChildTool extends BaseDeclarativeTool<{ text: string }, ToolResult> {
  constructor(
    private readonly run: (
      text: string,
      signal: AbortSignal,
    ) => Promise<string>,
  ) {
    super(
      'child_transform',
      'Child transform',
      'Transform child input',
      Kind.Read,
      {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    );
  }

  protected override createInvocation(params: {
    text: string;
  }): BaseToolInvocation<{ text: string }, ToolResult> {
    const run = this.run;
    return new (class extends BaseToolInvocation<{ text: string }, ToolResult> {
      override getDescription(): string {
        return 'Transform child input';
      }
      override async execute(signal: AbortSignal): Promise<ToolResult> {
        const value = await run(this.params.text, signal);
        return { llmContent: value, returnDisplay: value };
      }
    })(params, this.messageBus, this.name);
  }
}

function modelResponse(text: string, call?: string): Response {
  const delta =
    call === undefined
      ? { content: text }
      : {
          tool_calls: [
            {
              index: 0,
              id: `transform-${text}`,
              type: 'function',
              function: {
                name: 'child_transform',
                arguments: JSON.stringify({ text: call }),
              },
            },
          ],
        };
  return new Response(
    [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      {
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: call === undefined ? 'stop' : 'tool_calls',
          },
        ],
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('child task tool lifetime', () => {
  const credentials = useOwnedCredentials();

  it('joins a cancelled held tool before releasing child resources while its same-label sibling completes real tool work', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const entered = gate();
      const released = gate();
      let heldSignal: AbortSignal | undefined;
      let toolSettled = false;
      const effects: string[] = [];
      const bus = fixtureAgentResources(fixture.agent).messageBus;
      const registry = new ToolRegistry(
        new CoreToolRegistryHostAdapter(fixture.config),
        new CoreMessageBusAdapter(bus),
        () => fixture.settingsOwner.readRegistryPolicy([]),
      );
      registry.registerTool(
        new HeldChildTool(async (text, signal) => {
          if (text === 'first') {
            heldSignal = signal;
            entered.release();
            await released.promise;
            toolSettled = true;
            signal.throwIfAborted();
          }
          effects.push(text.toUpperCase());
          return text.toUpperCase();
        }),
      );
      const orchestrator = createTestChildOrchestrator({
        credentialAuthority: credentials().authority,
        workspaceTrust: fixture.workspaceTrust,
        createChildSettings: () => fixture.settingsOwner.createChildStore(),
        readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
        toolRegistry: registry,
        workspacePaths: fixture.workspacePaths,
        instructions: fixture.instructionReads,
        foregroundConfig: fixture.config,
        subagentManager: fixture.agent.workspace.subagentDefinitions,
        profileManager: fixture.agent.workspace.profileDefinitions,
        messageBus: bus,
        readMcpInstructions: fixture.readMcpInstructions,
      });
      let requests = 0;
      const requestBodies: string[] = [];
      const clearScript = fixture.scriptChildRequests(async (request) => {
        requestBodies.push(request.body);
        requests += 1;
        if (requests === 1) return modelResponse('first', 'first');
        if (requests === 2) return modelResponse('sibling', 'sibling');
        return modelResponse('sibling completed');
      });
      const first = await orchestrator.launch(
        { name: 'disposal-child' },
        parentSignal,
      );
      const sibling = await orchestrator.launch(
        { name: 'disposal-child' },
        parentSignal,
      );
      const running = first.scope.runNonInteractive(new ContextState());
      const settled = running.catch(() => undefined);
      try {
        await entered.promise;
        await expect(
          first.scope.runNonInteractive(new ContextState()),
        ).rejects.toThrow('Subagent scope is already running');
        let closed = false;
        const closing = first.dispose().then(() => {
          closed = true;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(heldSignal?.aborted).toBe(true);
        expect(toolSettled).toBe(false);
        expect(closed).toBe(false);
        expect(credentials().keySnapshot()).toStrictEqual([0, 0]);
        await sibling.scope.runNonInteractive(new ContextState());
        expect(sibling.scope.output.terminate_reason).toBe(
          SubagentTerminateMode.GOAL,
        );
        expect(effects).toStrictEqual(['SIBLING']);
        expect(requestBodies[requestBodies.length - 1]).toContain('SIBLING');
        expect(closed).toBe(false);
        released.release();
        await settled;
        await closing;
        expect(toolSettled).toBe(true);
        expect(credentials().keySnapshot()).toStrictEqual([1, 0]);
        expect(fixture.settingsOwner.readSelectedModel()).toBe('parent-model');
        expect(fixture.agent.tools.list().map((tool) => tool.name)).toContain(
          'task',
        );
      } finally {
        released.release();
        await settled;
        await first.dispose();
        await sibling.dispose();
        clearScript();
      }
      expect(credentials().keySnapshot()).toStrictEqual([1, 1]);
    });
  }, 30000);
  it('joins cancellation during child preparation without starting a model after disposal', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const entered = gate();
      const prepared = gate();
      const orchestrator = createTestChildOrchestrator({
        credentialAuthority: credentials().authority,
        workspaceTrust: fixture.workspaceTrust,
        createChildSettings: () => fixture.settingsOwner.createChildStore(),
        readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
        toolRegistry: fixture.client.tools,
        workspacePaths: fixture.workspacePaths,
        instructions: fixture.instructionReads,
        foregroundConfig: fixture.config,
        subagentManager: fixture.agent.workspace.subagentDefinitions,
        profileManager: fixture.agent.workspace.profileDefinitions,
        messageBus: fixtureAgentResources(fixture.agent).messageBus,
        readMcpInstructions: fixture.readMcpInstructions,
        scopeFactory: (launch, runtime, operations) =>
          SubAgentScope.create(launch, runtime, {
            ...operations,
            loadEnvironmentContext: async () => {
              entered.release();
              await prepared.promise;
              return [];
            },
          }),
      });
      const child = await orchestrator.launch(
        { name: 'disposal-child' },
        parentSignal,
      );
      const running = child.scope.runNonInteractive(new ContextState());
      const settled = running.catch(() => undefined);
      let closed = false;
      try {
        await entered.promise;
        const closing = child.dispose().then(() => {
          closed = true;
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(closed).toBe(false);
        expect(credentials().keySnapshot()).toStrictEqual([0]);
        prepared.release();
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(fixture.signal()).toBeUndefined();
        await settled;
        await closing;
        expect(credentials().keySnapshot()).toStrictEqual([1]);
        expect(fixture.settingsOwner.readSelectedModel()).toBe('parent-model');
      } finally {
        prepared.release();
        fixture.releaseWork();
        await settled;
        await child.dispose();
      }
    });
  }, 30000);
});
