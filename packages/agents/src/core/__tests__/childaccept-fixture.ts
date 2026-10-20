/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { ResumeCursorBoot } from '@vybestack/llxprt-code-core/recording/resumeCursorBoot.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { readJournalFileFacts } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import {
  JournalResumeBoot,
  resumePointOf,
} from '@vybestack/llxprt-code-core/recording/journalResume.js';
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { dirname, join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  createSessionSettingsFixture,
  subagentSessionPorts,
} from '../../api/__tests__/helpers/session-settings-fixture.js';
import { fixtureToolSelection } from './subagentOrchestrator-test-helpers.js';
import {
  SubagentOrchestrator,
  type SubagentLaunchResult,
} from '../subagentOrchestrator.js';

const createWorkspaceFilesystem = installTestWorkspaceFilesystem();

export async function acceptanceDirectory(
  prefix: string,
  parent = tmpdir(),
): Promise<string> {
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
}

export async function launchAcceptanceChild(
  directory: string,
  baseUrl: string,
): Promise<{
  child: SubagentLaunchResult;
  config: Config;
  close(): Promise<void>;
}> {
  await mkdir(directory, { recursive: true });
  const config = new Config({
    sessionId: 'childaccept-parent',
    targetDir: directory,
    cwd: directory,
    debugMode: false,
    model: 'gpt-5.2',
    usageStatisticsEnabled: false,
  });
  const session = createSessionSettingsFixture(config);
  const workspace = createWorkspaceFilesystem({
    targetDir: directory,
    isTrusted: () => true,
  });
  const profileManager = new ProfileManager(join(directory, 'profiles'));
  await profileManager.saveProfile('local', {
    version: 1,
    provider: 'openai-responses',
    model: 'gpt-5.2',
    modelParams: {},
    ephemeralSettings: {
      'auth-key': 'childaccept-not-a-credential',
      'base-url': baseUrl,
      'prompt-caching': 'off',
      'responses-stateful': true,
    },
  });
  const subagentManager = new SubagentManager(
    join(directory, 'subagents'),
    profileManager,
  );
  await subagentManager.saveSubagent('child', 'local', 'child acceptance');
  const orchestrator = new SubagentOrchestrator({
    ...subagentSessionPorts(session),
    instructions: emptyInstructionReads,
    toolRegistry: fixtureToolSelection(),
    workspacePaths: workspace.paths,
    readMcpInstructions: () => undefined,
    subagentManager,
    profileManager,
    foregroundConfig: config,
    messageBus: new MessageBus(),
  });
  const child = await orchestrator.launch({
    name: 'child',
    toolConfig: { tools: [] },
  });
  return {
    child,
    config,
    close: async () => {
      await child.dispose();
      await config.dispose();
    },
  };
}

export function childJournalExtension(): '.jsonl' | '.llxj' {
  return selectBackend() === 'journal' ? '.llxj' : '.jsonl';
}

export async function openChildResumeBoot(path: string): Promise<{
  streamRows(): AsyncIterable<IContent>;
  close(): Promise<void>;
}> {
  if (selectBackend() === 'old')
    return ResumeCursorBoot.open(path, 10000, (await stat(path)).size);
  const found = await readJournalFileFacts(path);
  if (found === undefined) throw new Error('Missing committed child facts');
  const { facts } = found;
  const recording = await JournalRecordingService.open(
    {
      sessionId: facts.sessionId,
      projectHash: facts.start.projectHash,
      chatsDir: dirname(path),
      workspaceDirs: facts.directories,
      provider: facts.provider,
      model: facts.model,
    },
    path,
  );
  const boot = new JournalResumeBoot(recording, await resumePointOf(recording));
  return {
    streamRows: () => boot.streamRows(),
    close: () => recording.dispose(),
  };
}
