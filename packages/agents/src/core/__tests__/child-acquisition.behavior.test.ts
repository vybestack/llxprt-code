import { createTestChildOrchestrator } from './child-launch-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import {
  ConfirmationOutcome,
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { describe, expect, it } from 'bun:test';
import { realpath } from 'node:fs/promises';
import { withDisposalJoinFixture } from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from '../../api/__tests__/helpers/owned-credential-fixture.js';

const parentSignal = new AbortController().signal;

describe('child acquired resource lifetime', () => {
  const credentials = useOwnedCredentials();

  it('joins an accepted child HTTP run before releasing its credentials and leaves its same-label sibling usable', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const orchestrator = createTestChildOrchestrator({
        credentialAuthority: credentials().authority,
        workspaceTrust: fixture.workspaceTrust,
        createChildSettings: () => fixture.settingsOwner.createChildStore(),
        readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
        toolRegistry: fixture.client.tools,
        workspacePaths: fixture.workspacePaths,
        instructions: fixture.instructionReads,
        foregroundConfig: fixture.config,
        subagentManager: fixture.agent.workspace.subagentDefinitions,
        profileManager: fixture.agent.workspace.profileDefinitions,
        messageBus: new MessageBus(),
        readMcpInstructions: fixture.readMcpInstructions,
      });
      const first = await orchestrator.launch(
        { name: 'disposal-child' },
        parentSignal,
      );
      const sibling = await orchestrator.launch(
        { name: 'disposal-child' },
        parentSignal,
      );
      fixture.manager.registerTask({
        id: first.agentId,
        subagentName: 'disposal-child',
        goalPrompt: 'Observe direct child disposal',
        abortController: new AbortController(),
      });
      const events: string[] = [];
      let credentialsAtRunSettled: readonly number[] | undefined;
      const running = first.scope.runNonInteractive(new ContextState());
      const recordRunSettled = (): void => {
        credentialsAtRunSettled = credentials().keySnapshot();
        events.push('run-settled');
      };
      const settled = running.then(recordRunSettled, recordRunSettled);
      try {
        await fixture.entered.promise;
        await first.dispose().then(() => {
          events.push('dispose-closed');
        });
        await settled;
        await fixture.aborted;
        expect(fixture.signal()?.aborted).toBe(true);
        expect(events).toStrictEqual(['run-settled', 'dispose-closed']);
        expect(credentialsAtRunSettled).toStrictEqual([0, 0]);
        expect(credentials().keySnapshot()).toStrictEqual([1, 0]);
        fixture.releaseWork();
        await sibling.scope.runNonInteractive(new ContextState());
        expect(sibling.scope.output.terminate_reason).not.toBe('ERROR');
        expect(sibling.scope.output.final_message).toContain('child completed');
        expect(fixture.settingsOwner.readSelectedModel()).toBe('parent-model');
      } finally {
        fixture.releaseWork();
        await settled;
        await first.dispose();
        await sibling.dispose();
        fixture.manager.cancelTask(first.agentId);
      }
      expect(credentials().keySnapshot()).toStrictEqual([1, 1]);
    });
  }, 30000);

  it('joins acquired key cleanup when child token acquisition fails without retiring parent resources', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const primary = new Error('child token transport unavailable');
      const authority = new (class extends CredentialAuthority {
        override createProviderKeyStorage(): ReturnType<
          CredentialAuthority['createProviderKeyStorage']
        > {
          return credentials().authority.createProviderKeyStorage();
        }
        override createTokenStore(): ReturnType<
          CredentialAuthority['createTokenStore']
        > {
          throw primary;
        }
      })();
      const bus = new MessageBus();
      const orchestrator = createTestChildOrchestrator({
        credentialAuthority: authority,
        workspaceTrust: fixture.workspaceTrust,
        createChildSettings: () => fixture.settingsOwner.createChildStore(),
        readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
        toolRegistry: fixture.client.tools,
        workspacePaths: fixture.workspacePaths,
        instructions: fixture.instructionReads,
        foregroundConfig: fixture.config,
        subagentManager: fixture.agent.workspace.subagentDefinitions,
        profileManager: fixture.agent.workspace.profileDefinitions,
        messageBus: bus,
        readMcpInstructions: fixture.readMcpInstructions,
      });
      await expect(
        orchestrator.launch({ name: 'disposal-child' }, parentSignal),
      ).rejects.toBe(primary);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
      expect(credentials().snapshot()).toStrictEqual([]);
      expect(fixture.settingsOwner.readSelectedModel()).toBe('parent-model');
      const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (request) => {
          bus.respondToConfirmation(
            request.correlationId,
            ConfirmationOutcome.ProceedOnce,
          );
        },
      );
      try {
        expect(await bus.requestConfirmation({ name: 'read_file' }, {})).toBe(
          true,
        );
      } finally {
        unsubscribe();
      }
      expect(fixture.workspacePaths.directories()).toContain(
        await realpath(fixture.config.getTargetDir()),
      );
    });
  }, 30000);

  it('joins concurrent whole-child disposal exactly once and preserves its borrowed parent', async () => {
    await withDisposalJoinFixture(async (fixture) => {
      const orchestrator = createTestChildOrchestrator({
        credentialAuthority: credentials().authority,
        workspaceTrust: fixture.workspaceTrust,
        createChildSettings: () => fixture.settingsOwner.createChildStore(),
        readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
        toolRegistry: fixture.client.tools,
        workspacePaths: fixture.workspacePaths,
        instructions: fixture.instructionReads,
        foregroundConfig: fixture.config,
        subagentManager: fixture.agent.workspace.subagentDefinitions,
        profileManager: fixture.agent.workspace.profileDefinitions,
        messageBus: new MessageBus(),
        readMcpInstructions: fixture.readMcpInstructions,
      });
      const child = await orchestrator.launch(
        { name: 'disposal-child' },
        parentSignal,
      );
      expect(child.identity.model).toBe('child-model');
      expect(credentials().keySnapshot()).toStrictEqual([0]);
      expect(credentials().snapshot()).toStrictEqual([0]);
      const closing = [child.dispose(), child.dispose(), child.dispose()];
      expect(new Set(closing).size).toBe(1);
      await Promise.all(closing);
      expect(credentials().keySnapshot()).toStrictEqual([1]);
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(fixture.settingsOwner.readSelectedModel()).toBe('parent-model');
      expect(fixture.workspacePaths.directories()).toContain(
        await realpath(fixture.config.getTargetDir()),
      );
    });
  }, 30000);
});
