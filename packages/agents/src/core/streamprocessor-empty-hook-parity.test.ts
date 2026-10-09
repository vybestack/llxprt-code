/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import {
  modelHookWorker,
  type ModelHookMode,
} from './streamprocessor-model-hook-fixture.js';

const root = sourceRootSetup();
const compatible: ModelHookMode[] = [
  'noop',
  'request-absent',
  'contents-absent',
  'edit',
  'none',
  'chain-empty-none',
  'chain-edit-noop',
  'chain-edit-absent',
  'parallel-empty-none',
];

describe('BeforeModel source compatibility with eager transport', () => {
  it.each(compatible)(
    'preserves exact %s bytes and the complete native estimate',
    async (mode) => {
      const source = await modelHookWorker(join(root(), 'source'), mode);
      const array = await modelHookWorker(join(root(), 'array'), mode, false);
      expect(source.error).toBeUndefined();
      expect(array.error).toBeUndefined();
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(source.estimate).toStrictEqual(array.estimate);
      expect(source.estimate).toStrictEqual(source.oracle);
      expect(source.output).toBe('finished');
      expect(source.activeBodies).toBe(0);
      expect(source.firstLive).toBe(0);
      expect(source.lastLive).toBe(0);
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
  it('applies a genuinely modified nonempty replacement instead of treating all hook output as unchanged', async () => {
    const changed = await modelHookWorker(join(root(), 'changed'), 'none');
    const original = await modelHookWorker(join(root(), 'original'), 'noop');
    expect(changed.error).toBeUndefined();
    expect(original.error).toBeUndefined();
    expect(changed.bodies[0].sha256).not.toBe(original.bodies[0].sha256);
    expect(changed.estimate).not.toStrictEqual(original.estimate);
    const body = JSON.parse(changed.bodies[0].text ?? '');
    expect(body.input).toStrictEqual([
      { role: 'user', content: 'new context' },
    ]);
    expect(changed.estimate).toStrictEqual(changed.oracle);
  }, 120000);
  it('passes empty rows to the next sequential command and applies its nonempty replacement', async () => {
    const source = await modelHookWorker(root(), 'chain-empty-none');
    expect(source.error).toBeUndefined();
    expect(source.hooks).toHaveLength(4);
    expect(source.hooks[2]).toMatchObject({
      input: { llm_request: { contents: [] } },
    });
    expect(JSON.parse(source.bodies[0].text ?? '').input).toStrictEqual([
      { role: 'user', content: 'new context' },
    ]);
    expect(source.estimate).toStrictEqual(source.oracle);
  }, 120000);
});

const emptyModes: ModelHookMode[] = [
  'empty',
  'chain-edit-empty',
  'chain-empty-noop',
  'parallel-edit-empty',
];
describe('BeforeModel incompatible empty output', () => {
  it.each(emptyModes)(
    'rejects %s before estimation or HTTP instead of changing eager semantics',
    async (mode) => {
      const source = await modelHookWorker(root(), mode);
      expect(source.error).toContain(
        'empty contents replacement conflicts with eager request semantics',
      );
      expect(source.hooks.length).toBeGreaterThan(0);
      expect(source.bodies).toStrictEqual([]);
      expect(source.estimate).toBeNull();
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
  it.each([
    'null-request',
    'null-contents',
    'bad-contents',
    'malformed-request',
    'v1-request',
    'chain-edit-null',
  ] as const)(
    'keeps unsupported %s fail-fast rather than broadening admission',
    async (mode) => {
      const source = await modelHookWorker(root(), mode);
      expect(source.error).toContain(
        'Unsupported source BeforeModel hook output',
      );
      expect(source.bodies).toStrictEqual([]);
      expect(source.estimate).toBeNull();
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
      expect(source.directories).toStrictEqual([]);
    },
    120000,
  );
});
