/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
import {
  createScopeFactory,
  fixtureToolSelection,
  makeForegroundConfig,
} from './subagentOrchestrator-test-helpers.js';

const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

describe('child Config and journal ownership', () => {
  it.each([false, true])(
    'disposes the isolated Config while the journal is still open (scope failure: %s)',
    async (scopeFails) => {
      const dir = await mkdtemp(join(tmpdir(), 'critical-child-journal-'));
      const profiles = new ProfileManager(join(dir, 'profiles'));
      const subagents = new SubagentManager(join(dir, 'subagents'), profiles);
      await profiles.saveProfile('critical-child', {
        version: 1,
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        modelParams: {},
        ephemeralSettings: { 'auth-key': 'test-api-key' },
      });
      await subagents.saveSubagent(
        'critical-child',
        'critical-child',
        'Inspect the supplied task.',
      );
      const foreground = makeForegroundConfig();
      const chatsDir = foreground.projectChatsDir;
      const foregroundSettings = createSessionSettingsFixture(foreground);
      const failure = new Error('scope creation sentinel');
      const { factory } = createScopeFactory();
      if (scopeFails) factory.mockRejectedValue(failure);
      let journalExistedDuringConfigDispose = false;
      const priorSubscriptions = coreEvents.listenerCount(
        CoreEvent.ModelChanged,
      );
      const orchestrator = new SubagentOrchestrator({
        workspaceTrust: foregroundSettings.workspaceTrust,
        createChildSettings: () =>
          foregroundSettings.settingsOwner.createChildStore(),
        readRunPolicy: () =>
          foregroundSettings.settingsOwner.readSubagentRunPolicy(),
        instructions: emptyInstructionReads,
        toolRegistry: fixtureToolSelection(),
        workspacePaths: fixturePaths(),
        readMcpInstructions: () => undefined,
        subagentManager: subagents,
        profileManager: profiles,
        foregroundConfig: foreground,
        messageBus: new MessageBus(),
        scopeFactory: factory,
        runtimeLoader: async (options) => {
          const history = options.overrides?.historyService;
          if (!history)
            throw new Error('Child must use the real journal-backed history');
          const childConfig = options.profile.config;
          expect(
            coreEvents.listenerCount(CoreEvent.ModelChanged),
          ).toBeGreaterThan(priorSubscriptions);
          const dispose = childConfig.dispose.bind(childConfig);
          childConfig.dispose = async (): Promise<void> => {
            const paths = await readdir(chatsDir);
            journalExistedDuringConfigDispose ||= paths.some(
              (p) => p.endsWith('.jsonl') && existsSync(join(chatsDir, p)),
            );
            await dispose();
          };
          return loadAgentRuntime(options);
        },
      });
      try {
        const outcome = await orchestrator
          .launch({ name: 'critical-child' })
          .then(
            async (result) => {
              await result.dispose();
              await result.dispose();
              return undefined;
            },
            (error: unknown) => error,
          );
        expect(outcome).toBe(scopeFails ? failure : undefined);
        expect(journalExistedDuringConfigDispose).toBe(true);
        expect(coreEvents.listenerCount(CoreEvent.ModelChanged)).toBe(
          priorSubscriptions,
        );
        expect(
          (await readdir(chatsDir)).filter((p) => p.endsWith('.jsonl')),
        ).toStrictEqual([]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
