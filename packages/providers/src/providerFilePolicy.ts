/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac } from 'node:crypto';
import type { ProviderFileReferenceMetadata } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ZeroDataRetentionImplication } from './providerMediaTransportCapabilities.js';

export type ProviderFilesMode = 'off' | 'session' | 'workspace';
export type ProviderFileScope = Exclude<ProviderFilesMode, 'off'>;
export type ProviderFileDeletion = 'retain' | 'delete';

interface ProviderFilePolicyInput {
  readonly configuredMode: unknown;
  readonly configuredRetentionMs: unknown;
  readonly configuredDeletion: unknown;
  readonly providerFileReferences: boolean;
  readonly zeroDataRetention: ZeroDataRetentionImplication;
  readonly zeroDataRetentionRequired: boolean;
}

export type ProviderFilePolicy =
  | { readonly mode: 'off' }
  | {
      readonly mode: 'enabled';
      readonly scope: ProviderFileScope;
      readonly retentionMs: number;
      readonly deletion: ProviderFileDeletion;
      readonly zeroDataRetention: ZeroDataRetentionImplication;
    };

export class ProviderFileZeroDataRetentionError extends Error {
  constructor() {
    super(
      'Provider Files retention is incompatible with required zero-data-retention',
    );
    this.name = 'ProviderFileZeroDataRetentionError';
  }
}

export function resolveProviderFilePolicy(
  input: ProviderFilePolicyInput,
): ProviderFilePolicy {
  if (
    (input.configuredMode !== 'session' &&
      input.configuredMode !== 'workspace') ||
    !input.providerFileReferences
  ) {
    return { mode: 'off' };
  }
  if (
    !Number.isSafeInteger(input.configuredRetentionMs) ||
    typeof input.configuredRetentionMs !== 'number' ||
    input.configuredRetentionMs <= 0
  ) {
    throw new RangeError(
      'Provider Files retention duration must be a positive safe integer',
    );
  }
  if (
    input.configuredDeletion !== 'retain' &&
    input.configuredDeletion !== 'delete'
  ) {
    throw new Error(
      "Provider Files deletion policy must be explicitly 'retain' or 'delete'",
    );
  }
  if (
    input.zeroDataRetentionRequired &&
    input.zeroDataRetention === 'incompatible-while-retained'
  ) {
    throw new ProviderFileZeroDataRetentionError();
  }
  return {
    mode: 'enabled',
    scope: input.configuredMode,
    retentionMs: input.configuredRetentionMs,
    deletion: input.configuredDeletion,
    zeroDataRetention: input.zeroDataRetention,
  };
}

interface ProviderFilesModeInput {
  readonly configuredMode: unknown;
  readonly providerFileReferences: boolean;
}

export function resolveProviderFilesMode(
  input: ProviderFilesModeInput,
): ProviderFilesMode {
  return (input.configuredMode === 'session' ||
    input.configuredMode === 'workspace') &&
    input.providerFileReferences
    ? input.configuredMode
    : 'off';
}

const PROVIDER_FILE_CREDENTIAL_LABEL = 'llxprt-provider-file-identity';
const PROVIDER_FILE_WORKSPACE_LABEL = 'llxprt-provider-file-workspace';

export function createProviderFileCredentialHash(credential: string): string {
  if (credential.length === 0) {
    throw new Error('Provider Files credential identity cannot be empty');
  }
  return createHmac('sha256', credential)
    .update(PROVIDER_FILE_CREDENTIAL_LABEL)
    .digest('hex');
}

export function createProviderFileWorkspaceScopeId(
  workspacePath: string,
  credential: string,
): string {
  if (workspacePath.trim().length === 0) {
    throw new Error('Provider Files workspace identity cannot be empty');
  }
  if (credential.trim().length === 0) {
    throw new Error('Provider Files credential identity cannot be empty');
  }
  const digest = createHmac('sha256', credential)
    .update(PROVIDER_FILE_WORKSPACE_LABEL)
    .update('\0')
    .update(workspacePath)
    .digest('hex');
  return `workspace:${digest}`;
}

export interface ProviderFileIdentity {
  readonly provider: string;
  readonly baseURL: string;
  readonly credentialHash: string;
}

