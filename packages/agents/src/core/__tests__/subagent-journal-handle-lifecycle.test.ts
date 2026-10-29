/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { createOrchestratorForTurns } from './subagentOrchestrator-test-helpers.js';

const profile: Profile = {
  version: 1,
  provider: 'gemini',
  model: 'gemini-1.5-flash',
  modelParams: {},
  ephemeralSettings: {},
};

describe('subagent journal handle lifecycle', () => {
  it.each([
    { outcome: 'dispose', expectedFailure: undefined },
    {
      outcome: 'failure',
      expectedFailure: { name: 'Error', message: 'scope construction failed' },
    },
    {
      outcome: 'cancel',
      expectedFailure: {
        name: 'AbortError',
        message: 'Subagent launch aborted before completion.',
      },
    },
  ])(
    'closes child journal handles after $outcome',
    async ({ outcome, expectedFailure }) => {
      const handles: FileHandle[] = [];
      const open = fs.open.bind(fs);
      const probe = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (String(args[0]).includes('/chats/')) handles.push(handle);
        return handle;
      });
      try {
        const { orchestrator, factory } = createOrchestratorForTurns({
          subagentName: 'handle-lifecycle',
          profile,
        });
        const controller = new AbortController();
        if (outcome === 'failure') {
          factory.mockRejectedValue(new Error('scope construction failed'));
        } else if (outcome === 'cancel') {
          const create = factory.getMockImplementation();
          if (create === undefined) throw new Error('Missing scope factory');
          factory.mockImplementation(async (...args) => {
            const scope = await create(...args);
            controller.abort();
            return scope;
          });
        }
        let failure: { name: string; message: string } | undefined;
        try {
          const result = await orchestrator.launch(
            { name: 'handle-lifecycle' },
            controller.signal,
          );
          await result.dispose();
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          failure = { name: error.name, message: error.message };
        }
        expect(failure).toStrictEqual(expectedFailure);
        expect(handles.length).toBeGreaterThan(0);
        expect(handles.every((handle) => handle.fd === -1)).toBe(true);
      } finally {
        probe.mockRestore();
        await Promise.all(
          handles
            .filter((handle) => handle.fd >= 0)
            .map((handle) => handle.close()),
        );
      }
    },
  );
});
