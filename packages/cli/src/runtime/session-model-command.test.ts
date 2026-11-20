import { captureSessionOwner } from '../../../agents/src/api/__tests__/helpers/capture-session-owner.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildFactoryLessConfig } from '../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import { createModelCommand } from '../ui/commands/modelCommand.js';
import { handleMessageResult } from '../ui/hooks/slash-command-messages.js';
import { writeSlashOutput } from '../ui/hooks/slash-journal-output.js';
import { readJournalItems } from '../ui/stores/turn/read-journal-items.js';
import { createSessionModelCommand } from './session-model-command.js';

describe('session model command', () => {
  it.each(['fake-model', 'fake-model-next'])(
    'keeps the switch notice in the active session journal when selecting %s',
    async (model) => {
      const built = await buildFactoryLessConfig('plain-text.jsonl');
      const { value: agent, owner } = await captureSessionOwner(() =>
        fromConfig(
          built.config,
          built.settingsService,
          {
            activation: {
              provider: built.config.getProvider(),
              model: built.config.getModel(),
            },
          },
          new CredentialAuthority(),
        ),
      );
      const client = owner.clients.getAgentClient();
      const modelCommand = createModelCommand(
        createSessionModelCommand(agent),
        (provider, model) =>
          agent.session.recordRecordingEvent({
            type: 'provider_switch',
            provider,
            model,
          }),
      );
      try {
        await agent.session.setRecording({ enabled: true });
        const rawOutput = (): never => {
          throw new Error('Agent-owned output must be journaled');
        };
        await writeSlashOutput(
          client.getHistoryService(),
          agent.session,
          'agent',
          'user',
          `/model ${model}`,
          rawOutput,
        );
        const path = agent.session.getRecording().path;
        if (!path) throw new Error('Missing original journal');
        const context = createMockCommandContext({
          recordingOwner: 'agent',
          services: { agent },
          runtimeApi: { setActiveModel: createSessionModelCommand(agent) },
        });

        const result = await modelCommand.action?.(context, model);
        if (result?.type !== 'message') throw new Error('Missing model notice');
        await handleMessageResult(
          rawOutput,
          undefined,
          client.getHistoryService(),
          agent.session,
          'agent',
          result,
        );

        expect(agent.getModel()).toBe(model);
        expect(client.getHistoryService()?.journalPath()).toBe(path);
        const items = await readJournalItems(agent);
        expect(items).toMatchObject([
          { type: 'user', text: `/model ${model}` },
          {
            type: 'info',
            text: `Switched from fake-model to ${model} in provider 'fake'`,
          },
        ]);
      } finally {
        await agent.dispose();
        await built.cleanup();
      }
    },
  );
});