export type ProviderFileReference = ProviderFileReferenceMetadata;

interface ProviderFileRetentionLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

export interface ProviderFileLease {
  release(): Promise<void>;
}

export class ProviderFileRetentionLimitError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderFileRetentionLimitError';
  }
}

function validateLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

interface LifecycleOptions extends ProviderFileRetentionLimits {
  readonly now?: () => number;
}

interface RetainInput {
  readonly cacheKey: string;
  readonly fileId: string;
  readonly bytes: number;
  readonly identity: ProviderFileIdentity;
  readonly policy: ProviderFilePolicy;
  readonly scopeId: string;
  readonly deleteRemote: (fileId: string) => Promise<void>;
  readonly removeBinding?: (reference: ProviderFileReference) => Promise<void>;
}

interface AcquireInput {
  readonly cacheKey: string;
  readonly identity: ProviderFileIdentity;
  readonly scope: ProviderFileScope;
  readonly scopeId: string;
}

interface ProviderFileRestoreContext {
  readonly identity: ProviderFileIdentity;
  readonly policy: Extract<ProviderFilePolicy, { mode: 'enabled' }>;
  readonly scopeId: string;
  readonly removeBinding?: (reference: ProviderFileReference) => Promise<void>;
}

interface LifecycleEntry {
  readonly key: string;
  readonly cacheKey: string;
  readonly identity: ProviderFileIdentity;
  readonly deleteRemote: (fileId: string) => Promise<void>;
  readonly removeBinding: (reference: ProviderFileReference) => Promise<void>;
  reference: ProviderFileReference;
  activeLeases: number;
  deletionAttempts: number;
  deletionMessage: string | undefined;
  reservedForCapacity: boolean;
}

