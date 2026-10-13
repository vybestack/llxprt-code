/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * The journal is the system of record, so a mutation the recorder did not
 * accept must never be published or reported durable. Inactive, disposed and
 * poisoned recorders reject at admission, through both the store and the
 * HistoryService single-add and batch paths.
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata: {} };
}

type RecorderState = 'inactive' | 'disposed' | 'poisoned';

interface Harness {
  readonly recorder: SessionRecordingService;
  readonly expected: RegExp | Error;
  seed(): Promise<void>;
  close(): Promise<void>;
}

function harness(state: RecorderState, seedRows: boolean): Harness {
  const root = mkdtempSync(join(tmpdir(), 'journal-admission-'));
  const recorder = new SessionRecordingService({
    sessionId: `admission-${state}`,
    projectHash: 'admission',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const poison = new Error('injected write failure');
  return {
    recorder,
    expected: state === 'poisoned' ? poison : /disposed|inactive/,
    async seed() {
      if (seedRows) {
        const store = new HistoryJournalStore(recorder);
        store.apply({ kind: 'content', content: row('seed') });
        await store.waitForDurable();
        await store.dispose();
      }
      if (state === 'disposed') await recorder.dispose();
      if (state === 'inactive') {
        Object.assign(recorder, {
          lifecycle: { status: 'failure-reported' },
        });
      }
      if (state === 'poisoned') {
        Object.assign(recorder, {
          poisonError: poison,
          lifecycle: { status: 'failed', error: poison },
        });
      }
    },
    async close() {
      if (state !== 'disposed') await recorder.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const STATES: RecorderState[] = ['inactive', 'disposed', 'poisoned'];

describe('journal admission rejects a recorder that cannot accept records', () => {
  for (const state of STATES) {
    for (const seeded of [false, true]) {
      const label = `${state} recorder, ${seeded ? 'with' : 'without'} a prior sequence`;

      it(`store.apply throws and publishes nothing (${label})`, async () => {
        const h = harness(state, seeded);
        await h.seed();
        const store = new HistoryJournalStore(h.recorder);
        try {
          expect(() =>
            store.apply({ kind: 'content', content: row('x') }),
          ).toThrow(h.expected);
          expect(store.getLength()).toBe(seeded ? 1 : 0);
          await store.waitForDurable();
        } finally {
          await store.dispose();
          await h.close();
        }
      });

      it(`HistoryService.add throws and keeps the prior history (${label})`, async () => {
        const h = harness(state, seeded);
        await h.seed();
        const service = new HistoryService({ recording: h.recorder });
        try {
          expect(() => service.add(row('x'))).toThrow(h.expected);
          expect(service.length()).toBe(seeded ? 1 : 0);
        } finally {
          await service.dispose();
          await h.close();
        }
      });

      it(`HistoryService.addBatch rejects and keeps the prior history (${label})`, async () => {
        const h = harness(state, seeded);
        await h.seed();
        const service = new HistoryService({ recording: h.recorder });
        try {
          await expect(service.addBatch([row('x'), row('y')])).rejects.toThrow(
            h.expected,
          );
          expect(service.length()).toBe(seeded ? 1 : 0);
        } finally {
          await service.dispose();
          await h.close();
        }
      });
    }
  }
});
