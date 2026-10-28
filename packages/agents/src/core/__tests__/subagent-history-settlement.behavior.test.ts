import { createTestChildOrchestrator } from './child-launch-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { describe, expect, it } from 'bun:test';
import { link } from 'node:fs/promises';
import { join } from 'node:path';
import { withDisposalJoinFixture } from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from '../../api/__tests__/helpers/owned-credential-fixture.js';
import { AggregateDisposeError } from '../../api/disposeErrors.js';
import { SubAgentScope } from '../subagent.js';

const parentSignal = new AbortController().signal;

function flatten(error: unknown): unknown[] {
  return error instanceof AggregateDisposeError ||
    error instanceof AggregateError
    ? error.errors.flatMap(flatten)
    : [error];
}

describe('subagent history ownership settlement', () => {
  const credentials = useOwnedCredentials();

  it.each(['scope failure', 'completed scope'])(
    'joins admitted media release failures during %s cleanup',
    async (stage) => {
      await withDisposalJoinFixture(async (fixture) => {
        const primary = new Error('scope construction failed');
        const releaseFailure = new Error('reservation directory sync failed');
        let releasing = false;
        let releaseAttempts = 0;
        const store = new LocalMediaStore({
          rootDirectory: join(fixture.config.getWorkingDir(), 'child-media'),
          quotaBytes: 1024 * 1024,
          fileOperations: {
            link,
            syncDirectory: async (path): Promise<void> => {
              if (
                releasing &&
                path === join(store.rootDirectory, 'references', 'sha256')
              ) {
                releaseAttempts += 1;
                throw releaseFailure;
              }
            },
          },
        });
        try {
          const orchestrator = createTestChildOrchestrator({
            credentialAuthority: credentials().authority,
            workspaceTrust: fixture.workspaceTrust,
            createChildSettings: () => fixture.settingsOwner.createChildStore(),
            readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
            toolRegistry: await fixture.parentTools(),
            workspacePaths: fixture.workspacePaths,
            instructions: fixture.instructionReads,
            foregroundConfig: fixture.config,
            subagentManager: fixture.agent.workspace.subagentDefinitions,
            profileManager: fixture.agent.workspace.profileDefinitions,
            messageBus: new MessageBus(),
            readMcpInstructions: fixture.readMcpInstructions,
            runtimeLoader: async (options) => {
              const bundle = await loadAgentRuntime({
                ...options,
                mediaStore: store,
              });
              const admitted = await new MediaAdmissionService(
                store,
              ).admitContent(
                {
                  speaker: 'human',
                  blocks: [
                    {
                      type: 'media',
                      encoding: 'base64',
                      mimeType: 'image/png',
                      data: 'AQIDBA==',
                    },
                  ],
                },
                { turnId: 'child-media-turn', source: 'clipboard' },
              );
              await bundle.history.replaceAll([admitted]);
              expect(bundle.history.getAll()).toHaveLength(1);
              await bundle.history.waitForOwnershipSettlement();
              releasing = true;
              return bundle;
            },
            scopeFactory: async (...args) => {
              if (stage === 'scope failure') throw primary;
              return SubAgentScope.create(...args);
            },
          });
          let failure: unknown;
          try {
            const child = await orchestrator.launch(
              { name: 'disposal-child' },
              parentSignal,
            );
            await child.dispose();
          } catch (error) {
            failure = error;
          }
          expect(failure).toBeInstanceOf(AggregateDisposeError);
          expect(flatten(failure)).toStrictEqual(
            stage === 'scope failure'
              ? [primary, releaseFailure]
              : [releaseFailure],
          );
          expect(releaseAttempts).toBe(1);
          expect(credentials().snapshot()).toStrictEqual([1]);
          expect(fixture.settingsOwner.readSelectedModel()).toBe(
            'parent-model',
          );
        } finally {
          await store.close();
        }
      });
    },
    30000,
  );
});