interface CleanupWaiter {
  readonly scope: ProviderFileScope;
  readonly scopeId: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export interface ProviderFileLifecycleSnapshot {
  readonly retainedFiles: number;
  readonly retainedBytes: number;
  readonly activeLeases: number;
  readonly pendingDeletions: number;
  readonly pendingDeletionFileIds: readonly string[];
  readonly deletionFailures: ReadonlyArray<{
    readonly fileId: string;
    readonly message: string;
    readonly attempts: number;
  }>;
}

export interface ProviderFileCleanupResult {
  readonly deleted: number;
  readonly retainedRemotely: number;
  readonly deferred: number;
  readonly failed: number;
}

interface LifecycleEntryIdentity {
  readonly key: string;
  readonly fileId: string;
}

const EMPTY_CLEANUP_RESULT: ProviderFileCleanupResult = {
  deleted: 0,
  retainedRemotely: 0,
  deferred: 0,
  failed: 0,
};

function lifecycleKey(input: AcquireInput): string {
  return JSON.stringify([
    input.identity.provider,
    input.identity.baseURL,
    input.identity.credentialHash,
    input.scope,
    input.scopeId,
    input.cacheKey,
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function noBindingRemoval(): Promise<void> {}

export class ProviderFileLifecycle {
  private readonly entries = new Map<string, LifecycleEntry>();
  private readonly deletions = new Map<
    string,
    Promise<ProviderFileCleanupResult>
  >();
  private readonly cleanupWaiters: CleanupWaiter[] = [];
  private readonly now: () => number;
  private retainedBytes = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: LifecycleOptions) {
    validateLimit('maxFiles', options.maxFiles);
    validateLimit('maxBytes', options.maxBytes);
    this.now = options.now ?? Date.now;
  }

  retainsScope(scope: ProviderFileScope, scopeId: string): boolean {
    return [...this.entries.values()].some(
      (entry) =>
        entry.reference.scope === scope && entry.reference.scopeId === scopeId,
    );
  }

  snapshot(): ProviderFileLifecycleSnapshot {
    const entries = [...this.entries.values()];
    return {
      retainedFiles: entries.length,
      retainedBytes: this.retainedBytes,
      activeLeases: entries.reduce(
        (total, entry) => total + entry.activeLeases,
        0,
      ),
      pendingDeletions: entries.filter(
        (entry) => entry.reference.deletionState === 'pending',
      ).length,
      pendingDeletionFileIds: entries.flatMap((entry) =>
        entry.reference.deletionState === 'pending'
          ? [entry.reference.fileId]
          : [],
      ),
      deletionFailures: entries.flatMap((entry) =>
        entry.reference.deletionState === 'failed' &&
        entry.deletionMessage !== undefined
          ? [
              {
                fileId: entry.reference.fileId,
                message: entry.deletionMessage,
                attempts: entry.deletionAttempts,
              },
            ]
          : [],
      ),
    };
  }

  acquire(input: AcquireInput):
    | {
        readonly reference: ProviderFileReference;
        readonly lease: ProviderFileLease;
      }
    | undefined {
    const entry = this.entries.get(lifecycleKey(input));
    if (
      entry === undefined ||
      entry.reservedForCapacity ||
      entry.reference.deletionState !== 'active' ||
      entry.reference.expiresAt <= this.now()
    ) {
      return undefined;
    }
    return { reference: entry.reference, lease: this.createLease(entry) };
  }

  async restore(
    reference: ProviderFileReference,
    cacheKey: string,
    deleteRemote: (fileId: string) => Promise<void>,
    context: ProviderFileRestoreContext,
  ): Promise<
    | {
        readonly reference: ProviderFileReference;
        readonly lease: ProviderFileLease;
      }
    | undefined
  > {
    return this.runExclusive(() =>
      this.restoreExclusive(reference, cacheKey, deleteRemote, context),
    );
  }

  private restoreExclusive(
    reference: ProviderFileReference,
    cacheKey: string,
    deleteRemote: (fileId: string) => Promise<void>,
    context: ProviderFileRestoreContext,
  ):
    | {
        readonly reference: ProviderFileReference;
        readonly lease: ProviderFileLease;
      }
    | undefined {
    if (!this.isRestorable(reference, cacheKey, context)) return undefined;
    const key = lifecycleKey({
      cacheKey,
      identity: context.identity,
      scope: context.policy.scope,
      scopeId: context.scopeId,
    });
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (
        existing.reservedForCapacity ||
        existing.reference.deletionState !== 'active'
      ) {
        return undefined;
      }
      return {
        reference: existing.reference,
        lease: this.createLease(existing),
      };
    }
    if (
      this.entries.size + 1 > this.options.maxFiles ||
      this.retainedBytes + reference.byteLength > this.options.maxBytes
    ) {
      return undefined;
    }
    const entry: LifecycleEntry = {
      key,
      cacheKey,
      identity: context.identity,
      reference,
      deleteRemote,
      removeBinding: context.removeBinding ?? noBindingRemoval,
      activeLeases: 0,
      deletionAttempts: 0,
      deletionMessage: undefined,
      reservedForCapacity: false,
    };
    this.entries.set(key, entry);
    this.retainedBytes += reference.byteLength;
    return { reference, lease: this.createLease(entry) };
  }

  private isRestorable(
    reference: ProviderFileReference,
    cacheKey: string,
    context: ProviderFileRestoreContext,
  ): boolean {
    const retentionMs = reference.expiresAt - reference.createdAt;
    const isActive =
      reference.deletionState === 'active' &&
      reference.expiresAt > this.now() &&
      reference.fileId.trim() !== '';
    const hasValidSize =
      Number.isSafeInteger(reference.byteLength) && reference.byteLength >= 0;
    const hasValidRetention =
      Number.isSafeInteger(reference.createdAt) &&
      Number.isSafeInteger(reference.expiresAt) &&
      retentionMs === context.policy.retentionMs;
    const hasMatchingIdentity =
      reference.provider === context.identity.provider &&
      reference.baseURL === context.identity.baseURL &&
      reference.credentialHash === context.identity.credentialHash;
    const hasMatchingScope =
      reference.scope === context.policy.scope &&
      reference.scopeId === context.scopeId;
    const hasMatchingPolicy =
      reference.deletion === context.policy.deletion &&
      reference.zeroDataRetention === context.policy.zeroDataRetention;
    return [
      reference.cacheKey === cacheKey,
      isActive,
      hasValidSize,
      hasValidRetention,
      hasMatchingIdentity,
      hasMatchingScope,
      hasMatchingPolicy,
    ].every(Boolean);
  }

  async retain(input: RetainInput): Promise<{
    readonly reference: ProviderFileReference;
    readonly lease: ProviderFileLease;
  }> {
    return this.runExclusive(() => this.retainExclusive(input));
  }

  private async retainExclusive(input: RetainInput): Promise<{
    readonly reference: ProviderFileReference;
    readonly lease: ProviderFileLease;
  }> {
    if (input.policy.mode !== 'enabled') {
      throw new Error('Provider Files retention requires an enabled policy');
    }
    if (input.fileId.trim() === '') {
      throw new Error('Provider file id cannot be empty');
    }
    if (input.scopeId.trim() === '') {
      throw new Error('Provider file scope id cannot be empty');
    }
    validateLimit('provider file bytes', input.bytes);
    const key = lifecycleKey({
      cacheKey: input.cacheKey,
      identity: input.identity,
      scope: input.policy.scope,
      scopeId: input.scopeId,
    });
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (
        existing.reference.deletionState !== 'active' ||
        existing.reference.expiresAt <= this.now()
      ) {
        throw new Error(
          `Provider file ${existing.reference.fileId} is not active`,
        );
      }
      if (
        existing.reference.fileId !== input.fileId ||
        existing.reference.byteLength !== input.bytes
      ) {
        throw new Error('Provider file cache identity changed retained file');
      }
      return {
        reference: existing.reference,
        lease: this.createLease(existing),
      };
    }

    await this.makeCapacity(input.bytes);
    const createdAt = this.now();
    const reference: ProviderFileReference = {
      cacheKey: input.cacheKey,
      ...input.identity,
      fileId: input.fileId,
      byteLength: input.bytes,
      scope: input.policy.scope,
      scopeId: input.scopeId,
      createdAt,
      expiresAt: createdAt + input.policy.retentionMs,
      deletion: input.policy.deletion,
      zeroDataRetention: input.policy.zeroDataRetention,
      deletionState: 'active',
    };
    const entry: LifecycleEntry = {
      key,
      cacheKey: input.cacheKey,
      identity: input.identity,
      reference,
      deleteRemote: input.deleteRemote,
      removeBinding: input.removeBinding ?? noBindingRemoval,
      activeLeases: 0,
      deletionAttempts: 0,
      deletionMessage: undefined,
      reservedForCapacity: false,
    };
    this.entries.set(key, entry);
    this.retainedBytes += input.bytes;
    return { reference, lease: this.createLease(entry) };
  }

  async sweepExpired(): Promise<ProviderFileCleanupResult> {
    const expired = [...this.entries.values()].filter(
      (entry) => entry.reference.expiresAt <= this.now(),
    );
    return this.cleanupEntries(expired);
  }

  async cleanupScope(
    scope: ProviderFileScope,
    scopeId: string,
  ): Promise<ProviderFileCleanupResult> {
    const matching = [...this.entries.values()].filter(
      (entry) =>
        entry.reference.scope === scope && entry.reference.scopeId === scopeId,
    );
    return this.cleanupEntries(matching);
  }

  async retryDeletions(): Promise<ProviderFileCleanupResult> {
    const failed = [...this.entries.values()].filter(
      (entry) => entry.reference.deletionState === 'failed',
    );
    return this.cleanupEntries(failed);
  }

  async discard(
    reference: ProviderFileReference,
  ): Promise<ProviderFileCleanupResult> {
    const identity = this.referenceIdentity(reference);
    if (identity === undefined) return EMPTY_CLEANUP_RESULT;
    const entry = this.entryForIdentity(identity);
    if (entry === undefined) return EMPTY_CLEANUP_RESULT;
    if (entry.activeLeases > 0) {
      this.setDeletionState(entry, 'pending');
      return { deleted: 0, retainedRemotely: 0, deferred: 1, failed: 0 };
    }
    return this.deleteEntry(entry);
  }

  async waitForScopeCleanup(
    scope: ProviderFileScope,
    scopeId: string,
  ): Promise<void> {
    const failure = this.scopeFailure(scope, scopeId);
    if (failure !== undefined) throw failure;
    if (!this.retainsScope(scope, scopeId)) return;
    await new Promise<void>((resolve, reject) => {
      this.cleanupWaiters.push({ scope, scopeId, resolve, reject });
    });
  }

  private createLease(entry: LifecycleEntry): ProviderFileLease {
    entry.activeLeases += 1;
    const identity = this.entryIdentity(entry);
    let releasePromise: Promise<void> | undefined;
    return {
      release: (): Promise<void> => {
        releasePromise ??= this.releaseLease(identity);
        return releasePromise;
      },
    };
  }

  private async releaseLease(identity: LifecycleEntryIdentity): Promise<void> {
    const entry = this.entryForIdentity(identity);
    if (entry === undefined) return;
    entry.activeLeases -= 1;
    if (
      entry.activeLeases === 0 &&
      entry.reference.deletionState === 'pending'
    ) {
      const result = await this.cleanupEntry(entry);
      if (result.failed > 0) throw this.entryDeletionError(entry);
    }
  }

  private async makeCapacity(bytes: number): Promise<void> {
    if (
      this.entries.size + 1 <= this.options.maxFiles &&
      this.retainedBytes + bytes <= this.options.maxBytes
    ) {
      return;
    }

    const candidates = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.activeLeases === 0 &&
          !entry.reservedForCapacity &&
          entry.reference.deletionState === 'active',
      )
      .sort(
        (left, right) => left.reference.expiresAt - right.reference.expiresAt,
      );
    const selected: LifecycleEntry[] = [];
    let projectedFiles = this.entries.size + 1;
    let projectedBytes = this.retainedBytes + bytes;
    for (const candidate of candidates) {
      if (
        projectedFiles <= this.options.maxFiles &&
        projectedBytes <= this.options.maxBytes
      ) {
        break;
      }
      selected.push(candidate);
      projectedFiles -= 1;
      projectedBytes -= candidate.reference.byteLength;
    }
    if (
      projectedFiles > this.options.maxFiles ||
      projectedBytes > this.options.maxBytes
    ) {
      throw this.capacityError(bytes);
    }

    for (const candidate of selected) candidate.reservedForCapacity = true;
    try {
      for (const candidate of selected) {
        const cleanup = await this.cleanupEntry(candidate);
        if (cleanup.failed > 0 || cleanup.deferred > 0) {
          throw new Error(
            `Provider file capacity cleanup failed for ${candidate.reference.fileId}`,
          );
        }
      }
    } finally {
      for (const candidate of selected) candidate.reservedForCapacity = false;
    }
  }

