import { collectResumeRows } from '../../__tests__/resumeRows.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useOperationalOutput } from '../../__tests__/operational-output-fixture.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { bindCommandErrorRecorder } from '../hooks/commandErrorRecorderHost.js';
import { bindClearSession } from './simpleCommandHost.js';
import { createClearCommand } from './clearCommand.js';

async function recordingPath(owner: Agent): Promise<string> {
  await owner.setHistory([
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'record session ownership' }],
    },
  ]);
  await owner.session.setRecording({ enabled: true });
  const path = owner.session.getRecording().path;
  if (!path) throw new Error('Missing recording path');
  return path;
}

async function runClear(owner: Agent, decoy: Agent): Promise<void> {
  const endSession = Object.assign(
    owner.hooks.triggerSessionEnd.bind(owner.hooks),
    {
      hooks: decoy.hooks,
      session: decoy.session,
    },
  );
  const command = createClearCommand(
    bindClearSession(
      endSession,
      owner.session.startNewSession.bind(owner.session),
      owner.hooks.triggerSessionStart.bind(owner.hooks),
    ),
    () => {},
    () => 0,
    () => {},
    () => {},
  );
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        { ...createUnconfiguredBuiltinOwners(), clearCommand: command },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const action = registry
    .getCommands()
    .find((entry) => entry.name === 'clear')?.action;
  if (!action) throw new Error('Missing registered clear action');
  await action(createMockCommandContext(), '');
}

describe('session command operation ownership', () => {
  const makeOwner = useCommandOwners();
  const operationalOutput = useOperationalOutput();
  it('records command errors through its captured event operation rather than a callable legacy session', async () => {
    const owner = await makeOwner('error-operation-owner');
    const sibling = await makeOwner('error-operation-sibling');
    const ownerPath = await recordingPath(owner);
    const siblingPath = await recordingPath(sibling);
    const writeEvent = Object.assign(
      owner.session.recordRecordingEvent.bind(owner.session),
      { session: sibling.session },
    );
    await bindCommandErrorRecorder(
      writeEvent,
      'agent',
      undefined,
    )('captured command error');
    expect(operationalOutput()).toContain(
      '[SessionRecording] error: captured command error',
    );
    expect(await readFile(ownerPath, 'utf8')).not.toContain(
      'captured command error',
    );
    expect(await readFile(siblingPath, 'utf8')).not.toContain(
      'captured command error',
    );
    const decoySession = owner.session;
    await owner.dispose();
    const survivingEvent = Object.assign(
      sibling.session.recordRecordingEvent.bind(sibling.session),
      { session: decoySession },
    );
    await bindCommandErrorRecorder(
      survivingEvent,
      'agent',
      undefined,
    )('surviving command error');
    expect(operationalOutput()).toContain(
      '[SessionRecording] error: surviving command error',
    );
    expect(await readFile(siblingPath, 'utf8')).not.toContain(
      'surviving command error',
    );
  });
  it('clears the registered session through independent hook and session operations', async () => {
    const owner = await makeOwner('clear-operation-owner');
    const sibling = await makeOwner('clear-operation-sibling');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'owner conversation before clear' }],
      },
    ]);
    await sibling.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'sibling conversation before clear' }],
      },
    ]);
    await runClear(owner, sibling);
    expect(await collectResumeRows(owner.streamHistory())).toStrictEqual([]);
    expect(
      JSON.stringify(await collectResumeRows(sibling.streamHistory())),
    ).toContain('sibling conversation before clear');
    const decoy = { hooks: owner.hooks, session: owner.session };
    await owner.dispose();
    const ending = Object.assign(
      sibling.hooks.triggerSessionEnd.bind(sibling.hooks),
      decoy,
    );
    const clear = bindClearSession(
      ending,
      sibling.session.startNewSession.bind(sibling.session),
      sibling.hooks.triggerSessionStart.bind(sibling.hooks),
    );
    if (!clear) throw new Error('Missing captured surviving clear operation');
    await clear.endSession();
    await clear.startNewSession();
    await clear.startSession();
    expect(await collectResumeRows(sibling.streamHistory())).toStrictEqual([]);
  });
});
