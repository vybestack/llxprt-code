/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  toolHookWorker,
  type ToolHookMode,
  type ToolHookFacts,
} from './__tests__/support/streamprocessor-tool-hook-fixture.js';

function promptTokens(facts: ToolHookFacts): number {
  if (facts.estimate === null)
    throw new Error('Missing successful request estimate');
  return facts.estimate.estimatedPromptTokens;
}

const root = sourceRootSetup();
const selectedModes: ToolHookMode[] = ['none', 'restrict'];
const unchangedModes: ToolHookMode[] = ['absent', 'disabled', 'noop'];
describe('actual StreamProcessor tool-hook source parity', () => {
  it.each(selectedModes)(
    'honors genuine %s selection in HTTP, exact estimate and stream restrictions',
    async (mode) => {
      const source = await toolHookWorker(join(root(), 'source'), mode);
      const array = await toolHookWorker(join(root(), 'array'), mode, false);
      const baseline = await toolHookWorker(join(root(), 'baseline'), 'absent');
      expect(source.error).toBeUndefined();
      expect(array.error).toBeUndefined();
      expect(source.hookInput).toMatchObject({
        hook_event_name: 'BeforeToolSelection',
        llm_request: {
          version: 2,
          model: 'gpt-5.6',
          contents: [],
          tools: [{ name: 'weather' }, { name: 'calendar' }],
        },
      });
      expect(source.output).toBe('finished');
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(source.bodies).toHaveLength(1);
      expect(source.bodies).not.toStrictEqual(baseline.bodies);
      expect(source.estimate).toStrictEqual(source.oracle);
      expect(source.estimate).toStrictEqual(array.estimate);
      expect(promptTokens(source)).toBeLessThan(promptTokens(baseline));
      expect(source.restrictions).toStrictEqual(array.restrictions);
      expect(source.restrictions.length).toBeGreaterThan(0);
      expect(
        source.restrictions.every(
          (value) =>
            JSON.stringify(value) ===
            JSON.stringify({
              allowedToolNames: mode === 'none' ? [] : ['weather'],
            }),
        ),
      ).toBe(true);
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
    },
    60000,
  );
});

describe('actual source tool-hook no-op behavior', () => {
  it.each(unchangedModes)(
    'preserves %s selection without dropping tools',
    async (mode) => {
      const source = await toolHookWorker(join(root(), 'source'), mode);
      const baseline = await toolHookWorker(join(root(), 'baseline'), 'absent');
      expect(source.error).toBeUndefined();
      expect(source.bodies).toStrictEqual(baseline.bodies);
      expect(source.estimate).toStrictEqual(baseline.estimate);
    },
    60000,
  );
  it('keeps a runtime-disabled tool hook registered without executing it', async () => {
    const source = await toolHookWorker(root(), 'disabled');
    expect(source.error).toBeUndefined();
    expect(source.registry).toHaveLength(1);
    expect(source.registry[0].enabled).toBe(false);
    expect(source.hookInput).toBeUndefined();
    expect(source.hookStderr).toBeUndefined();
  }, 60000);
  it('executes an enabled genuine no-op tool hook', async () => {
    const source = await toolHookWorker(root(), 'noop');
    expect(source.error).toBeUndefined();
    expect(source.hookInput).toMatchObject({
      hook_event_name: 'BeforeToolSelection',
    });
  }, 60000);
});

const malformed: ToolHookMode[] = [
  'malformed-mode',
  'malformed-names',
  'malformed-specific',
  'unsupported-replacement',
];
describe('actual tool-hook failures follow the eager route', () => {
  it.each([...malformed, 'error' as const])(
    'treats genuine %s output as non-blocking on both routes',
    async (mode) => {
      const source = await toolHookWorker(join(root(), 'source'), mode);
      const array = await toolHookWorker(join(root(), 'array'), mode, false);
      expect(source.hookInput).toMatchObject({
        hook_event_name: 'BeforeToolSelection',
      });
      expect(source.error).toBeUndefined();
      expect(array.error).toBeUndefined();
      expect(source.bodies).toHaveLength(1);
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(source.estimate).toStrictEqual(array.estimate);
      expect(source.restrictions).toStrictEqual(array.restrictions);
      expect(source.owners.every((owner) => owner.closed)).toBe(true);
      expect(source.activeBodies).toBe(0);
    },
    60000,
  );
});
