/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  ProviderFileLifecycle,
  ProviderFileRetentionLimitError,
  resolveProviderFilePolicy,
  type ProviderFileIdentity,
} from './providerFilePolicy.js';

const KIMI_IDENTITY = {
  provider: 'kimi',
  baseURL: 'https://api.moonshot.ai/v1',
  credentialHash: 'credential-a',
} satisfies ProviderFileIdentity;

function workspacePolicy(retentionMs = 60_000) {
  const policy = resolveProviderFilePolicy({
    configuredMode: 'workspace',
    configuredRetentionMs: retentionMs,
    configuredDeletion: 'delete',
    providerFileReferences: true,
    zeroDataRetention: 'incompatible-while-retained',
    zeroDataRetentionRequired: false,
  });
  if (policy.mode !== 'enabled') {
    throw new Error('Expected workspace provider Files policy to be enabled');
  }
  return policy;
}

function persistedReference(
  overrides: Partial<{
    cacheKey: string;
    provider: string;
    baseURL: string;
    credentialHash: string;
    fileId: string;
    byteLength: number;
    scope: 'session' | 'workspace';
    scopeId: string;
    createdAt: number;
    expiresAt: number;
    deletion: 'retain' | 'delete';
    zeroDataRetention: 'not-applicable' | 'incompatible-while-retained';
    deletionState: 'active' | 'pending' | 'failed';
  }> = {},
) {
  return {
    cacheKey: 'content-a',
    provider: 'kimi',
    baseURL: 'https://api.moonshot.ai/v1',
    credentialHash: 'credential-a',
    fileId: 'file-restored',
    byteLength: 10,
    scope: 'workspace' as const,
    scopeId: '/workspace/a',
    createdAt: 1_000,
    expiresAt: 61_000,
    deletion: 'delete' as const,
    zeroDataRetention: 'incompatible-while-retained' as const,
    deletionState: 'active' as const,
    ...overrides,
  };
}

