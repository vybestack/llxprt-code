/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { TokenUsageLogger } from '../TokenUsageLogger.js';
import { SerializedTokenUsageTurnRecordSchema } from '../tokenUsageRecords.js';
import { createTestChildOrchestrator } from './child-launch-fixture.js';
import {
  fakeChildScope,
  fixtureToolSelection,
  makeForegroundConfig,
} from './subagentOrchestrator-test-helpers.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

describe('Subagent session identity', () => {
  it('attributes a child launched after a session change and its token record to the current session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subagent-session-id-'));
    const config = makeForegroundConfig();
    const settings = createSessionSettingsFixture(config);
    const log = join(directory, 'usage.jsonl');
    const logger = new TokenUsageLogger(true, log);
    const orchestrator = createTestChildOrchestrator({
      credentialAuthority: new CredentialAuthority(),
      workspaceTrust: settings.workspaceTrust,
      createChildSettings: () => settings.settingsOwner.createChildStore(),
      readRunPolicy: () => settings.settingsOwner.readSubagentRunPolicy(),
      instructions: emptyInstructionReads,
      toolRegistry: fixtureToolSelection(),
      workspacePaths: installTestWorkspacePaths({
        targetDir: process.cwd(),
        isTrusted: () => true,
      })(),
      readMcpInstructions: () => undefined,
      subagentManager: {
        listSubagents: async () => [],
        loadSubagent: async () => ({
          name: 'helper',
          profile: 'child',
          systemPrompt: 'Assist.',
          createdAt: '2026-10-27',
          updatedAt: '2026-10-27',
        }),
      },
      profileManager: {
        loadProfile: async () => ({
          version: 1,
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          modelParams: {},
          ephemeralSettings: {},
        }),
      },
      foregroundConfig: config,
      scopeFactory: async () => fakeChildScope(),
      runtimeLoader: async (options) => {
        const loaded = await loadAgentRuntime(options);
        const state = loaded.runtimeContext.state;
        logger.attachTurnContext('child-turn', {
          runtimeId: state.runtimeId,
          sessionId: state.sessionId,
          parentRuntimeId: state.parentRuntimeId,
          subagentName: state.subagentName,
        });
        logger.recordEstimate('child-turn', {
          provider: state.provider,
          model: state.model,
          estimatedTokens: 5,
          estimator: 'core-fallback',
          tiktokenTokens: null,
        });
        await logger.recordActual('child-turn', {
          actualPromptTokens: 6,
          cachedTokens: 0,
        });
        return loaded;
      },
      messageBus: new MessageBus(),
    });
    config.adoptSessionId('resumed-session');
    try {
      const child = await orchestrator.launch(
        { name: 'helper' },
        new AbortController().signal,
      );
      try {
        const record = SerializedTokenUsageTurnRecordSchema.parse(
          JSON.parse(await readFile(log, 'utf8')),
        );
        expect(child.identity.runtimeId).toStartWith('resumed-session#helper#');
        expect(child.identity.sessionId).toStartWith('resumed-session::');
        expect(record.runtime_id).toBe(child.identity.runtimeId);
        expect(record.session_id).toBe(child.identity.sessionId);
        expect(record.parent_runtime_id).toBe('resumed-session');
      } finally {
        await child.dispose();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
