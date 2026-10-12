/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { logHookCall } from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
import { EVENT_HOOK_CALL } from '@vybestack/llxprt-code-telemetry/telemetry/constants.js';
import { Config } from '../config/config.js';
import { HookSystem } from './hookSystem.js';
import {
  fixtureHookDefinitions,
  fixtureHookRuntime,
} from './__tests__/hook-runtime-fixture.js';
import { HookEventName, type HookConfig } from './types.js';
import { command, fixture, rich } from './hookRunner-test-helpers.js';
import { providerRequestRows } from '../services/history/provider-request-snapshot.js';
import { HOOK_TELEMETRY_TEXT_MAX_CHARS } from './hookSnapshotTelemetry.js';

const rows = Array.from({ length: 3 }, (_, index) => ({
  ...rich,
  metadata: { ...rich.metadata, id: `row-${index}` },
}));

interface EmittedRecord {
  readonly attributes?: Record<string, unknown>;
}

function system(
  root: string,
  hooks: HookConfig[],
  telemetry: RootTelemetry,
): HookSystem {
  const config = new Config({
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
  });
  return new HookSystem(fixtureHookDefinitions(config), {
    ...fixtureHookRuntime(config),
    logCall: (event) => logHookCall(config, event, telemetry),
  });
}

describe('snapshot model hook telemetry', () => {
  let telemetry: RootTelemetry;
  let outfile: string;

  beforeEach(async () => {
    outfile = join(
      mkdtempSync(join(tmpdir(), 'hook-snapshot-telemetry-')),
      'events.jsonl',
    );
    telemetry = await RootTelemetry.create({
      sessionId: 'snapshot-hook-telemetry',
      enabled: true,
      outfile,
      maxBytes: 1048576,
      maxFiles: 2,
      readPrivacySettings: () => ({
        logPrompts: true,
        logConversations: false,
        logApiBodies: false,
        maxChars: 4000,
      }),
    });
  });

  afterEach(async () => {
    await telemetry.close();
    rmSync(dirname(outfile), { recursive: true, force: true });
  });

  function hookCalls(): Array<Record<string, unknown>> {
    if (!existsSync(outfile)) return [];
    return readFileSync(outfile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as EmittedRecord).attributes)
      .filter(
        (attributes): attributes is Record<string, unknown> =>
          attributes?.['event.name'] === EVENT_HOOK_CALL,
      );
  }

  it('emits one hook_call per BeforeModel hook with bounded stdout and row counts', async () => {
    await fixture(rows, async (snapshot, _owners, root) => {
      const hooksSystem = system(
        root,
        [
          command(
            `process.stdout.write(JSON.stringify({decision:'allow'}) + ' '.repeat(${HOOK_TELEMETRY_TEXT_MAX_CHARS * 2}));
           process.stderr.write('diagnostic');`,
          ),
        ],
        telemetry,
      );
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
      const hooksSystem = system(
        root,
        [
          command(
            `process.stdout.write(JSON.stringify({decision:'deny',reason:'no'}));`,
          ),
        ],
        telemetry,
      );
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
