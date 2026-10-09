/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  modelHookWorker,
  type ModelHookMode,
} from './__tests__/support/streamprocessor-model-hook-fixture.js';

const root = sourceRootSetup();
const supported: ModelHookMode[] = [
  'noop',
  'edit',
  'replace',
  'boundary',
  'ambiguous',
  'none',
  'restrict',
];
describe('actual BeforeModel disk hook', () => {
  it.each(supported)(
    'sends exact %s replacement and complete array estimate',
    async (mode) => {
      const source = await modelHookWorker(join(root(), 'source'), mode);
      const array = await modelHookWorker(join(root(), 'array'), mode, false);
      expect(source.error).toBeUndefined();
      expect(array.error).toBeUndefined();
      expect(source.hooks[0]).toMatchObject({
        input: {
          hook_event_name: 'BeforeModel',
          llm_request: {
            version: 2,
            model: 'gpt-5.6',
            contents: [{ speaker: 'human' }, { speaker: 'human' }],
          },
        },
      });
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(source.estimate).toStrictEqual(source.oracle);
      expect(source.estimate).toStrictEqual(array.estimate);
      expect(source.restrictions).toStrictEqual(array.restrictions);
      expect(source.output).toBe('finished');
      expect(source.firstLive).toBe(0);
      expect(source.lastLive).toBe(0);
      expect(source.boundary).toMatchObject({ first: 0, last: 0, closed: 1 });
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
  it('rejects deliberately empty replacement because eager transport does not apply it', async () => {
    const source = await modelHookWorker(root(), 'empty');
    expect(source.error).toContain(
      'empty contents replacement conflicts with eager request semantics',
    );
    expect(source.bodies).toStrictEqual([]);
    expect(source.estimate).toBeNull();
    expect(source.owners.every((owner) => owner.closed)).toBe(true);
    expect(source.activeBodies).toBe(0);
    expect(source.directories).toStrictEqual([]);
  }, 120000);
  it.each([
    ['edit', 'modified-pending', true],
    ['boundary', 'hook-metadata', true],
    ['ambiguous', 'complex', false],
    ['none', 'replaced-all', false],
  ] as const)(
    'reports pending recovery for %s',
    async (mode, classification, recovered) => {
      const source = await modelHookWorker(root(), mode);
      expect(source.error).toBeUndefined();
      expect(source.logs).toContain(
        `[BeforeModelSnapshot] Pending boundary classification=${classification} recovered=${recovered}`,
      );
    },
    120000,
  );
});

const rejected: ModelHookMode[] = [
  'stop',
  'block',
  'malformed',
  'bad-row',
  'bad-contents',
  'bad-specific',
  'bad-continue',
  'bad-decision',
  'bad-reason',
  'model',
  'settings',
  'tools',
  'unknown',
  'error',
  'cancel',
  'denied-tool',
];
describe('BeforeModel source enforcement', () => {
  it.each(rejected)(
    'rejects genuine %s without HTTP or owned scratch',
    async (mode) => {
      const source = await modelHookWorker(root(), mode);
      expect(source.hooks.length).toBeGreaterThan(0);
      expect(source.error).toBeDefined();
      expect(source.bodies).toStrictEqual([]);
      expect(source.estimate).toBeNull();
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
  it.each([
    ['stop', 'AgentExecutionStoppedError'],
    ['block', 'AgentExecutionBlockedError'],
  ] as const)(
    'preserves %s error identity',
    async (mode, name) => {
      const source = await modelHookWorker(root(), mode);
      expect(source.errorName).toBe(name);
      expect(source.error).toContain(`required ${mode}`);
    },
    120000,
  );
  it('retains the measured command exit failure in the source error', async () => {
    const source = await modelHookWorker(root(), 'error');
    expect(source.error).toContain('exited with code 1');
    expect(source.bodies).toStrictEqual([]);
  }, 120000);
  it('executes the genuine hook on each HTTP retry without byte or prompt identity drift', async () => {
    const source = await modelHookWorker(root(), 'retry');
    expect(source.error).toBeUndefined();
    expect(source.bodies).toHaveLength(2);
    expect(source.bodies[0]).toStrictEqual(source.bodies[1]);
    expect(source.hooks).toHaveLength(4);
    expect(source.requests).toMatchObject([
      { promptId: 'actual-model-worker' },
      { promptId: 'actual-model-worker' },
    ]);
    expect(source.estimate).toStrictEqual(source.oracle);
    expect(source.activeBodies).toBe(0);
  }, 120000);
});

describe('BeforeModel oversized row', () => {
  if (process.env.ISSUE854_MODEL_LARGE === '1') {
    it('accepts a valid row larger than 10 MiB with a genuine full-input model hook', async () => {
      const facts = await modelHookWorker(root(), 'large');
      expect(facts.error).toBeUndefined();
      expect(facts.bodies[0].bytes).toBeGreaterThan(10 * 1024 * 1024);
      expect(facts.estimate).toStrictEqual(facts.oracle);
      expect(facts.firstLive).toBe(0);
      expect(facts.lastLive).toBe(0);
      expect(facts.activeBodies).toBe(0);
    }, 600000);
  }
});
