/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  modelHookWorker,
  type ModelHookMode,
} from './__tests__/support/streamprocessor-model-hook-fixture.js';

const root = sourceRootSetup();
const modes: ModelHookMode[] = [
  'after-noop',
  'after-modify',
  'after-stop',
  'after-block',
  'after-error',
];

describe('AfterModel on the source route matches the eager route', () => {
  it.each(modes)(
    'gives %s the same outcome, request rows and cleanup',
    async (mode) => {
      const source = await modelHookWorker(join(root(), 'source'), mode);
      const array = await modelHookWorker(join(root(), 'array'), mode, false);
      expect(source.error).toBe(array.error);
      expect(source.errorName).toBe(array.errorName);
      expect(source.output).toBe(array.output);
      expect(source.restrictions).toStrictEqual(array.restrictions);
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(source.hooks.length).toBeGreaterThan(0);
      expect(source.hooks[0]).toMatchObject({
        input: {
          hook_event_name: 'AfterModel',
          llm_request: {
            version: 2,
            model: 'gpt-5.6',
            contents: [{ speaker: 'human' }, { speaker: 'human' }],
          },
          llm_response: { version: 2 },
        },
      });
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
  it('replaces the streamed text when the hook modifies the response', async () => {
    const source = await modelHookWorker(root(), 'after-modify');
    expect(source.error).toBeUndefined();
    expect(source.output).toContain('modified by hook');
  }, 120000);
  it.each([
    ['after-stop', 'AgentExecutionStoppedError', 'after stop'],
    ['after-block', 'AgentExecutionBlockedError', 'after block'],
  ] as const)(
    'raises the %s decision',
    async (mode, name, reason) => {
      const source = await modelHookWorker(root(), mode);
      expect(source.errorName).toBe(name);
      expect(source.error).toContain(reason);
    },
    120000,
  );
  it('keeps a failing AfterModel command non-blocking', async () => {
    const source = await modelHookWorker(root(), 'after-error');
    expect(source.error).toBeUndefined();
    expect(source.output).toBe('finished');
  }, 120000);
});

/** Drops per-run row metadata (ids, timestamps) so the two routes can be compared. */
function withoutMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMetadata);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'metadata')
      .map(([key, entry]) => [key, withoutMetadata(entry)]),
  );
}

function hookRequests(facts: Awaited<ReturnType<typeof modelHookWorker>>) {
  return facts.hooks.flatMap((record) => {
    const input = (record as { input?: Record<string, unknown> }).input;
    return input === undefined
      ? []
      : [
          {
            request: withoutMetadata(input.llm_request),
            response: withoutMetadata(input.llm_response),
          },
        ];
  });
}

describe('AfterModel with several commands and tool restrictions', () => {
  it.each(['after-partial', 'after-multi'] as const)(
    'applies the surviving outputs of %s exactly as the eager route does',
    async (mode) => {
      const source = await modelHookWorker(join(root(), 'source'), mode);
      const array = await modelHookWorker(join(root(), 'array'), mode, false);
      expect(array.error).toBeUndefined();
      expect(array.output).toContain('modified by hook');
      expect(source.error).toBe(array.error);
      expect(source.output).toBe(array.output);
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(hookRequests(source)).toStrictEqual(hookRequests(array));
      expect(source.hooks.length).toBe(array.hooks.length);
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
  it.each<[ModelHookMode, string[] | undefined]>([
    ['after-restrict', ['weather']],
    ['after-omit-tools', undefined],
  ])(
    'shows %s hooks the same tools as the eager route',
    async (mode, names) => {
      const source = await modelHookWorker(join(root(), 'source'), mode);
      const array = await modelHookWorker(join(root(), 'array'), mode, false);
      expect(source.error).toBeUndefined();
      expect(source.output).toBe(array.output);
      expect(source.restrictions).toStrictEqual(array.restrictions);
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(hookRequests(source)).toStrictEqual(hookRequests(array));
      const tools = (hookRequests(source)[0].request as { tools?: unknown[] })
        .tools as Array<{ name: string }> | undefined;
      expect(tools?.map((tool) => tool.name)).toStrictEqual(names);
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
  it('releases every owner and scratch file when the request aborts inside the hook', async () => {
    const source = await modelHookWorker(root(), 'after-cancel');
    expect(source.hooks.length).toBeGreaterThan(0);
    expect(source.error).toContain('required cancellation');
    expect(source.owners.every((owner) => owner.closed)).toBe(true);
    expect(source.activeBodies).toBe(0);
    expect(source.directories).toStrictEqual([]);
  }, 120000);
});
