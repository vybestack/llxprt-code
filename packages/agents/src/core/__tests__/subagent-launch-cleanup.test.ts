import { createTestChildOrchestrator } from './child-launch-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';

import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { withDisposalJoinFixture } from '../../api/__tests__/helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from '../../api/__tests__/helpers/owned-credential-fixture.js';
import { AggregateDisposeError } from '../../api/disposeErrors.js';

const parentSignal = new AbortController().signal;

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

describe('subagent cleanup error retention', () => {
  const credentials = useOwnedCredentials();

  it.each(['activation', 'loader', 'scope', 'history'])(
    'retains the %s failure and the isolated runtime cleanup failure',
    async (stage) => {
      await withDisposalJoinFixture(async (fixture) => {
        const secondary = new Error('isolated token transport close failed');
        const scopeFailure = new Error('child scope creation failed');
        const historyFailure = new Error('child history disposal failed');
        const transport = failingTransportClose(
          credentials().authority,
          secondary,
        );
        const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
        const missingReplay = join(
          fixture.config.getWorkingDir(),
          'missing-child.responses',
        );
        let retiredHistory:
          | Awaited<ReturnType<typeof loadAgentRuntime>>['history']
          | undefined;
        const toolRegistry = await fixture.parentTools();
        try {
          if (stage === 'activation')
            process.env.LLXPRT_FAKE_RESPONSES = missingReplay;
          const orchestrator = createTestChildOrchestrator({
            credentialAuthority: transport.authority,
            workspaceTrust: fixture.workspaceTrust,
            createChildSettings: () => fixture.settingsOwner.createChildStore(),
            readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
            toolRegistry,
            workspacePaths: fixture.workspacePaths,
            instructions: fixture.instructionReads,
            foregroundConfig: fixture.config,
            subagentManager: fixture.agent.workspace.subagentDefinitions,
            profileManager: fixture.agent.workspace.profileDefinitions,
            messageBus: new MessageBus(),
            readMcpInstructions: fixture.readMcpInstructions,
            scopeFactory:
              stage === 'scope' || stage === 'history'
                ? () => Promise.reject(scopeFailure)
                : undefined,
            runtimeLoader: async (options) => {
              const bundle = await loadAgentRuntime({
                ...options,
                profile: {
                  ...options.profile,
                  ...(stage === 'loader'
                    ? { contentGeneratorConfig: undefined }
                    : {}),
                },
              });
              if (stage === 'history') {
                retiredHistory = bundle.history;
                const dispose = bundle.history.dispose.bind(bundle.history);
                bundle.history.dispose = async () => {
                  await dispose();
                  throw historyFailure;
                };
              }
              return bundle;
            },
          });
          let failure: unknown;
          try {
            await orchestrator.launch({ name: 'disposal-child' }, parentSignal);
          } catch (error) {
            failure = error;
          }
          expect(credentials().snapshot()).toStrictEqual([1]);
          expect(failure).toBeInstanceOf(AggregateDisposeError);
          if (!(failure instanceof AggregateDisposeError)) throw failure;
          const failures = flatten(failure);
          expect(
            failures.filter((error) => error === historyFailure),
          ).toHaveLength(stage === 'history' ? 1 : 0);
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
                      : scopeFailure.message,
                },
          );
          expect(failures.slice(1, -1)).toStrictEqual(
            stage === 'history' ? [historyFailure] : [],
          );
          await expect(
            retiredHistory?.openDumpSnapshot() ??
              Promise.reject(new Error('not acquired')),
          ).rejects.toThrow(
            stage === 'history' ? /disposed|closed|retired/i : /not acquired/,
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