describe('provider Files lifecycle', () => {
  it('reuses stable file ids only for the same credential, base URL, and scope', async () => {
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 4,
      maxBytes: 100,
      now: () => 1_000,
    });
    const retained = await lifecycle.retain({
      cacheKey: 'content-a',
      fileId: 'file-stable',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async () => undefined,
    });
    await retained.lease.release();

    const same = lifecycle.acquire({
      cacheKey: 'content-a',
      identity: KIMI_IDENTITY,
      scope: 'workspace',
      scopeId: '/workspace/a',
    });
    const otherCredential = lifecycle.acquire({
      cacheKey: 'content-a',
      identity: { ...KIMI_IDENTITY, credentialHash: 'credential-b' },
      scope: 'workspace',
      scopeId: '/workspace/a',
    });
    const otherBaseURL = lifecycle.acquire({
      cacheKey: 'content-a',
      identity: { ...KIMI_IDENTITY, baseURL: 'https://proxy.example/v1' },
      scope: 'workspace',
      scopeId: '/workspace/a',
    });
    const otherScope = lifecycle.acquire({
      cacheKey: 'content-a',
      identity: KIMI_IDENTITY,
      scope: 'workspace',
      scopeId: '/workspace/b',
    });

    expect(same?.reference.fileId).toBe('file-stable');
    expect(otherCredential).toBeUndefined();
    expect(otherBaseURL).toBeUndefined();
    expect(otherScope).toBeUndefined();
    if (same !== undefined) await same.lease.release();
  });

  it('persists provider identity, scope, retention, deletion, and ZDR metadata', async () => {
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => 2_000,
    });

    const retained = await lifecycle.retain({
      cacheKey: 'content-a',
      fileId: 'file-metadata',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async () => undefined,
    });

    expect(retained.reference).toStrictEqual({
      cacheKey: 'content-a',
      provider: 'kimi',
      baseURL: 'https://api.moonshot.ai/v1',
      credentialHash: 'credential-a',
      fileId: 'file-metadata',
      byteLength: 10,
      scope: 'workspace',
      scopeId: '/workspace/a',
      createdAt: 2_000,
      expiresAt: 62_000,
      deletion: 'delete',
      zeroDataRetention: 'incompatible-while-retained',
      deletionState: 'active',
    });
    await retained.lease.release();
  });

  it('restores and reuses a valid persisted provider file id after local cache loss', async () => {
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => 2_000,
    });
    const restored = await lifecycle.restore(
      persistedReference(),
      'content-a',
      async () => undefined,
      {
        identity: KIMI_IDENTITY,
        policy: workspacePolicy(),
        scopeId: '/workspace/a',
      },
    );

    expect(restored?.reference.fileId).toBe('file-restored');
    expect(lifecycle.snapshot().retainedFiles).toBe(1);
    if (restored !== undefined) await restored.lease.release();
  });

  it('rejects a persisted provider file whose cache identity differs from current content', async () => {
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => 2_000,
    });

    const restored = await lifecycle.restore(
      persistedReference({ cacheKey: 'stale-content' }),
      'current-content',
      async () => undefined,
      {
        identity: KIMI_IDENTITY,
        policy: workspacePolicy(),
        scopeId: '/workspace/a',
      },
    );

    expect(restored).toBeUndefined();
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
  });

  it('rejects expired and over-budget persisted files without retaining state', async () => {
    const expiredLifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => 61_000,
    });
    const boundedLifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 9,
      now: () => 2_000,
    });
    const context = {
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
    };

    const expired = await expiredLifecycle.restore(
      persistedReference(),
      'expired-content',
      async () => undefined,
      context,
    );
    const overBudget = await boundedLifecycle.restore(
      persistedReference(),
      'large-content',
      async () => undefined,
      context,
    );

    expect(expired).toBeUndefined();
    expect(overBudget).toBeUndefined();
    expect(expiredLifecycle.snapshot().retainedFiles).toBe(0);
    expect(boundedLifecycle.snapshot().retainedBytes).toBe(0);
  });

  it('restores only references matching the current identity and retention policy', async () => {
    const mismatches = [
      persistedReference({ credentialHash: 'credential-b' }),
      persistedReference({ scope: 'session' }),
      persistedReference({ scopeId: '/workspace/b' }),
      persistedReference({ expiresAt: 62_000 }),
      persistedReference({ deletion: 'retain' }),
      persistedReference({ zeroDataRetention: 'not-applicable' }),
    ];

    for (const [index, reference] of mismatches.entries()) {
      const lifecycle = new ProviderFileLifecycle({
        maxFiles: 1,
        maxBytes: 10,
        now: () => 2_000,
      });
      const restored = await lifecycle.restore(
        reference,
        `content-${index}`,
        async () => undefined,
        {
          identity: KIMI_IDENTITY,
          policy: workspacePolicy(),
          scopeId: '/workspace/a',
        },
      );

      expect(restored).toBeUndefined();
      expect(lifecycle.snapshot().retainedFiles).toBe(0);
    }
  });

  it('marks an entry non-active before awaiting remote deletion', async () => {
    let finishDeletion: (() => void) | undefined;
    const deletionPending = new Promise<void>((resolve) => {
      finishDeletion = resolve;
    });
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => 1_000,
    });
    const retained = await lifecycle.retain({
      cacheKey: 'content-a',
      fileId: 'file-deleting',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async () => deletionPending,
    });
    await retained.lease.release();

    const cleanup = lifecycle.cleanupScope('workspace', '/workspace/a');
    await Promise.resolve();
    const acquiredDuringDeletion = lifecycle.acquire({
      cacheKey: 'content-a',
      identity: KIMI_IDENTITY,
      scope: 'workspace',
      scopeId: '/workspace/a',
    });

    const retainedDuringDeletion = lifecycle.retain({
      cacheKey: 'content-a',
      fileId: 'file-deleting',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async () => undefined,
    });

    expect(acquiredDuringDeletion).toBeUndefined();
    await expect(retainedDuringDeletion).rejects.toThrow('not active');
    expect(lifecycle.snapshot().pendingDeletions).toBe(1);
    finishDeletion?.();
    await cleanup;
  });

  it('holds upload leases until physical request cleanup releases them', async () => {
    const deleted: string[] = [];
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => 1_000,
    });
    const retained = await lifecycle.retain({
      cacheKey: 'content-a',
      fileId: 'file-in-flight',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async (fileId) => {
        deleted.push(fileId);
      },
    });

    await lifecycle.cleanupScope('workspace', '/workspace/a');

    expect(deleted).toHaveLength(0);
    expect(lifecycle.snapshot().activeLeases).toBe(1);
    expect(lifecycle.snapshot().pendingDeletions).toBe(1);

    await retained.lease.release();

    expect(deleted).toStrictEqual(['file-in-flight']);
    expect(lifecycle.snapshot()).toStrictEqual({
      retainedFiles: 0,
      retainedBytes: 0,
      activeLeases: 0,
      pendingDeletions: 0,
      pendingDeletionFileIds: [],
      deletionFailures: [],
    });
  });

  it('fails capacity before deleting entries when active leases prevent enough reclamation', async () => {
    const deleted: string[] = [];
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 2, maxBytes: 20 });
    const first = await lifecycle.retain({
      cacheKey: 'first',
      fileId: 'file-first',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async (fileId) => {
        deleted.push(fileId);
      },
    });
    const second = await lifecycle.retain({
      cacheKey: 'second',
      fileId: 'file-second',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async (fileId) => {
        deleted.push(fileId);
      },
    });
    await first.lease.release();

    const attempt = lifecycle.retain({
      cacheKey: 'third',
      fileId: 'file-third',
      bytes: 20,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: '/workspace/a',
      deleteRemote: async (fileId) => {
        deleted.push(fileId);
      },
    });

    await expect(attempt).rejects.toBeInstanceOf(
      ProviderFileRetentionLimitError,
    );
    expect(deleted).toStrictEqual([]);
    expect(lifecycle.snapshot().retainedFiles).toBe(2);
    expect(lifecycle.snapshot().retainedBytes).toBe(20);
    expect(lifecycle.snapshot().activeLeases).toBe(1);
    await second.lease.release();
  });

  it('does not remove retained-policy accounting while a lease is active', async () => {
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const retainPolicy = resolveProviderFilePolicy({
      configuredMode: 'session',
      configuredRetentionMs: 10,
      configuredDeletion: 'retain',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });
    const retained = await lifecycle.retain({
      cacheKey: 'content',
      fileId: 'file-retained',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: retainPolicy,
      scopeId: 'session-a',
      deleteRemote: async () => undefined,
    });

    const deferred = await lifecycle.cleanupScope('session', 'session-a');

    expect(deferred.deferred).toBe(1);
    expect(lifecycle.snapshot().retainedFiles).toBe(1);
    expect(lifecycle.snapshot().activeLeases).toBe(1);
    await retained.lease.release();

    expect(lifecycle.snapshot().activeLeases).toBe(0);
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
  });

  it('evicts expired files and retains observable deletion failures for retry', async () => {
    let now = 1_000;
    let attempts = 0;
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => now,
    });
    const policy = resolveProviderFilePolicy({
      configuredMode: 'session',
      configuredRetentionMs: 10,
      configuredDeletion: 'delete',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });
    const retained = await lifecycle.retain({
      cacheKey: 'content-a',
      fileId: 'file-retry',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy,
      scopeId: 'session-a',
      deleteRemote: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('provider unavailable');
      },
    });
    await retained.lease.release();
    now = 1_011;

    const firstCleanup = await lifecycle.sweepExpired();

    expect(firstCleanup.failed).toBe(1);
    expect(lifecycle.snapshot().deletionFailures).toStrictEqual([
      {
        fileId: 'file-retry',
        message: 'provider unavailable',
        attempts: 1,
      },
    ]);
    expect(lifecycle.snapshot().retainedFiles).toBe(1);

    const retry = await lifecycle.retryDeletions();

    expect(retry.deleted).toBe(1);
    expect(lifecycle.snapshot().deletionFailures).toStrictEqual([]);
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
  });

  it('removes local retention without remote deletion when policy says retain', async () => {
    const deleted: string[] = [];
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 1,
      maxBytes: 10,
      now: () => 1_000,
    });
    const policy = resolveProviderFilePolicy({
      configuredMode: 'session',
      configuredRetentionMs: 10,
      configuredDeletion: 'retain',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });
    const retained = await lifecycle.retain({
      cacheKey: 'content-a',
      fileId: 'file-provider-retained',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy,
      scopeId: 'session-a',
      deleteRemote: async (fileId) => {
        deleted.push(fileId);
      },
    });
    await retained.lease.release();

    await lifecycle.cleanupScope('session', 'session-a');

    expect(deleted).toStrictEqual([]);
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
  });

  it('removes persisted bindings before capacity eviction publishes a replacement', async () => {
    const removedBindings: string[] = [];
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const first = await lifecycle.retain({
      cacheKey: 'first',
      fileId: 'file-first',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => undefined,
      removeBinding: async (reference) => {
        removedBindings.push(reference.fileId);
      },
    });
    await first.lease.release();

    const second = await lifecycle.retain({
      cacheKey: 'second',
      fileId: 'file-second',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => undefined,
    });

    expect({
      removedBindings,
      retainedFiles: lifecycle.snapshot().retainedFiles,
    }).toStrictEqual({ removedBindings: ['file-first'], retainedFiles: 1 });
    await second.lease.release();
  });

  it('keeps capacity cleanup retryable when persisted binding removal fails', async () => {
    let removalAttempts = 0;
    const deleted: string[] = [];
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const first = await lifecycle.retain({
      cacheKey: 'first-binding-failure',
      fileId: 'file-binding-failure',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      removeBinding: async () => {
        removalAttempts += 1;
        if (removalAttempts === 1) throw new Error('history unavailable');
      },
      deleteRemote: async (fileId) => {
        deleted.push(fileId);
      },
    });
    await first.lease.release();

    await expect(
      lifecycle.retain({
        cacheKey: 'blocked-by-binding',
        fileId: 'file-blocked',
        bytes: 10,
        identity: KIMI_IDENTITY,
        policy: workspacePolicy(),
        scopeId: 'workspace:test',
        deleteRemote: async () => undefined,
      }),
    ).rejects.toThrow(
      'Provider file capacity cleanup failed for file-binding-failure',
    );

    expect({
      deleted,
      retainedFiles: lifecycle.snapshot().retainedFiles,
      failures: lifecycle.snapshot().deletionFailures,
    }).toStrictEqual({
      deleted: [],
      retainedFiles: 1,
      failures: [
        {
          fileId: 'file-binding-failure',
          message: 'history unavailable',
          attempts: 1,
        },
      ],
    });

    const retry = await lifecycle.retryDeletions();

    expect({
      retry,
      deleted,
      retainedFiles: lifecycle.snapshot().retainedFiles,
    }).toStrictEqual({
      retry: { deleted: 1, retainedRemotely: 0, deferred: 0, failed: 0 },
      deleted: ['file-binding-failure'],
      retainedFiles: 0,
    });
  });

  it('serializes concurrent retention so count and byte limits cannot be exceeded', async () => {
    let finishEviction: (() => void) | undefined;
    const evictionPending = new Promise<void>((resolve) => {
      finishEviction = resolve;
    });
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const first = await lifecycle.retain({
      cacheKey: 'first',
      fileId: 'file-first',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => evictionPending,
    });
    await first.lease.release();

    const second = lifecycle.retain({
      cacheKey: 'second',
      fileId: 'file-second',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => undefined,
    });
    await Promise.resolve();
    const third = lifecycle.retain({
      cacheKey: 'third',
      fileId: 'file-third',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => undefined,
    });
    finishEviction?.();

    const outcomes = await Promise.allSettled([second, third]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(lifecycle.snapshot().retainedFiles).toBe(1);
    expect(lifecycle.snapshot().retainedBytes).toBe(10);
    if (outcomes[0].status === 'fulfilled')
      await outcomes[0].value.lease.release();
    if (outcomes[1].status === 'fulfilled')
      await outcomes[1].value.lease.release();
  });

  it('prevents leases on every entry reserved for asynchronous capacity eviction', async () => {
    let finishFirstDeletion: (() => void) | undefined;
    const firstDeletionPending = new Promise<void>((resolve) => {
      finishFirstDeletion = resolve;
    });
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 2, maxBytes: 20 });
    const first = await lifecycle.retain({
      cacheKey: 'first-reserved',
      fileId: 'file-first-reserved',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => firstDeletionPending,
    });
    const second = await lifecycle.retain({
      cacheKey: 'second-reserved',
      fileId: 'file-second-reserved',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => undefined,
    });
    await first.lease.release();
    await second.lease.release();

    const replacement = lifecycle.retain({
      cacheKey: 'replacement',
      fileId: 'file-replacement',
      bytes: 20,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => undefined,
    });
    await Promise.resolve();
    const acquired = lifecycle.acquire({
      cacheKey: 'second-reserved',
      identity: KIMI_IDENTITY,
      scope: 'workspace',
      scopeId: 'workspace:test',
    });
    if (finishFirstDeletion === undefined) {
      throw new Error('expected first capacity deletion to start');
    }
    finishFirstDeletion();
    const retainedReplacement = await replacement;

    expect(acquired).toBeUndefined();
    expect(lifecycle.snapshot().retainedFiles).toBe(1);
    expect(lifecycle.snapshot().retainedBytes).toBe(20);
    await retainedReplacement.lease.release();
  });

  it('serializes concurrent reuse insertion without double-accounting one entry', async () => {
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const input = {
      cacheKey: 'shared',
      fileId: 'file-shared',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => undefined,
    };

    const [first, second] = await Promise.all([
      lifecycle.retain(input),
      lifecycle.retain(input),
    ]);

    expect(lifecycle.snapshot().retainedFiles).toBe(1);
    expect(lifecycle.snapshot().retainedBytes).toBe(10);
    expect(lifecycle.snapshot().activeLeases).toBe(2);
    await first.lease.release();
    await second.lease.release();
  });

  it('finds a discarded entry by stable identity after deletion state replacement', async () => {
    const deleted: string[] = [];
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const retained = await lifecycle.retain({
      cacheKey: 'stable-entry',
      fileId: 'file-stable-entry',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async (fileId) => {
        deleted.push(fileId);
      },
    });
    await lifecycle.cleanupScope('workspace', 'workspace:test');

    const discarded = await lifecycle.discard(retained.reference);
    await retained.lease.release();

    expect(discarded.deferred).toBe(1);
    expect(deleted).toStrictEqual(['file-stable-entry']);
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
  });

  it('reports final-lease deletion failure and leaves the entry retryable', async () => {
    let attempts = 0;
    const lifecycle = new ProviderFileLifecycle({ maxFiles: 1, maxBytes: 10 });
    const retained = await lifecycle.retain({
      cacheKey: 'final-lease',
      fileId: 'file-final-lease',
      bytes: 10,
      identity: KIMI_IDENTITY,
      policy: workspacePolicy(),
      scopeId: 'workspace:test',
      deleteRemote: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('remote deletion failed');
      },
    });
    await lifecycle.cleanupScope('workspace', 'workspace:test');

    await expect(retained.lease.release()).rejects.toThrow(
      'remote deletion failed',
    );
    expect(lifecycle.snapshot().deletionFailures).toHaveLength(1);

    const retry = await lifecycle.retryDeletions();

    expect(retry.deleted).toBe(1);
    expect(lifecycle.snapshot().retainedFiles).toBe(0);
  });
});
