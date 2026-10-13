/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import { describe, expect, it } from 'bun:test';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { isMediaReferenceBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { AggregateDisposeError } from '../../api/disposeErrors.js';
import { withDisposalJoinFixture } from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from '../../api/__tests__/helpers/owned-credential-fixture.js';

function flatten(error: unknown): unknown[] {
  return error instanceof AggregateDisposeError ||
    error instanceof AggregateError
    ? error.errors.flatMap(flatten)
    : [error];
}

function failingTransportClose(
  authority: CredentialAuthority,
  failure: Error,
): { authority: CredentialAuthority; restore: () => void } {
  const restores: Array<() => void> = [];
  return {
    authority: new (class extends CredentialAuthority {
      override createProviderKeyStorage(): ReturnType<
        CredentialAuthority['createProviderKeyStorage']
      > {
        return authority.createProviderKeyStorage();
      }

      override createTokenStore(): ProxyTokenStore {
        const store = authority.createTokenStore();
        if (!(store instanceof ProxyTokenStore))
          throw new Error('Expected owned proxy token transport');
        const client = store.getClient();
        const close = client.close.bind(client);
        client.close = (): void => {
          close();
          throw failure;
        };
        restores.push(() => {
          client.close = close;
        });
        return store;
      }
    })(),
    restore: (): void => {
      for (const restore of restores) restore();
    },
  };
}

async function obstructHistoryRelease(
  options: Parameters<typeof loadAgentRuntime>[0],
  history: Awaited<ReturnType<typeof loadAgentRuntime>>['history'],
): Promise<string> {
  const content = await new MediaAdmissionService(
    options.mediaStore,
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
    { turnId: 'failed-child-history', source: 'clipboard' },
  );
  await history.replaceAll([content]);
  await history.waitForOwnershipSettlement();
  const reference = content.blocks.find(isMediaReferenceBlock);
  if (reference === undefined)
    throw new Error('Missing admitted history media');
  const directory = join(
    options.mediaStore.rootDirectory,
    'references',
    'sha256',
    reference.contentId.slice('sha256:'.length),
  );
  const records = await readdir(directory);
  if (records.length !== 1) throw new Error('Expected one history reservation');
  const reservation = join(directory, records[0]);
  await rm(reservation);
  await mkdir(reservation);
  return reference.contentId;
}

describe('subagent cleanup error retention', () => {
  const credentials = useOwnedCredentials();

  it.each(['activation', 'loader', 'scope', 'history'])(
    'retains the %s failure and the isolated runtime cleanup failure',
    async (stage) => {
      await withDisposalJoinFixture(async (fixture) => {
        const secondary = new Error('isolated token transport close failed');
        const transport = failingTransportClose(
          credentials().authority,
          secondary,
        );
        const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
        const missingReplay = join(
          fixture.config.getWorkingDir(),
          'missing-child.responses',
        );
        let historyContentId: string | undefined;
        try {
          if (stage === 'activation')
            process.env.LLXPRT_FAKE_RESPONSES = missingReplay;
          const orchestrator = new SubagentOrchestrator({
            credentialAuthority: transport.authority,
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
            runtimeLoader: async (options) => {
              const bundle = await loadAgentRuntime({
                ...options,
                profile: {
                  ...options.profile,
                  ...(stage === 'loader'
                    ? { contentGeneratorConfig: undefined }
                    : { toolRegistry: undefined }),
                },
              });
              if (stage === 'history')
                historyContentId = await obstructHistoryRelease(
                  options,
                  bundle.history,
                );
              return bundle;
            },
          });
          let failure: unknown;
          try {
            await orchestrator.launch({ name: 'disposal-child' });
          } catch (error) {
            failure = error;
          }
          expect(credentials().snapshot()).toStrictEqual([1]);
          expect(failure).toBeInstanceOf(AggregateDisposeError);
          if (!(failure instanceof AggregateDisposeError)) throw failure;
          const failures = flatten(failure);
          expect(failures).toHaveLength(stage === 'history' ? 3 : 2);
          expect(failures[failures.length - 1]).toBe(secondary);
          const primary = failures[0];
          expect(primary).toMatchObject(
            stage === 'activation'
              ? { code: 'ENOENT', path: missingReplay }
              : {
                  message:
                    stage === 'loader'
                      ? 'AgentRuntimeLoader requires contentGeneratorConfig when no contentGenerator override is supplied.'
                      : 'SubAgentScope.create requires a ToolRegistry in the runtime bundle or overrides.',
                },
          );
          expect(failures.slice(1, -1)).toMatchObject(
            stage === 'history'
              ? [
                  {
                    name: 'MediaStoreError',
                    contentId: historyContentId,
                    cause: { code: 'EISDIR' },
                  },
                ]
              : [],
          );
          expect(fixture.settingsOwner.readSelectedModel()).toBe(
            'parent-model',
          );
        } finally {
          transport.restore();
          if (previousReplay === undefined)
            delete process.env.LLXPRT_FAKE_RESPONSES;
          else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
        }
      });
    },
    30000,
  );
});
