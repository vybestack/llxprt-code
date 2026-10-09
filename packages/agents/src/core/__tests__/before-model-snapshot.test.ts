/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { readdirSync } from 'node:fs';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
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

async function runCaller(
  action: string,
  consume: (
    result: Awaited<ReturnType<typeof fireBeforeModelSnapshotHook>>,
  ) => Promise<void>,
): Promise<void> {
  const fixture = diskFixture({
    name: 'caller',
    before: [row('history'), row('pending')],
    after: [],
    pending: [row('pending')],
  });
  const cfg = config(fixture.root, action);
  const scratch = fixture.scratch();
  const eager = spyOn(HookDiskText.prototype, 'readText').mockImplementation(
    () => {
      throw new Error('Eager hook output read');
    },
  );
  try {
    const result = await fireBeforeModelSnapshotHook({
      configForHooks: cfg,
      requestContents: fixture.before,
      rawPending: fixture.rawPending,
      model: 'test',
      tools: undefined,
      log: () => {},
      root: fixture.root,
    });
    try {
      await consume(result);
    } finally {
      result.close();
    }
  } finally {
    eager.mockRestore();
    try {
      expect(fixture.active()).toBe(0);
      expect(readdirSync(fixture.root).sort()).toStrictEqual(scratch);
    } finally {
      fixture.close();
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
  it('returns owned raw pending rows without invoking a hook system', async () => {
    const fixture = diskFixture({
      name: 'disabled',
      before: [row('h'), row('p')],
      after: [],
      pending: [row('p')],
    });
    const scratch = readdirSync(fixture.root).sort();
    try {
      const result = await fireBeforeModelSnapshotHook({
        configForHooks: undefined,
        requestContents: fixture.before,
        rawPending: fixture.rawPending,
        model: 'test',
        tools: undefined,
        log: () => {},
        root: fixture.root,
      });
      try {
        expect(result.classification).toBe('unchanged');
        expect(await collectRows(result.pendingSelection)).toStrictEqual([
          row('p'),
        ]);
        expect(await collectRows(result.contents)).toStrictEqual([
          row('h'),
          row('p'),
        ]);
      } finally {
        result.close();
      }
      expect(fixture.active()).toBe(0);
      expect(fixture.scratch()).toStrictEqual(scratch);
    } finally {
      fixture.close();
    }
  });
});
