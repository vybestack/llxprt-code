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
