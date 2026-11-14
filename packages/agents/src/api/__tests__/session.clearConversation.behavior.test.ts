import { captureSessionOwner } from './helpers/capture-session-owner.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';
import { nativeRows, rowTexts } from './helpers/native-session-fixture.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import type { SessionClientOwner } from '../../session/session-client-owner.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { ownerClients } from './helpers/session-client-capture.js';
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
  RecordingIntegration,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import {
  recordingSessionId,
  verifyJournalSessionLayout,
  withTelemetryAgent,
  readinessTokenizer,
  deferred,
  textItem,
  itemText,
} from './support/clear-conversation-values.js';
import { AgentClient } from '../../core/client.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { createAgent } from '../createAgent.js';
import { AgentExecutionCoordinator } from '../agentExecutionCoordinator.js';
import type { AgentConfig } from '../config-types.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { drain, isDoneEvent } from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A tokenizer factory passed through the public `tokenizerFactory` input; its
 * `prepareTokenizer` is the readiness step every candidate session client
 * awaits, so a scenario can make that step fail on the next switch.
 */
const RecordingService = JournalRecordingService;
const observedDisposals = new WeakSet<Agent>();
const owners = new WeakMap<Agent, SessionClientOwner>();
function clientOwner(agent: Agent): SessionClientOwner {
  const owner = owners.get(agent);
  if (owner === undefined) throw new Error('Missing captured session owner');
  return owner;
}
const RECORDED_CONVERSATION = [
  textItem('human', 'first question'),
  textItem('ai', 'first answer'),
  textItem('human', 'second question'),
  textItem('ai', 'second answer'),
];

async function seedRecordedConversation(agent: Agent): Promise<string> {
  await agent.setHistory(RECORDED_CONVERSATION);
  await agent.session.setRecording({ enabled: true });
  const path = agent.session.getRecording().path;
  if (path === undefined) throw new Error('Expected conversation recording');
  return path;
}

async function withRecordedConversation<T>(
  fn: (agent: Agent, recordingPath: string) => Promise<T>,
  overrides: Partial<AgentConfig> = {},
): Promise<T> {
  const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-clear-conversation-'));
  const { value: agent, owner } = await captureSessionOwner(() =>
    createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir,
      ...overrides,
    }),
  );
  owners.set(agent, owner);
  try {
    return await fn(agent, await seedRecordedConversation(agent));
  } finally {
    if (!observedDisposals.has(agent)) await agent.dispose();
    rmSync(workingDir, { recursive: true, force: true });
  }
}

/**
 * An agent on the foreground preflight route, with the host's own
 * `SessionSettingsOwner`: the telemetry root the agent logs through is
 * `settingsOwner.telemetry`.
 */
async function withTelemetryConversation<T>(
  fn: (
    agent: Agent,
    recordingPath: string,
    telemetry: RootTelemetry,
  ) => Promise<T>,
): Promise<T> {
  return withTelemetryAgent(async (agent, telemetry) =>
    fn(agent, await seedRecordedConversation(agent), telemetry),
  );
}

