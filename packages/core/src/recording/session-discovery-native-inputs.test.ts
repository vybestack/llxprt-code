/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { basename } from 'node:path';
import { resumeSession } from './resumeSession.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SESSION_KEYS } from './sessionMetaKeys.js';

import {
  discoveryDirectory,
  replaceFact,
  START_FACT,
} from './__tests__/support/native-discovery-fixture.js';
import {
  chatsDirIn,
  journalSeams,
  PROJECT,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

interface MalformedFact {
  readonly label: string;
  readonly key: string;
  readonly value: unknown;
}

const malformedFacts: readonly MalformedFact[] = [
  { label: 'numeric identity', key: SESSION_KEYS.id, value: 42 },
  { label: 'empty identity', key: SESSION_KEYS.id, value: '' },
  {
    label: 'empty project',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, projectHash: '' },
  },
  {
    label: 'empty start time',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, startTime: '' },
  },
  {
    label: 'numeric workspace',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, workspaceDirs: [42] },
  },
  {
    label: 'object workspace',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, workspaceDirs: [{}] },
  },
  {
    label: 'null workspace',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, workspaceDirs: [null] },
  },
  {
    label: 'array workspace',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, workspaceDirs: [[]] },
  },
  {
    label: 'non-array workspaces',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, workspaceDirs: '/work' },
  },
  {
    label: 'numeric cwd',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, cwd: 7 },
  },
  {
    label: 'numeric parent identity',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, parentSessionId: 7 },
  },
  {
    label: 'unknown kind',
    key: SESSION_KEYS.start,
    value: { ...START_FACT, kind: 'unknown' },
  },
  {
    label: 'numeric provider',
    key: SESSION_KEYS.provider,
    value: { provider: 1, model: 'm' },
  },
  {
    label: 'numeric model',
    key: SESSION_KEYS.provider,
    value: { provider: 'p', model: 1 },
  },
  {
    label: 'malformed current directories',
    key: SESSION_KEYS.directories,
    value: ['/valid', {}],
  },
  { label: 'malformed title', key: SESSION_KEYS.title, value: 42 },
  { label: 'malformed name', key: SESSION_KEYS.name, value: [] },
  { label: 'malformed preview', key: SESSION_KEYS.preview, value: null },
];

describe('native discovery validates external session facts', () => {
  it.each([...malformedFacts])(
    'rejects $label without hiding the healthy sibling',
    async ({ key, value }) => {
      const chats = chatsDirIn(await discoveryDirectory('malformed'));
      const healthy = await recordJournal(chats, 'healthy', {
        rows: [userRow('safe')],
      });
      const broken = await recordJournal(chats, 'broken', {
        rows: [userRow('must not resume')],
      });
      await replaceFact(broken.filePath, key, value);

      const listed = await SessionDiscovery.listContinueTargetsDetailed(
        chats,
        PROJECT,
      );

      expect(
        listed.targets.map((target) =>
          target.kind === 'session'
            ? target.session.sessionId
            : target.checkpointId,
        ),
      ).toStrictEqual(['healthy']);
      expect(listed.unreadableRecordings).toStrictEqual([
        {
          filePath: broken.filePath,
          reason: `Session fact ${key} is not in the expected form`,
        },
      ]);
      expect(
        await SessionDiscovery.readSessionHeader(broken.filePath),
      ).toBeNull();
      const refused = await resumeSession({
        continueRef: basename(broken.filePath),
        projectHash: PROJECT,
        chatsDir: chats,
        currentProvider: 'anthropic',
        currentModel: 'model-1',
        workspaceDirs: ['/fallback'],
        journal: journalSeams(),
      });
      expect(refused).toMatchObject({
        ok: false,
        error: `Session fact ${key} is not in the expected form`,
      });
      expect(
        (await SessionDiscovery.listSessions(chats, PROJECT)).map(
          (session) => session.filePath,
        ),
      ).toStrictEqual([healthy.filePath]);
    },
  );

  it('keeps unknown and empty provider/model strings and exact Unicode workspace paths readable', async () => {
    const chats = chatsDirIn(await discoveryDirectory('valid-shape'));
    const recorded = await recordJournal(chats, 'valid', {
      provider: 'unknown',
      rows: [userRow('question')],
    });
    await replaceFact(recorded.filePath, SESSION_KEYS.start, START_FACT);
    await replaceFact(recorded.filePath, SESSION_KEYS.provider, {
      provider: 'unknown',
      model: '',
    });
    await replaceFact(recorded.filePath, SESSION_KEYS.directories, [
      '/new/雪',
      '/second',
    ]);
    const header = await SessionDiscovery.readSessionHeader(recorded.filePath);
    expect(header).toMatchObject({
      sessionId: 'valid',
      workspaceDirs: ['/work/雪', '/work/second'],
      provider: 'unknown',
      model: '',
      startTime: START_FACT.startTime,
    });
    const result = await resumeSession({
      continueRef: 'valid',
      projectHash: PROJECT,
      chatsDir: chats,
      currentProvider: 'unknown',
      currentModel: '',
      workspaceDirs: ['/fallback'],
      journal: journalSeams(),
    });
    if (!result.ok) throw new Error(result.error);
    try {
      expect(result.metadata).toMatchObject({
        sessionId: 'valid',
        workspaceDirs: ['/new/雪', '/second'],
        provider: 'unknown',
        model: '',
        startTime: START_FACT.startTime,
      });
    } finally {
      await result.boot.close();
      await result.recording.dispose();
    }
  });
});