  private capacityError(bytes: number): ProviderFileRetentionLimitError {
    return this.entries.size + 1 > this.options.maxFiles
      ? new ProviderFileRetentionLimitError(
          `Provider file retention exceeds ${this.options.maxFiles} files`,
        )
      : new ProviderFileRetentionLimitError(
          `Provider file retention exceeds ${this.options.maxBytes} bytes (${this.retainedBytes + bytes})`,
        );
  }

  private async cleanupEntries(
    entries: readonly LifecycleEntry[],
  ): Promise<ProviderFileCleanupResult> {
    let result = EMPTY_CLEANUP_RESULT;
    for (const entry of entries) {
      const current = await this.cleanupEntry(entry);
      result = {
        deleted: result.deleted + current.deleted,
        retainedRemotely: result.retainedRemotely + current.retainedRemotely,
        deferred: result.deferred + current.deferred,
        failed: result.failed + current.failed,
      };
    }
    return result;
  }

  private async cleanupEntry(
    candidate: LifecycleEntry,
  ): Promise<ProviderFileCleanupResult> {
    const entry = this.entryForIdentity(this.entryIdentity(candidate));
    if (entry === undefined) return EMPTY_CLEANUP_RESULT;
    if (entry.activeLeases > 0) {
      this.setDeletionState(entry, 'pending');
      return { deleted: 0, retainedRemotely: 0, deferred: 1, failed: 0 };
    }
    if (entry.reference.deletion === 'retain') {
      try {
        await entry.removeBinding(entry.reference);
        this.removeEntry(entry);
        return { deleted: 0, retainedRemotely: 1, deferred: 0, failed: 0 };
      } catch (error) {
        entry.deletionMessage = errorMessage(error);
        this.setDeletionState(entry, 'failed');
        this.notifyCleanupWaiters();
        return { deleted: 0, retainedRemotely: 0, deferred: 0, failed: 1 };
      }
    }
    return this.deleteEntry(entry);
  }

