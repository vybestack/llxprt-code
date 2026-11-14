/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { readdirSync } from 'node:fs';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import {
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core/utils/shell-utils.js';

import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { HookDiskText } from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { fireBeforeModelSnapshotHook } from '../beforeModelHookFire.js';
import type { BoundarySnapshotResult } from '../boundary-recovery-snapshot.js';
import {
  AgentExecutionBlockedError,
  AgentExecutionStoppedError,
} from '../chatSession.js';
import {
  collectRows,
  diskFixture,
  row,
} from './boundary-snapshot-test-helpers.js';

function config(root: string, action: string): Config {
  const script = `(async()=>{ let text=''; for await(const chunk of process.stdin) text+=chunk;
    const input=JSON.parse(text); ${action} })();`;
  return new Config({
    sessionId: 'boundary-snapshot',
    targetDir: root,
    cwd: root,
    debugMode: false,
    model: 'test',
    trustedFolder: true,
    enableHooks: true,
    hooks: {
      [HookEventName.BeforeModel]: [
        {
          hooks: [
            {
              type: HookType.Command,
              command: `exec node -e ${escapeShellArg(script, getShellConfiguration().shell)}`,
            },
          ],
        },
      ],
    },
  });
}

function hookOwner(cfg: Config): SessionHookOwner {
  return new SessionHookOwner(
    readHookDefinitions(cfg),
    hookSessionRuntime(
      cfg,
      new WorkspaceTrustLifecycle({ localTrust: cfg.initialWorkspaceTrust }),
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'boundary-snapshot',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    ),
    true,
    new MessageBus(),
  );
}

async function runCaller(
  action: string,
  consume: (result: BoundarySnapshotResult) => Promise<void>,
): Promise<void> {
  const fixture = await diskFixture({
    name: 'caller',
    before: [row('history'), row('pending')],
    after: [],
    pending: [row('pending')],
  });
  const owner = hookOwner(config(fixture.root, action));
  const scratch = fixture.scratch();
  const eager = spyOn(HookDiskText.prototype, 'readText').mockImplementation(
    () => {
      throw new Error('Eager hook output read');
    },
  );
  try {
    const result = await fireBeforeModelSnapshotHook({
      owner: owner.execution({
        sessionId: () => 'boundary-snapshot',
        transcriptPath: () => undefined,
      }),
      requestContents: fixture.before,
      rawPending: fixture.rawPending,
      model: 'test',
      tools: undefined,
      log: () => {},
      root: fixture.root,
    });
    if (result === undefined) {
      throw new Error('Expected the registered BeforeModel hook to run');
    }
    try {
      await consume(result);
    } finally {
      await result.close();
    }
  } finally {
    eager.mockRestore();
    await owner.dispose();
    try {
      expect(fixture.active()).toBe(0);
      expect(readdirSync(fixture.root).sort()).toStrictEqual(scratch);
    } finally {
      await fixture.close();
    }
  }
}

describe('snapshot BeforeModel preparation', () => {
  it('uses differential disk recovery after a real hook edits pending', async () => {
    await runCaller(
      `input.llm_request.contents[1].blocks[0].text='hook edit';
      console.log(JSON.stringify({hookSpecificOutput:{llm_request:input.llm_request}}));`,
      async (result) => {
        expect(result.classification).toBe('modified-pending');
        expect(await collectRows(result.pendingSelection)).toStrictEqual([
          row('hook edit'),
        ]);
        expect(await collectRows(result.contents)).toStrictEqual([
          row('history'),
          row('hook edit'),
        ]);
      },
    );
  });
  it('honors explicit metadata ahead of history edits', async () => {
    await runCaller(
      `input.llm_request.contents[0].blocks[0].text='rewritten history';
      console.log(JSON.stringify({hookSpecificOutput:{llm_request:input.llm_request,llm_request_boundary:{pendingMessageStartIndex:1}}}));`,
      async (result) => {
        expect(result.classification).toBe('hook-metadata');
        expect(await collectRows(result.pendingSelection)).toStrictEqual([
          row('pending'),
        ]);
        expect(await collectRows(result.contents)).toStrictEqual([
          row('rewritten history'),
          row('pending'),
        ]);
      },
    );
  });
  for (const action of [
    `console.log(JSON.stringify({hookSpecificOutput:{llm_request:{contents:[]}}}));`,
    `console.log(JSON.stringify({hookSpecificOutput:{llm_request:{model:'other'},llm_request_boundary:false}}));`,
  ]) {
    it(`preserves original projection for ${action}`, async () => {
      await runCaller(action, async (result) => {
        expect(result.classification).toBe('unchanged');
        expect(await collectRows(result.pendingSelection)).toStrictEqual([
          row('pending'),
        ]);
        expect(await collectRows(result.contents)).toStrictEqual([
          row('history'),
          row('pending'),
        ]);
      });
    });
  }
  for (const [field, error] of [
    ['continue', AgentExecutionStoppedError],
    ['decision', AgentExecutionBlockedError],
  ] as const) {
    it(`cleans disk output on ${field}`, async () => {
      const action =
        field === 'continue'
          ? `console.log(JSON.stringify({continue:false,stopReason:'stop boundary'}));`
          : `console.log(JSON.stringify({decision:'deny',reason:'block boundary'}));`;
      await expect(runCaller(action, async () => {})).rejects.toBeInstanceOf(
        error,
      );
    });
  }
});

describe('snapshot preparation without hooks', () => {
  it('returns no snapshot and copies nothing to disk without a hook owner', async () => {
    const fixture = await diskFixture({
      name: 'disabled',
      before: [row('h'), row('p')],
      after: [],
      pending: [row('p')],
    });
    const scratch = readdirSync(fixture.root).sort();
    try {
      const result = await fireBeforeModelSnapshotHook({
        owner: undefined,
        requestContents: fixture.before,
        rawPending: fixture.rawPending,
        model: 'test',
        tools: undefined,
        log: () => {},
        root: fixture.root,
      });
      expect(result).toBeUndefined();
      expect(fixture.active()).toBe(0);
      expect(fixture.scratch()).toStrictEqual(scratch);
    } finally {
      await fixture.close();
    }
  });
});
