/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { AgentClient } from '../../core/client.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { createSessionClientEngineFixture } from './helpers/session-client-engine-fixture.js';

type Fixture = Awaited<ReturnType<typeof createSessionClientEngineFixture>>;

interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}

function createGate(): Gate {
  let open: () => void = () => {
    throw new Error('Gate was not initialised');
  };
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

function createOwnerWithClient(
  built: Fixture,
  createClient: (
    ...args: ConstructorParameters<typeof AgentClient>
  ) => AgentClient,
): Promise<SessionClientOwner> {
  return SessionClientOwner.create(
    built.config,
    assembleTaskSchemaPolicy(built.settingsService),
    built.handle.providerManager,
    (config, state, instructions, store) => {
      if (store === undefined) throw new Error('Missing factory store');
      return createClient(
        config,
        state,
        instructions ?? (() => undefined),
        store,
        built.mcp.workspacePaths,
      );
    },
    built.media.store,
    built.mcp.readInstructions,
    built.mcp.workspacePaths,
    built.handle.settingsOwner,
    built.handle.contentGeneratorFactory,
    built.handle.tokenizerFactory,
  );
}

describe('Factory-created session client acquisition', () => {
  it('rejects with the binding error only after the abandoned client is disposed', async () => {
    const built = await createSessionClientEngineFixture();
    const releaseDisposal = createGate();
    const disposalStarted = createGate();
    const events: string[] = [];
    const bindingError = new Error('binding boom');
    class BindingFailureClient extends AgentClient {
      override bindProviderInvocation(): void {
        throw bindingError;
      }
      override async dispose(): Promise<void> {
        events.push('dispose-started');
        disposalStarted.open();
        await releaseDisposal.opened;
        await super.dispose();
        events.push('dispose-finished');
      }
    }
    try {
      const construction = createOwnerWithClient(
        built,
        (...args) => new BindingFailureClient(...args),
      ).then(
        () => events.push('constructed'),
        (error: unknown) => {
          events.push('rejected');
          return error;
        },
      );
      await disposalStarted.opened;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(events).toStrictEqual(['dispose-started']);

      releaseDisposal.open();
      const error = await construction;

      expect(events).toStrictEqual([
        'dispose-started',
        'dispose-finished',
        'rejected',
      ]);
      expect(error).toBe(bindingError);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('rejects with the binding and disposal failures after disposal settles', async () => {
    const built = await createSessionClientEngineFixture();
    const releaseDisposal = createGate();
    const disposalStarted = createGate();
    const events: string[] = [];
    const bindingError = new Error('binding boom');
    const disposalError = new Error('dispose boom');
    class BindingFailureClient extends AgentClient {
      override bindProviderInvocation(): void {
        throw bindingError;
      }
      override async dispose(): Promise<void> {
        events.push('dispose-started');
        disposalStarted.open();
        await releaseDisposal.opened;
        await super.dispose();
        events.push('dispose-finished');
        throw disposalError;
      }
    }
    try {
      const construction = createOwnerWithClient(
        built,
        (...args) => new BindingFailureClient(...args),
      ).then(
        () => events.push('constructed'),
        (error: unknown) => {
          events.push('rejected');
          return error;
        },
      );
      await disposalStarted.opened;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(events).toStrictEqual(['dispose-started']);

      releaseDisposal.open();
      const error = await construction;

      expect(events).toStrictEqual([
        'dispose-started',
        'dispose-finished',
        'rejected',
      ]);
      if (!(error instanceof AggregateError))
        throw new Error(
          'Expected construction to reject with an AggregateError',
        );
      expect(error.errors).toStrictEqual([bindingError, disposalError]);
    } finally {
      await built.cleanup();
    }
  }, 30000);
});
