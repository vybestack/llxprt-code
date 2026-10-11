/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import {
  AgentBusyError,
  type Agent,
  type AgentHistoryItem,
} from '@vybestack/llxprt-code-agents';
import {
  SessionLockManager,
  SessionLockedError,
} from '@vybestack/llxprt-code-core';
import {
  buildAgent,
  drain,
  isDoneEvent,
  internalSettingsOwner,
} from './helpers/agentHarness.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

function textItem(speaker: 'human' | 'ai', text: string): AgentHistoryItem {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function itemText(item: AgentHistoryItem): string {
  return item.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

function recordedLineTypes(path: string): string[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => z.object({ type: z.string() }).parse(JSON.parse(line)).type);
}

async function withRecordedConversation<T>(
  fn: (agent: Agent, recordingPath: string) => Promise<T>,
): Promise<T> {
  const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-clear-conversation-'));
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
    workingDir,
  });
  try {
    await agent.setHistory([
      textItem('human', 'first question'),
      textItem('ai', 'first answer'),
      textItem('human', 'second question'),
      textItem('ai', 'second answer'),
    ]);
    await agent.session.setRecording({ enabled: true });
    const path = agent.session.getRecording().path;
    if (path === undefined) throw new Error('Expected conversation recording');
    return await fn(agent, path);
  } finally {
    await cleanup();
    rmSync(workingDir, { recursive: true, force: true });
  }
}

