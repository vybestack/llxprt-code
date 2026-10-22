/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { HookExecutionResponse as BusHookExecutionResponse } from '@vybestack/llxprt-code-core';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import {
  Config,
  MessageBus,
  MessageBusType,
} from '@vybestack/llxprt-code-core';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { HookExecutionPhase } from '../agent.js';
import { HookControl } from '../control/hooks.js';
import { createHookControlDeps } from './helpers/fakeHookControlDeps.js';
import { physicalHookCommand } from './helpers/physicalHookCommand.js';

async function waitForMarker(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Missing marker ${path}`);
    await sleep(10);
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Hook phase did not arrive');
    await sleep(10);
  }
}

describe('HookControl execution phases', () => {
  it('delivers starts immediately, pairs overlapping completions, and removes only the observer', () => {
    const { control, messageBus, publishBusRequest, publishBusResponse } =
      createHookControlDeps();
    const phases: HookExecutionPhase[] = [];
    const peer: HookExecutionPhase[] = [];
    let completed = 0;
    const stop = control.subscribeExecutionPhase((phase) => phases.push(phase));
    const stopPeer = control.subscribeExecutionPhase((phase) =>
      peer.push(phase),
    );
    const stopPairs = control.onHookExecution(() => {
      completed++;
    });
    try {
      publishBusRequest('BeforeTool', 'A');
      publishBusRequest('BeforeTool', 'B');
      expect(
        phases.map((phase) => [phase.phase, phase.correlationId]),
      ).toStrictEqual([
        ['start', 'A'],
        ['start', 'B'],
      ]);
      expect(completed).toBe(0);
      publishBusResponse('unknown');
      expect(phases[2]).toStrictEqual({
        phase: 'end',
        correlationId: 'unknown',
      });
      publishBusResponse('B');
      expect(phases[3]).toStrictEqual({ phase: 'end', correlationId: 'B' });
      stop();
      stop();
      publishBusResponse('A');
      expect(phases).toHaveLength(4);
      expect(
        peer.map((phase) => [phase.phase, phase.correlationId]),
      ).toStrictEqual([
        ['start', 'A'],
        ['start', 'B'],
        ['end', 'unknown'],
        ['end', 'B'],
        ['end', 'A'],
      ]);
      expect(completed).toBe(2);
      expect(
        messageBus.listenerCount(MessageBusType.HOOK_EXECUTION_REQUEST),
      ).toBe(1);
      expect(
        messageBus.listenerCount(MessageBusType.HOOK_EXECUTION_RESPONSE),
      ).toBe(1);
    } finally {
      stopPeer();
      stopPairs();
      control.detach();
    }
  });

  it('delivers completion phases independently of the bounded completed-pair buffer', () => {
    const { control, publishBusRequest, publishBusResponse } =
      createHookControlDeps();
    const phases: HookExecutionPhase[] = [];
    const stop = control.subscribeExecutionPhase((phase) => phases.push(phase));
    try {
      for (let index = 0; index < 1001; index++)
        publishBusRequest('BeforeTool', String(index));
      publishBusResponse('0');
      expect(phases[phases.length - 1]).toMatchObject({
        phase: 'end',
        correlationId: '0',
      });
    } finally {
      stop();
      control.detach();
    }
  });

  it('observes held physical hooks through the original producer without cancelling work or a peer owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'llxprt-ui-hook-phases-'));
    const script = join(directory, 'held.ts');
    await writeFile(
      script,
      `import { existsSync, writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
const id = input.tool_input.id;
writeFileSync(id + '.started', input.session_id);
while (!existsSync(id + '.release')) await Bun.sleep(10);
writeFileSync(id + '.finished', 'completed');
console.log(JSON.stringify({ systemMessage: id }));
`,
    );
    const bus = new MessageBus();
    const config = new Config({
      sessionId: 'physical-phases',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      enableHooks: true,
      trustedFolder: true,
      hooks: {
        [HookEventName.BeforeTool]: [
          {
            hooks: [
              { type: HookType.Command, command: physicalHookCommand(script) },
            ],
          },
        ],
      },
    });
    const owner = new SessionHookOwner(
      readHookDefinitions(config),
      hookSessionRuntime(
        config,
        new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        }),
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'physical-phases',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      true,
      bus,
    );
    const deps: ConstructorParameters<typeof HookControl>[0] = {
      hookOperations: owner,
      observeRequests: (listener) =>
        bus.subscribe(MessageBusType.HOOK_EXECUTION_REQUEST, listener),
      observeResponses: (listener) =>
        bus.subscribe(MessageBusType.HOOK_EXECUTION_RESPONSE, listener),
      sessionId: () => config.getSessionId(),
      cwd: () => directory,
    };
    const control = new HookControl(deps);
    const peerControl = new HookControl(deps);
    const phases: HookExecutionPhase[] = [];
    const peer: HookExecutionPhase[] = [];
    const stop = control.subscribeExecutionPhase((phase) => phases.push(phase));
    const stopPeer = peerControl.subscribeExecutionPhase((phase) =>
      peer.push(phase),
    );
    const completions: string[] = [];
    const stopResponse = bus.subscribe<BusHookExecutionResponse>(
      MessageBusType.HOOK_EXECUTION_RESPONSE,
      (response) => {
        completions.push(response.payload.correlationId);
      },
    );
    try {
      await control.triggerSessionStart();
      for (const id of ['A', 'B']) {
        const payload = {
          eventName: 'BeforeTool',
          correlationId: id,
          input: { tool_name: 'read_file', tool_input: { id } },
        };
        bus.publish({ type: MessageBusType.HOOK_EXECUTION_REQUEST, payload });
      }
      expect(phases.map((phase) => phase.phase)).toStrictEqual([
        'start',
        'start',
      ]);
      await Promise.all(
        ['A', 'B'].map((id) => waitForMarker(join(directory, id + '.started'))),
      );
      expect(completions).toStrictEqual([]);
      expect(existsSync(join(directory, 'A.finished'))).toBe(false);
      await writeFile(join(directory, 'B.release'), 'release');
      await waitForMarker(join(directory, 'B.finished'));
      await waitFor(() => phases.some((phase) => phase.phase === 'end'));
      expect(
        phases
          .filter((phase) => phase.phase === 'end')
          .map((phase) => phase.correlationId),
      ).toStrictEqual(['B']);
      stop();
      control.detach();
      await writeFile(join(directory, 'A.release'), 'release');
      await waitForMarker(join(directory, 'A.finished'));
      await waitFor(
        () => peer.filter((phase) => phase.phase === 'end').length === 2,
      );
      expect(
        peer
          .filter((phase) => phase.phase === 'end')
          .map((phase) => phase.correlationId),
      ).toStrictEqual(['B', 'A']);
      expect(phases.map((phase) => phase.correlationId)).toStrictEqual([
        'A',
        'B',
        'B',
      ]);
      expect(completions).toStrictEqual(['B', 'A']);
      expect(await readFile(join(directory, 'A.finished'), 'utf8')).toBe(
        'completed',
      );
      expect(
        bus.listenerCount(MessageBusType.HOOK_EXECUTION_REQUEST),
      ).toBeGreaterThan(0);
    } finally {
      await Promise.all(
        ['A', 'B'].map((id) =>
          writeFile(join(directory, id + '.release'), 'release'),
        ),
      );
      stop();
      stopPeer();
      stopResponse();
      control.detach();
      peerControl.detach();
      await owner.dispose();
      await config.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
