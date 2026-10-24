/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  getProjectHash,
  validateSessionMediaPackage,
} from '@vybestack/llxprt-code-core';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordedRows } from './support/recorded-rows.js';

import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

for (const selected of ['journal']) {
  describe(`public session package export on ${selected}`, () => {
    it('exports active resumed history and imports it without changing the source owner', async () =>
      (async () => {
        const destination = await mkdtemp(join(tmpdir(), 'session-export-'));
        try {
          await withRecordingLifetimeFixture(async ({ agent, config }) => {
            const media = requireMediaStore(agent.agentClient);
            const bytes = new Uint8Array([2, 7, 1, 8]);
            const reference = await media.admit({
              bytes,
              mimeType: 'image/png',
              semanticMetadata: {},
            });
            await agent.setHistory([
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'Before resume' }, reference],
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
            expect(validated.blobs).toHaveLength(1);
            const blob = validated.blobs[0];
            expect(
              new Uint8Array(await readFile(blob.sourcePath)),
            ).toStrictEqual(bytes);
            expect(validated.references).toContainEqual(reference);
            expect(validated.manifest.recording).toBe('session.llxj');
            expect(agent.session.getRecording().enabled).toBe(true);
            expect(agent.session.getRecording().format).toBe('journal');
            expect(await agent.session.getHistory()).toStrictEqual(expected);
            const imported = await agent.session.importSession(directory);
            expect(imported.id).not.toBe(source.id);
            expect(await agent.session.getHistory()).toStrictEqual(expected);
            const importedPath = agent.session.getRecording().path;
            if (importedPath === undefined)
              throw new Error('Missing imported recording');
            expect(
              (
                await recordedRows(
                  importedPath,
                  getProjectHash(config.getProjectRoot()),
                )
              ).map((row) => row.blocks),
            ).toStrictEqual(expected.map((row) => row.blocks));
            expect(await media.readVerified(reference)).toStrictEqual(bytes);
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
      })());
  });
}