describe('starting a new conversation session', () => {
  it('leaves no prior conversation turns for the next model request', async () => {
    const afterReset = await withRecordedConversation(async (agent) => {
      await agent.session.startNewSession();
      return agent.getHistory();
    });
    expect(afterReset).toStrictEqual([]);
  });

  it('moves telemetry events, spans and token measurements to the new session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'clear-telemetry-'));
    const outfile = join(directory, 'telemetry.jsonl');
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: directory,
      telemetry: { enabled: true, outfile },
    });
    try {
      const telemetry = internalSettingsOwner(agent).telemetry;
      const oldId = agent.session.getSessionId();
      telemetry.events.record(() => ({ body: 'before clear' }));
      await agent.session.startNewSession();
      const nextId = agent.session.getSessionId();
      telemetry.events.record(() => ({ body: 'after clear' }));
      telemetry.spans.start('after-clear-span').end();
      telemetry.measurements.tokenUsage('after-clear-model', 7, 'input');
      await telemetry.flush();
      const records = readFileSync(outfile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const logs = records.flatMap((record: unknown) => {
        const parsed = z
          .object({ body: z.string(), attributes: z.record(z.unknown()) })
          .safeParse(record);
        return parsed.success ? [parsed.data] : [];
      });
      expect(
        logs.find((record) => record.body === 'before clear')?.attributes[
          'session.id'
        ],
      ).toBe(oldId);
      expect(
        logs.find((record) => record.body === 'after clear')?.attributes[
          'session.id'
        ],
      ).toBe(nextId);
      const span = records
        .map((record: unknown) =>
          z
            .object({
              name: z.string(),
              attributes: z.record(z.unknown()),
              resource: z.object({
                _rawAttributes: z.array(z.tuple([z.string(), z.unknown()])),
              }),
            })
            .safeParse(record),
        )
        .find(
          (record) => record.success && record.data.name === 'after-clear-span',
        );
      if (span?.success !== true) throw new Error('Expected exported span');
      expect(span.data.attributes['session.id']).toBe(nextId);
      expect(
        Object.fromEntries(span.data.resource._rawAttributes)['session.id'],
      ).toBe(nextId);
      const points = records
        .flatMap((record: unknown) => {
          const parsed = z
            .object({
              scopeMetrics: z.array(
                z.object({
                  metrics: z.array(
                    z.object({
                      dataPoints: z.array(
                        z.object({
                          attributes: z.record(z.unknown()),
                          value: z.number(),
                        }),
                      ),
                    }),
                  ),
                }),
              ),
            })
            .safeParse(record);
          return parsed.success
            ? parsed.data.scopeMetrics.flatMap((scope) =>
                scope.metrics.flatMap((metric) => metric.dataPoints),
              )
            : [];
        })
        .filter((point) => point.attributes.model === 'after-clear-model');
      expect(
        points.map((point) => [point.attributes['session.id'], point.value]),
      ).toStrictEqual([[nextId, 7]]);
    } finally {
      await cleanup();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('sends only the new turn to the provider after starting a new session', async () => {
    await withRecordedConversation(async (agent) => {
      await agent.session.startNewSession();
      const original = FakeProvider.prototype.generateChatCompletion;
      let observed: ReadonlyArray<readonly AgentHistoryItem[]> = [];
      const capture = spyOn(
        FakeProvider.prototype,
        'generateChatCompletion',
      ).mockImplementation(function (this: FakeProvider, options) {
        observed = [
          ...observed,
          Array.isArray(options) ? options : options.contents,
        ];
        return original.call(this, options);
      });
      try {
        const events = await drain(agent.stream('fresh start'));
        expect(events.filter((event) => event.type === 'error')).toStrictEqual(
          [],
        );
        expect(events.filter(isDoneEvent)).toHaveLength(1);
        expect(observed.flat().map(itemText)).not.toContain('first question');
        expect(observed.flat().map(itemText)).not.toContain('second answer');
        expect(observed[0].map(itemText)).toStrictEqual(['fresh start']);
      } finally {
        capture.mockRestore();
      }
    });
  });

  it('preserves the old recording and makes both conversations separately resumable', async () => {
    await withRecordedConversation(async (agent, oldPath) => {
      const oldSessions = await agent.session.listSessions();
      const oldSession = oldSessions[0];
      await agent.session.flushRecording();
      const oldContents = readFileSync(oldPath, 'utf8');
      await agent.session.startNewSession();
      const nextId = agent.session.getSessionId();
      expect(nextId).not.toBe(oldSession.id);
      await expect(
        SessionLockManager.acquire(join(oldPath, '..'), nextId),
      ).rejects.toThrow(SessionLockedError);
      const events = await drain(agent.stream('fresh start'));
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      await agent.session.flushRecording();
      const newPath = agent.session.getRecording().path;
      if (newPath === undefined) throw new Error('Expected new recording');
      expect(newPath).not.toBe(oldPath);
      expect(readFileSync(oldPath, 'utf8')).toBe(oldContents);
      expect(
        JSON.parse(readFileSync(newPath, 'utf8').split('\n')[0]),
      ).toMatchObject({ payload: { sessionId: nextId } });
      expect(
        recordedLineTypes(oldPath).filter((type) => type === 'rewind'),
      ).toStrictEqual([]);
      expect(
        recordedLineTypes(oldPath).filter((type) => type === 'content'),
      ).toHaveLength(4);
      expect(
        (await agent.session.listSessions()).map((session) => session.id),
      ).toHaveLength(2);
      const restored = await agent.session.resume(oldSession.id);
      expect(restored.map(itemText)).toStrictEqual([
        'first question',
        'first answer',
        'second question',
        'second answer',
      ]);
      const newSession = (await agent.session.listSessions()).find(
        (session) => session.id !== oldSession.id,
      );
      if (newSession === undefined) throw new Error('Expected new session');
      const postClear = await agent.session.resume(newSession.id);
      expect(postClear.map(itemText)).not.toContain('first question');
      expect(postClear.map(itemText)[0]).toBe('fresh start');
    });
  });

  it('does not hide the old session from latest resolution when the new session exits empty', async () => {
    await withRecordedConversation(async (agent, oldPath) => {
      const oldSession = (await agent.session.listSessions())[0];
      await agent.session.startNewSession();
      expect(agent.session.getRecording().path).toBeUndefined();
      const oldLock = await SessionLockManager.acquire(
        join(oldPath, '..'),
        oldSession.id,
      );
      await oldLock.release();
      await agent.session.setRecording({ enabled: false });
      const restored = await agent.session.resume('latest');
      expect(restored.map(itemText)).toStrictEqual([
        'first question',
        'first answer',
        'second question',
        'second answer',
      ]);
      expect(await agent.session.listSessions()).toHaveLength(1);
    });
  });

  it('keeps provider, model, profile and settings selected across the new session', async () => {
    await withRecordedConversation(async (agent) => {
      agent.setEphemeralSetting('reasoning.includeInResponse', false);
      const before = [
        agent.getProvider(),
        agent.getModel(),
        agent.getActiveProfileName(),
        agent.getEphemeralSettings(),
      ];
      await agent.session.startNewSession();
      expect([
        agent.getProvider(),
        agent.getModel(),
        agent.getActiveProfileName(),
        agent.getEphemeralSettings(),
      ]).toStrictEqual(before);
    });
  });

  it('rejects a new session during an active run without ending its recording', async () => {
    await withRecordedConversation(async (agent, oldPath) => {
      const oldId = agent.session.getSessionId();
      const iterator = agent.stream('active request')[Symbol.asyncIterator]();
      try {
        await iterator.next();
        await expect(agent.session.startNewSession()).rejects.toThrow(
          AgentBusyError,
        );
        expect(agent.session.getSessionId()).toBe(oldId);
        expect(agent.session.getRecording()).toMatchObject({
          enabled: true,
          path: oldPath,
        });
      } finally {
        await iterator.return?.();
      }
    });
  });

  it('keeps recording disabled when starting a new session without recording', async () => {
    await withRecordedConversation(async (agent) => {
      await agent.session.setRecording({ enabled: false });
      const oldId = agent.session.getSessionId();
      await agent.session.startNewSession();
      expect(agent.session.getSessionId()).not.toBe(oldId);
      expect(agent.session.getRecording().enabled).toBe(false);
      expect(await agent.getHistory()).toStrictEqual([]);
    });
  });

  it('does not clear a sibling conversation or change shared Config identity', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow, config }) => {
      await agent.setHistory([textItem('human', 'shared conversation')]);
      const sibling = await borrow();
      const prior = await sibling.getHistory();
      const configId = config.getSessionId();
      await agent.session.setRecording({ enabled: true });
      await agent.session.startNewSession();
      expect(await agent.getHistory()).toStrictEqual([]);
      expect(await sibling.getHistory()).toStrictEqual(prior);
      expect(config.getSessionId()).toBe(configId);
      await agent.session.setRecording({ enabled: false });
      await agent.session.resume('latest');
      expect((await agent.getHistory()).map(itemText)).toStrictEqual([
        'shared conversation',
      ]);
    });
  });

  it('keeps the new facade session identity on model requests after a model switch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'clear-model-identity-'));
    const outfile = join(directory, 'telemetry.jsonl');
    try {
      await withRecordingLifetimeFixture(
        async ({ agent, config }) => {
          const sharedId = config.getSessionId();
          await agent.session.startNewSession();
          const nextId = agent.session.getSessionId();
          await agent.setModel('fresh-model');
          await drain(agent.stream('new request'));
          await internalSettingsOwner(agent).telemetry.flush();
          const spans = readFileSync(outfile, 'utf8')
            .trim()
            .split('\n')
            .flatMap((line) => {
              const parsed = z
                .object({ name: z.string(), attributes: z.record(z.unknown()) })
                .safeParse(JSON.parse(line));
              return parsed.success && parsed.data.name === 'llxprt.api.request'
                ? [parsed.data]
                : [];
            });
          expect(spans.length).toBeGreaterThan(0);
          expect(
            spans.map((span) => span.attributes['session.id']),
          ).toStrictEqual(spans.map(() => nextId));
          expect(config.getSessionId()).toBe(sharedId);
        },
        undefined,
        { telemetry: { enabled: true, outfile } },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('still retains the initial turn by default while recording', async () => {
    const texts = await withRecordedConversation(async (agent) => {
      await agent.resetChat();
      return (await agent.getHistory()).map(itemText);
    });
    expect(texts).toStrictEqual(['first question', 'first answer']);
  });
});