  private async deleteEntry(
    entry: LifecycleEntry,
  ): Promise<ProviderFileCleanupResult> {
    const deletionKey = JSON.stringify(this.entryIdentity(entry));
    const activeDeletion = this.deletions.get(deletionKey);
    if (activeDeletion !== undefined) return activeDeletion;
    const deletion = this.performRemoteDeletion(entry);
    this.deletions.set(deletionKey, deletion);
    try {
      return await deletion;
    } finally {
      this.deletions.delete(deletionKey);
    }
  }

  private async performRemoteDeletion(
    entry: LifecycleEntry,
  ): Promise<ProviderFileCleanupResult> {
    this.setDeletionState(entry, 'pending');
    try {
      entry.deletionAttempts += 1;
      await entry.removeBinding(entry.reference);
      await entry.deleteRemote(entry.reference.fileId);
      this.removeEntry(entry);
      return { deleted: 1, retainedRemotely: 0, deferred: 0, failed: 0 };
    } catch (error) {
      entry.deletionMessage = errorMessage(error);
      this.setDeletionState(entry, 'failed');
      this.notifyCleanupWaiters();
      return { deleted: 0, retainedRemotely: 0, deferred: 0, failed: 1 };
    }
  }

  private setDeletionState(
    entry: LifecycleEntry,
    deletionState: ProviderFileReference['deletionState'],
  ): void {
    entry.reference = { ...entry.reference, deletionState };
  }