describe('starting a new conversation session', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('plain-text.jsonl');
  it('retires an empty client journal when starting another session', async () => {
    await withRecordedConversation(async (agent) => {
      await agent.session.startNewSession();
      const retired = clientOwner(agent)
        .clients.getAgentClient()
        .getHistoryService();
      if (retired === null) throw new Error('Missing empty session history');
      await agent.session.startNewSession();
      await expect(retired.getLastContent()).rejects.toThrow('disposed');
    });
  });

  it('rejects foreground turns and settings while recording retirement is paused', async () => {
    await withRecordedConversation(async (agent, oldPath) => {
      const entered = deferred();
      const release = deferred();
      const original = RecordingService.prototype.dispose;
      const pause = spyOn(
        RecordingService.prototype,
        'dispose',
      ).mockImplementationOnce(async function (this: JournalRecordingService) {
        entered.resolve();
        await release.promise;
        await original.call(this);
      });
      const switching = agent.session.startNewSession();
      try {
        await entered.promise;

        const channel = agent.tools.openClientChannel();
        try {
          await channel.ready;
          await expect(
            channel.schedule(
              {
                callId: 'forbidden',
                name: 'read_file',
                args: { absolute_path: oldPath },
                isClientInitiated: true,
                prompt_id: 'forbidden',
              },
              new AbortController().signal,
            ),
          ).rejects.toThrow(AgentBusyError);
        } finally {
          await channel.release();
        }
        await expect(
          drain(agent.stream('must not be admitted')),
        ).rejects.toThrow(AgentBusyError);
        expect(() =>
          agent.setEphemeralSetting('reasoning.includeInResponse', false),
        ).toThrow(AgentBusyError);
        await expect(agent.setModel('must-not-commit')).rejects.toThrow(
          AgentBusyError,
        );
      } finally {
        release.resolve();
        await switching;
        pause.mockRestore();
      }
      await drain(agent.stream('recorded after publication'));
      await agent.session.flushRecording();
      const path = agent.session.getRecording().path;
      if (path === undefined)
        throw new Error('Expected recording after publication');
      expect(rowTexts(await nativeRows(path))).toContain(
        'recorded after publication',
      );
      expect(rowTexts(await nativeRows(path))).not.toContain(
        'must not be admitted',
      );
    });
  });

  for (const stage of [
    'tokenizer',
    'initialize',
    'resetChat',
    'recording',
    'telemetry',
    'integration',
  ]) {
    it(`preserves the old recorded conversation when ${stage} preparation fails`, async () => {
      const tokenizer = readinessTokenizer();
      await withRecordedConversation(
        async (agent, oldPath) => {
          const oldId = await recordingSessionId(oldPath);
          let candidateIds: readonly string[] = [];
          const createLocked = RecordingService.createLocked;
          const recordingAcquisition = spyOn(
            RecordingService,
            'createLocked',
          ).mockImplementation(async (options) => {
            if (stage === 'recording')
              throw new Error('candidate preparation failed');
            const recording = await createLocked(options);
            candidateIds = [...candidateIds, recording.getSessionId()];
            return recording;
          });
          let acquired: readonly AgentClient[] = [];
          let disposed: readonly AgentClient[] = [];
          const initialize = AgentClient.prototype.initialize;
          const dispose = AgentClient.prototype.dispose;
          const acquisition = spyOn(
            AgentClient.prototype,
            'initialize',
          ).mockImplementation(async function (this: AgentClient, ...args) {
            acquired = [...acquired, this];
            if (stage === 'initialize')
              throw new Error('candidate preparation failed');
            return initialize.apply(this, args);
          });
          const disposal = spyOn(
            AgentClient.prototype,
            'dispose',
          ).mockImplementation(async function (this: AgentClient) {
            disposed = [...disposed, this];
            return dispose.call(this);
          });
          const injectFailure = (): { mockRestore: () => void } | undefined => {
            switch (stage) {
              case 'tokenizer':
                return spyOn(
                  tokenizer,
                  'prepareTokenizer',
                ).mockRejectedValueOnce(
                  new Error('candidate preparation failed'),
                );
              case 'integration':
                return spyOn(
                  RecordingIntegration.prototype,
                  'subscribeToJournal',
                ).mockImplementationOnce(() => {
                  throw new Error('candidate preparation failed');
                });
              case 'resetChat':
                return spyOn(
                  AgentClient.prototype,
                  'resetChat',
                ).mockRejectedValueOnce(
                  new Error('candidate preparation failed'),
                );
              case 'telemetry':
                return spyOn(
                  RootTelemetry.prototype,
                  'prepareNewSession',
                ).mockRejectedValueOnce(
                  new Error('candidate preparation failed'),
                );
              default:
                return undefined;
            }
          };
          const failure = injectFailure();
          try {
            await expect(agent.session.startNewSession()).rejects.toThrow(
              'candidate preparation failed',
            );
            expect(agent.session.getSessionId()).toBe(oldId);
            expect(agent.session.getRecording()).toMatchObject({
              enabled: true,
              path: oldPath,
            });
            expect(
              (await collectAgentHistory(agent)).map(itemText),
            ).toStrictEqual([
              'first question',
              'first answer',
              'second question',
              'second answer',
            ]);
            expect(disposed).toStrictEqual(acquired);
            for (const id of candidateIds) {
              const lock = await SessionLockManager.acquire(
                join(oldPath, '..'),
                id,
              );
              await lock.release();
            }
          } finally {
            failure?.mockRestore();
            recordingAcquisition.mockRestore();
            acquisition.mockRestore();
            disposal.mockRestore();
          }
          await drain(agent.stream('still recorded after failure'));
          await agent.session.flushRecording();
          expect(rowTexts(await nativeRows(oldPath))).toContain(
            'still recorded after failure',
          );
        },
        { tokenizerFactory: tokenizer },
      );
    });
  }

  it('closes admission when recording retirement fails', async () => {
    await withRecordedConversation(async (agent, oldPath) => {
      const original = RecordingService.prototype.dispose;
      const failure = spyOn(
        RecordingService.prototype,
        'dispose',
      ).mockImplementationOnce(async function (this: JournalRecordingService) {
        await original.call(this);
        throw new Error('retirement failed');
      });
      try {
        const oldId = await recordingSessionId(oldPath);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'retirement failed',
        );
        expect(agent.session.getSessionId()).toBe(oldId);
        await expect(drain(agent.stream('must remain closed'))).rejects.toThrow(
          'closed',
        );
        expect(() =>
          agent.setEphemeralSetting('reasoning.includeInResponse', false),
        ).toThrow('closed');
      } finally {
        failure.mockRestore();
      }
    });
  });

  it('closes admission when telemetry retirement fails', async () => {
    await withTelemetryConversation(async (agent, oldPath, telemetry) => {
      const failure = spyOn(telemetry, 'setEnabled').mockRejectedValueOnce(
        new Error('retirement failed'),
      );
      try {
        const oldId = await recordingSessionId(oldPath);
        await expect(agent.session.startNewSession()).rejects.toThrow(
          'retirement failed',
        );
        expect(agent.session.getSessionId()).toBe(oldId);
        await expect(drain(agent.stream('must remain closed'))).rejects.toThrow(
          'closed',
        );
        expect(() =>
          agent.setEphemeralSetting('reasoning.includeInResponse', false),
        ).toThrow('closed');
      } finally {
        failure.mockRestore();
      }
    });
  });

  describe('client retirement', () => {
    const credentials = useOwnedCredentials();

    it('closes admission when client retirement fails', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'clear-client-retirement-'));
      const opened = await openClientOwner(
        credentials().authority,
        {
          provider: 'fake',
          model: 'fake-model',
          workingDir: directory,
          interactive: true,
          harness: { includeProcessCwd: false },
        },
        { provider: 'fake', model: 'fake-model' },
      );
      const coordinator = new AgentExecutionCoordinator();
      const session = opened.owner.createSessionControl(
        'facade',
        () => 'clear-client-retirement-runtime',
        (operation) => coordinator.withIdleBoundary(operation),
        () => coordinator.closeAdmission(),
        () => {},
        () => 'fake',
        () => 'fake-model',
      );
      let closeAttempted = false;
      try {
        await opened.client.restoreHistory(RECORDED_CONVERSATION);
        await session.setRecording({ enabled: true });
        const oldId = session.getSessionId();
        const clients = ownerClients(opened.owner);
        const previous = clients[clients.length - 1];
        const original = previous.dispose.bind(previous);
        const failure = spyOn(previous, 'dispose').mockImplementationOnce(
          async () => {
            await original();
            throw new Error('retirement failed');
          },
        );
        try {
          await expect(session.startNewSession()).rejects.toThrow(
            'retirement failed',
          );
          expect(session.getSessionId()).toBe(oldId);
          expect(() =>
            coordinator.admit({
              controller: new AbortController(),
              finished: Promise.resolve(),
              finish: () => {},
              close: async () => {},
              retirements: [],
            }),
          ).toThrow('closed');
          expect(() => coordinator.assertSettingsAdmission()).toThrow('closed');
          await expect(session.startNewSession()).rejects.toThrow('closed');
          await expect(session.getHistory()).rejects.toThrow(
            'Session disposed',
          );
          await session.dispose();
          closeAttempted = true;
          await expect(opened.close()).rejects.toThrow(
            'Session client cleanup failed',
          );
        } finally {
          failure.mockRestore();
        }
      } finally {
        await runCleanupSteps([
          () => session.dispose(),
          () => (closeAttempted ? undefined : opened.close()),
          () => coordinator.dispose(),
          () => rmSync(directory, { recursive: true, force: true }),
        ]);
      }
    }, 30000);
  });

  it('releases the recorder even when both client and recorder retirement fail', async () => {
    await withRecordedConversation(async (agent, oldPath) => {
      const previous = clientOwner(agent).clients.getAgentClient();
      const disposeClient = previous.dispose.bind(previous);
      const clientFailure = spyOn(previous, 'dispose').mockImplementationOnce(
        async () => {
          await disposeClient();
          throw new Error('client retirement failed');
        },
      );
      const disposeRecorder = RecordingService.prototype.dispose;
      const recorderFailure = spyOn(
        RecordingService.prototype,
        'dispose',
      ).mockImplementationOnce(async function (this: SessionRecordingPort) {
        await disposeRecorder.call(this);
        throw new Error('recorder retirement failed');
      });
      try {
        await expect(agent.session.startNewSession()).rejects.toMatchObject({
          errors: [
            { message: 'client retirement failed' },
            { message: 'recorder retirement failed' },
          ],
        });
        const lock = await SessionLockManager.acquire(
          join(oldPath, '..'),
          await recordingSessionId(oldPath),
        );
        await lock.release();
        await expect(drain(agent.stream('closed'))).rejects.toThrow('closed');
        await expect(agent.dispose()).rejects.toThrow(
          'client retirement failed',
        );
        observedDisposals.add(agent);
      } finally {
        clientFailure.mockRestore();
        recorderFailure.mockRestore();
      }
    });
  });

  it('leaves no prior conversation turns for the next model request', async () => {
    const afterReset = await withRecordedConversation(async (agent) => {
      await agent.session.startNewSession();
      return collectAgentHistory(agent);
    });
    expect(afterReset).toStrictEqual([]);
  });

  it('moves telemetry events, spans and token measurements to the new session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'clear-telemetry-'));
    const outfile = join(directory, 'telemetry.jsonl');
    try {
      await withTelemetryAgent(
        async (agent, telemetry) => {
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
              (record) =>
                record.success && record.data.name === 'after-clear-span',
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
            points.map((point) => [
              point.attributes['session.id'],
              point.value,
            ]),
          ).toStrictEqual([[nextId, 7]]);
        },
        { telemetry: { enabled: true, outfile } },
      );
    } finally {
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
      ).mockImplementation(async function* (this: FakeProvider, options) {
        const rows: AgentHistoryItem[] = [];
        if ('requestRows' in options && options.requestRows !== undefined) {
          for await (const row of options.requestRows.openReader(
            options.invocation?.signal,
          ))
            rows.push(row);
        } else {
          for await (const row of 'contents' in options
            ? options.contents
            : options)
            rows.push(row);
        }
        observed = [...observed, rows];
        yield* original.call(this, options);
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
      const oldContents = readFileSync(oldPath);
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
      expect(readFileSync(oldPath)).toStrictEqual(oldContents);
      await verifyJournalSessionLayout(oldPath, newPath, nextId);

      expect(
        (await agent.session.listSessions()).map((session) => session.id),
      ).toHaveLength(2);
      const restored = await Array.fromAsync(
        await agent.session.resume(oldSession.id),
      );
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
      const postClear = await Array.fromAsync(
        await agent.session.resume(newSession.id),
      );
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
      const restored = await Array.fromAsync(
        await agent.session.resume('latest'),
      );
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
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
    });
  });

  it('does not clear a sibling conversation or change its Config identity', async () => {
    const routes: RouteAAgent[] = [];
    try {
      const first = await openRouteAAgent();
      routes.push(first);
      const second = await openRouteAAgent({
        config: { workingDir: first.directory },
      });
      routes.push(second);
      const agent = first.agent;
      const sibling = second.agent;
      const config = first.config;
      await agent.setHistory([textItem('human', 'shared conversation')]);
      await sibling.setHistory([textItem('human', 'shared conversation')]);
      const prior = await collectAgentHistory(sibling);
      const configId = config.getSessionId();
      await agent.session.setRecording({ enabled: true });
      await agent.session.startNewSession();
      expect(await collectAgentHistory(agent)).toStrictEqual([]);
      expect(await collectAgentHistory(sibling)).toStrictEqual(prior);
      expect(config.getSessionId()).toBe(configId);
      await agent.session.setRecording({ enabled: false });
      await agent.session.resume('latest');
      expect((await collectAgentHistory(agent)).map(itemText)).toStrictEqual([
        'shared conversation',
      ]);
    } finally {
      await runCleanupSteps(
        [...routes].reverse().map((route) => () => route.close()),
      );
    }
  });

  it('keeps the new facade session identity on model requests after a model switch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'clear-model-identity-'));
    const outfile = join(directory, 'telemetry.jsonl');
    const route = await openRouteAAgent({
      config: { telemetry: { enabled: true, outfile } },
    });
    try {
      const { agent, config } = route;
      const sharedId = config.getSessionId();
      await agent.session.startNewSession();
      const nextId = agent.session.getSessionId();
      await agent.setModel('fresh-model');
      await drain(agent.stream('new request'));
      await agent.dispose();
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
      expect(spans.map((span) => span.attributes['session.id'])).toStrictEqual(
        spans.map(() => nextId),
      );
      expect(config.getSessionId()).toBe(sharedId);
    } finally {
      await route.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('still retains the initial turn by default while recording', async () => {
    const texts = await withRecordedConversation(async (agent) => {
      await agent.resetChat();
      return (await collectAgentHistory(agent)).map(itemText);
    });
    expect(texts).toStrictEqual(['first question', 'first answer']);
  });
});
