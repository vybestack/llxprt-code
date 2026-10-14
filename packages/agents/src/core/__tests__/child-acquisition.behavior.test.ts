/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { realpath } from 'node:fs/promises';
import {
  MessageBusType,
  ConfirmationOutcome,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { useOwnedCredentials } from '../../api/__tests__/helpers/owned-credential-fixture.js';
import { withDisposalJoinFixture } from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';

describe('child acquired resource lifetime', () => {
  const credentials = useOwnedCredentials();

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
      const orchestrator = new SubagentOrchestrator({
        credentialAuthority: authority,
        workspaceTrust: fixture.workspaceTrust,
        createChildSettings: () => fixture.settingsOwner.createChildStore(),
        readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
        toolRegistry: fixture.agent.agentClient.tools,
        workspacePaths: fixture.workspacePaths,
        instructions: fixture.instructionReads,
        foregroundConfig: fixture.config,
        subagentManager: fixture.agent.workspace.subagentDefinitions,
        profileManager: fixture.agent.workspace.profileDefinitions,
        messageBus: bus,
        readMcpInstructions: fixture.readMcpInstructions,
      });
      await expect(
        orchestrator.launch({ name: 'disposal-child' }),
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
      const orchestrator = new SubagentOrchestrator({
        credentialAuthority: credentials().authority,
        workspaceTrust: fixture.workspaceTrust,
        createChildSettings: () => fixture.settingsOwner.createChildStore(),
        readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
        toolRegistry: fixture.agent.agentClient.tools,
        workspacePaths: fixture.workspacePaths,
        instructions: fixture.instructionReads,
        foregroundConfig: fixture.config,
        subagentManager: fixture.agent.workspace.subagentDefinitions,
        profileManager: fixture.agent.workspace.profileDefinitions,
        messageBus: new MessageBus(),
        readMcpInstructions: fixture.readMcpInstructions,
      });
      const child = await orchestrator.launch({ name: 'disposal-child' });
      expect(child.runtime.runtimeContext.state.model).toBe('child-model');
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