  private entryIdentity(entry: LifecycleEntry): LifecycleEntryIdentity {
    return { key: entry.key, fileId: entry.reference.fileId };
  }

  private referenceIdentity(
    reference: ProviderFileReference,
  ): LifecycleEntryIdentity | undefined {
    if (reference.cacheKey === undefined) return undefined;
    return {
      key: lifecycleKey({
        cacheKey: reference.cacheKey,
        identity: {
          provider: reference.provider,
          baseURL: reference.baseURL,
          credentialHash: reference.credentialHash,
        },
        scope: reference.scope,
        scopeId: reference.scopeId,
      }),
      fileId: reference.fileId,
    };
  }

  private entryForIdentity(
    identity: LifecycleEntryIdentity,
  ): LifecycleEntry | undefined {
    const entry = this.entries.get(identity.key);
    return entry?.reference.fileId === identity.fileId ? entry : undefined;
  }

  private scopeFailure(
    scope: ProviderFileScope,
    scopeId: string,
  ): Error | undefined {
    const failures = [...this.entries.values()].filter(
      (entry) =>
        entry.reference.scope === scope &&
        entry.reference.scopeId === scopeId &&
        entry.reference.deletionState === 'failed',
    );
    if (failures.length === 0) return undefined;
    return new Error(
      `Provider file deletion failed: ${failures
        .map(
          (entry) =>
            `${entry.reference.fileId}: ${entry.deletionMessage ?? 'unknown failure'}`,
        )
        .join('; ')}`,
    );
  }

  private entryDeletionError(entry: LifecycleEntry): Error {
    return new Error(
      `Provider file deletion failed for ${entry.reference.fileId}: ${entry.deletionMessage ?? 'unknown failure'}`,
    );
  }

  private notifyCleanupWaiters(): void {
    for (let index = this.cleanupWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.cleanupWaiters[index];
      const failure = this.scopeFailure(waiter.scope, waiter.scopeId);
      if (failure !== undefined) {
        this.cleanupWaiters.splice(index, 1);
        waiter.reject(failure);
      } else if (!this.retainsScope(waiter.scope, waiter.scopeId)) {
        this.cleanupWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }

  private runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private removeEntry(entry: LifecycleEntry): void {
    const current = this.entryForIdentity(this.entryIdentity(entry));
    if (current === undefined || !this.entries.delete(current.key)) return;
    this.retainedBytes -= current.reference.byteLength;
    this.notifyCleanupWaiters();
  }
}
