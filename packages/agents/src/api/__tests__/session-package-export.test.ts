/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSessionMediaPackage } from '@vybestack/llxprt-code-core';
import { useBackendEnv } from '../../../../core/src/recording/__tests__/support/backendEnv.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

for (const selected of ['old', 'journal'] as const) {
  describe(`public session package export on ${selected}`, () => {
    const backend = useBackendEnv();
    it('exports active resumed history and imports it without changing the source owner', async () => {
      backend(selected);
      const destination = await mkdtemp(join(tmpdir(), 'session-export-'));
      try {
        await withRecordingLifetimeFixture(async ({ agent }) => {
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Before resume' }],
            },
          ]);
          await agent.session.setRecording({ enabled: true });
          const [source] = await agent.session.listSessions();
          await agent.session.setRecording({ enabled: false });
          await agent.session.resume(source.id);
          const expected = await agent.session.getHistory();
          await agent.session.createCheckpoint('Saved export');
          const directory = join(destination, 'package');
          await agent.session.exportSession(source.id, directory);
          const validated = await validateSessionMediaPackage(directory);
          expect(validated.manifest.recording).toBe(
            selected === 'journal' ? 'session.llxj' : 'session.jsonl',
          );
          expect(agent.session.getRecording().enabled).toBe(true);
          expect(await agent.session.getHistory()).toStrictEqual(expected);
          const imported = await agent.session.importSession(directory);
          expect(imported.id).not.toBe(source.id);
          expect(await agent.session.getHistory()).toStrictEqual(expected);
          expect(
            (await agent.session.listCheckpoints()).some(
              (point) => point.name === 'Saved export',
            ),
          ).toBe(true);
          const stoppedPackage = join(destination, 'export-racing-stop');
          await Promise.all([
            agent.session.exportSession(imported.id, stoppedPackage),
            agent.session.setRecording({ enabled: false }),
          ]);
          expect(
            (await validateSessionMediaPackage(stoppedPackage)).manifest
              .recording,
          ).toBe(validated.manifest.recording);
          expect(agent.session.getRecording().enabled).toBe(false);
          expect(await agent.session.getHistory()).toStrictEqual(expected);
        });
      } finally {
        await rm(destination, { recursive: true, force: true });
      }
    });
  });
}
