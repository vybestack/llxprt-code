/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { logs, type Logger } from '@opentelemetry/api-logs';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { EVENT_HOOK_CALL } from '@vybestack/llxprt-code-telemetry/telemetry/constants.js';
import { Config } from '../config/config.js';
import { HookSystem } from './hookSystem.js';
import { HookEventName, type HookConfig } from './types.js';
import { command, fixture, rich } from './hookRunner-test-helpers.js';
import { providerRequestRows } from '../services/history/provider-request-snapshot.js';
import { HOOK_TELEMETRY_TEXT_MAX_CHARS } from './hookSnapshotTelemetry.js';

const rows = Array.from({ length: 3 }, (_, index) => ({
  ...rich,
  metadata: { ...rich.metadata, id: `row-${index}` },
}));

interface EmittedRecord {
  readonly attributes: Record<string, unknown>;
}

function system(root: string, hooks: HookConfig[]): HookSystem {
  return new HookSystem(
    new Config({
      sessionId: 'snapshot-hook-telemetry',
      targetDir: root,
      cwd: root,
      debugMode: false,
      model: 'test',
      trustedFolder: true,
      enableHooks: true,
      hooks: {
        [HookEventName.BeforeModel]: [{ sequential: true, hooks }],
        [HookEventName.AfterModel]: [{ sequential: true, hooks }],
      },
    }),
  );
}

describe('snapshot model hook telemetry', () => {
  const emitted: EmittedRecord[] = [];

  beforeEach(() => {
    emitted.length = 0;
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(true);
    vi.spyOn(logs, 'getLogger').mockReturnValue({
      emit: (record: EmittedRecord) => {
        emitted.push(record);
      },
    } as unknown as Logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function hookCalls(): Array<Record<string, unknown>> {
    return emitted
      .map((record) => record.attributes)
      .filter((attributes) => attributes['event.name'] === EVENT_HOOK_CALL);
  }

  it('emits one hook_call per BeforeModel hook with bounded stdout and row counts', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const hooksSystem = system(root, [
        command(
          `process.stdout.write(JSON.stringify({decision:'allow'}) + ' '.repeat(${HOOK_TELEMETRY_TEXT_MAX_CHARS * 2}));
           process.stderr.write('diagnostic');`,
        ),
      ]);
      await hooksSystem.initialize();
      try {
        const result = await hooksSystem.fireBeforeModelSnapshotEvent({
          model: 'original',
          contents: providerRequestRows(snapshot),
        });
        result.close();
        const calls = hookCalls();
        expect(calls).toHaveLength(1);
        const call = calls[0];
        expect(call['hook_event_name']).toBe('BeforeModel');
        expect(call['success']).toBe(true);
        expect(call['exit_code']).toBe(0);
        expect(call['stderr']).toBe('diagnostic');
        const stdout = call['stdout'] as string;
        expect(stdout.startsWith('{"decision":"allow"}')).toBe(true);
        expect(stdout.endsWith('…[truncated]')).toBe(true);
        expect(JSON.parse(call['hook_output'] as string)).toStrictEqual({
          decision: 'allow',
        });
        const input = JSON.parse(call['hook_input'] as string) as {
          llm_request: Record<string, unknown>;
        };
        expect(input.llm_request['contents_row_count']).toBe(rows.length);
        expect(input.llm_request['contents']).toBeUndefined();
      } finally {
        hooksSystem.dispose();
      }
    });
  });

  it('emits hook_call for AfterModel and for a blocking decision that disposes output eagerly', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const hooksSystem = system(root, [
        command(
          `process.stdout.write(JSON.stringify({decision:'deny',reason:'no'}));`,
        ),
      ]);
      await hooksSystem.initialize();
      try {
        const result = await hooksSystem.fireAfterModelSnapshotEvent(
          { model: 'original', contents: providerRequestRows(snapshot) },
          { content: rich, finishReason: 'stop' },
        );
        result.close();
        const calls = hookCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0]['hook_event_name']).toBe('AfterModel');
        expect(JSON.parse(calls[0]['hook_output'] as string)).toStrictEqual({
          decision: 'deny',
        });
        expect(calls[0]['stdout']).toBe(
          JSON.stringify({ decision: 'deny', reason: 'no' }),
        );
      } finally {
        hooksSystem.dispose();
      }
    });
  });
});
