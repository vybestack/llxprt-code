import { captureAgentAdoption as fromConfig } from './agent-resource-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './session-client-capture.js';
import { fixtureAgentResources } from './agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { toConfigParameters } from '../../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { OwnedCredentialFixture } from './owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import { assembleModelSelection } from '../../model-selection.js';

import { SimpleExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';

import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P13
 * @requirement:REQ-016
 *
 * White-box disposal probe (infra helper — NOT the Agent under test). Lives
 * under __tests__/helpers/ so deep imports / casts are permitted here and the
 * helper is excluded from the T17 boundary scan in boundary.spec.ts.
 *
 * Purpose: given a built public {@link Agent}, capture references to and read
 * the disposed state of every resource in the §4.3 resource-ownership /
 * teardown table (dispose.md). The specs use the capture-BEFORE-dispose
 * pattern: capture the resource handles first (dispose may null them), then
 * call `agent.dispose()` (DIRECTLY — the harness cleanup() swallows dispose
 * errors, which is fine for env restore but DISPOSAL TESTS MUST observe the
 * real throw / real flag flip), then read the captured handle's disposed flag.
 *
 * At RED (P13) `AgentImpl.dispose()` throws NotYetImplemented (agentImpl.ts
 * ~164), so the post-dispose flag read NEVER runs — every disposal spec fails
 * naturally because `await agent.dispose()` rejects first. The probe returns
 * honest values at all times: it reads whatever genuine internal surface exists
 * today, and reads the surfaces dispose.md documents as the P24 GREEN teardown
 * (real `disposed` booleans on the owned resources). The probe NEVER fabricates
 * an always-false stub that could not flip true at GREEN — every method probes a
 * real surface that WILL exist.
 *
 * AggregateDisposeError (P24 NET-NEW) does NOT exist yet. The probe exposes a
 * cast-free structural predicate `isAggregateDisposeError(e)` and a cast-free
 * `aggregateErrors(e)` accessor so specs can assert structurally without
 * importing the not-yet-existent class.
 */

// ─── Internal record narrowing (cast-exempt in the helper) ──────────────────

interface RecordLike {
  readonly [key: string]: unknown;
}

function asRecord(v: unknown): RecordLike | null {
  return typeof v === 'object' && v !== null ? (v as RecordLike) : null;
}

// ─── Probe: the captured resource-reference snapshot ────────────────────────

/**
 * Snapshot of the resource references a disposal spec needs to assert torn-down
 * state. Captured BEFORE `agent.dispose()` because dispose may null the
 * facade-held slots. Each field is the genuine internal reference (or `null`
 * when not yet wired at the current phase). At RED most fields are null because
 * AgentImpl stores no internals yet (P15+ wires them); the specs still fail
 * naturally because `await agent.dispose()` throws NYI first.
 */
export interface DisposalProbe {
  /** The agentClient (Config-owned chat client) reference, captured pre-dispose. */
  readonly agentClient: unknown;
  /** The facade-held injected-factory scheduler handle (T19 conditional), if any. */
  readonly scheduler: unknown;
  /** The confirmationCoordinator backing the facade-held scheduler (T19), if any. */
  readonly confirmationCoordinator: unknown;
  /** The MessageBus reference (owned by createAgent), captured pre-dispose. */
  readonly messageBus: unknown;
  /**
   * The ownership record (dispose.md §Interface Contracts: `DisposeInput {
   * ownership: OwnershipRecord }`). Captured pre-dispose. P24's dispose()
   * receives this record and sets a per-resource completion marker for each
   * NET-NEW teardown step (lsp/extensions/sessionLock — dispose.md lines 70/80/
   * 81-82) as each `safe(errors, fn)` block completes. The readers for those
   * rows read these markers (NOT non-existent fields on the raw primitives),
   * which is uniformly GREEN-reachable.
   */
  readonly ownership: unknown;
}
export function captureProbe(agent: Agent): DisposalProbe {
  const captured = fixtureAgentResources(agent);
  const handles = captured.ownership.injectedSchedulerHandles;
  const injected = handles[0];
  return {
    agentClient: captured.publishedClient(agent),
    scheduler: injected,
    confirmationCoordinator: injected,
    messageBus: captured.messageBus,
    ownership: captured.ownership,
  };
}

// ─── Disposed-flag readers (capture-before-dispose) ─────────────────────────
//
// Each reader takes the PRE-DISPOSE captured reference and reads its disposed
// flag. The references are stable (dispose mutates a `disposed` boolean on the
// SAME object it captured — it does NOT replace the reference), so the post-
// dispose read observes the genuine flipped flag. At RED these never run
// because `await agent.dispose()` rejects first; at GREEN (P24) they return the
// real flipped `true`.

/**
 * Observes release of the captured client's owner-local notification subscription.
 * Each real session client receives its own release operation during binding;
 * disposal releases that subscription and clears the operation.
 */
export function agentClientDisposed(probe: DisposalProbe): boolean {
  const client = asRecord(probe.agentClient);
  if (client === null) {
    return false;
  }
  return client['releaseModelNotifications'] === undefined;
}

/**
 * Reads the facade-held injected-factory scheduler disposed flag. At P24
 * dispose() line 41 calls `injectedFactoryScheduler.dispose()` which sets
 * `disposed = true` on the captured handle.
 */
export function schedulerDisposed(probe: DisposalProbe): boolean {
  if (probe.scheduler === undefined)
    throw new Error('No scheduler reached actual injected acquisition');
  return flagOf(probe.scheduler);
}

/**
 * Reads the confirmationCoordinator disposed flag. At P24 dispose() line 46
 * calls `injectedFactoryCoordinator.dispose()`.
 */
export function confirmationCoordinatorDisposed(probe: DisposalProbe): boolean {
  if (probe.confirmationCoordinator === undefined)
    throw new Error('No coordinator reached actual injected acquisition');
  return flagOf(probe.confirmationCoordinator);
}

/**
 * Counts active subscriptions on the captured MessageBus by reading its
 * GENUINE internal surface. The real MessageBus (packages/policy/src/
 * confirmation-bus/message-bus.ts) holds a PRIVATE `emitter: EventEmitter`
 * and exposes `listenerCount(type)` (a FUNCTION requiring a `MessageBusType`
 * arg, NOT a number property) plus `removeAllListeners()`. It exposes NO
 * numeric tally property and NO backing array of subscribers — the previous
 * probe read fabricated fields that do not exist on the real bus and returned
 * -1, masking leaked subscriptions.
 *
 * The honest GREEN-reachable count is the total active listeners across ALL
 * event types on the underlying emitter: `emitter.eventNames().reduce((n, name)
 * => n + emitter.listenerCount(name), 0)`. P24 (dispose.md lines 50-52)
 * unsubscribes every recorded sub, driving this count toward the post-dispose
 * baseline (0 if createAgent is the only subscriber and all its subs are
 * recorded). This returns the genuine current count (a real number ≥0) — at RED
 * it reads the live bus's real listener set (≥0), at GREEN-after-dispose it is
 * the torn-down baseline. The helper is cast-exempt and narrows the emitter via
 * a typed `EmitterLike` accessor (no `any`).
 */
export function messageBusSubscriptionCount(probe: DisposalProbe): number {
  const bus = asRecord(probe.messageBus);
  if (bus === null) {
    return -1;
  }
  const emitter = readEmitter(bus);
  if (emitter === null) {
    return -1;
  }
  const names = emitter.eventNames();
  return names.reduce<number>((n, name) => n + emitter.listenerCount(name), 0);
}

/**
 * Narrowed view of the subset of `EventEmitter` the probe reads. Holds the two
 * methods used for the genuine subscription count. NO `any` — every member is
 * typed. The values are read off the real private `emitter` field of the
 * MessageBus via the cast-exempt helper.
 */
interface EmitterLike {
  eventNames(): Array<string | number | symbol>;
  listenerCount(eventName: string | number | symbol): number;
}

/**
 * Reads the MessageBus's private `emitter` (an `EventEmitter`) as an
 * `EmitterLike`. Cast-exempt helper: narrows via a typed record accessor and
 * validates the two methods exist before returning. Returns null when the bus
 * has no reachable emitter (e.g. before P15 wires the field).
 */
function readEmitter(bus: RecordLike): EmitterLike | null {
  const candidate = bus['emitter'];
  const rec = asRecord(candidate);
  if (rec === null) {
    return null;
  }
  const eventNames = rec['eventNames'];
  const listenerCount = rec['listenerCount'];
  if (typeof eventNames !== 'function' || typeof listenerCount !== 'function') {
    return null;
  }
  // Bound-method safe: invoke via the holder so `this` is the emitter.
  return {
    eventNames: () => eventNames.call(candidate) as unknown[],
    listenerCount: (name) => listenerCount.call(candidate, name) as number,
  } as EmitterLike;
}

/**
 * Reads the LSP teardown completion marker on the ownership record.
 *
 * The LSP teardown is a NET-NEW step (dispose.md line 70: "await safe(errors,
 * () => ownership.config.shutdownLspService()) — NET-NEW wiring"). The real
 * `shutdownLsp()` (lspIntegration.ts:388-419) clears `state.lspMcpClient`/
 * `lspMcpTransport`/`lspServiceClient = undefined`, but `LspState` (lines
 * 22-27) has NO boolean flag. The headless fake NEVER starts LSP, so
 * `getLspServiceClient()` is `undefined` BOTH before and after — no transition.
 *
 * Per dispose.md, dispose() orchestrates teardown through the OwnershipRecord
 * via the `safe(errors, fn)` accumulator (line 70). The GREEN-reachable,
 * impl-aligned contract is: P24 records the completion of each NET-NEW
 * teardown step on the ownership record. This reader reads the
 * `ownership.lspShutDown` boolean that P24 sets to `true` when
 * `config.shutdownLspService()` completes. This is legitimate TDD (pins the
 * observable behavior P24 must produce) and is uniformly GREEN-reachable: the
 * pre-dispose read is `false` (not-yet-shut-down), the post-dispose read is
 * `true` (shutdown completed).
 *
 * GREEN: dispose.md line 70 runs `config.shutdownLspService()` and P24 records
 * `ownership.lspShutDown = true`.
 */
export function lspDisposed(probe: DisposalProbe): boolean {
  const ownership = asRecord(probe.ownership);
  if (ownership === null) {
    return false;
  }
  // GREEN: dispose.md line 70 sets ownership.lspShutDown = true after
  // config.shutdownLspService() completes.
  return ownership['lspShutDown'] === true;
}

/**
 * Reads the extensions teardown completion marker on the ownership record.
 *
 * The extensions teardown is a NET-NEW step (dispose.md line 80: "await
 * safe(errors, () => ownership.extensionsManager.dispose()) — NET-NEW"). Config
 * has NO `extensionsManager` field — it only exposes `getExtensions()` via
 * `_extensionLoader` (configBaseCore.ts:591). `AgentConfig.extensions` is DATA
 * (config-types.ts:162), not a disposable. The headless fake never creates an
 * extensions manager, so the old reader read a non-existent field and returned
 * false forever.
 *
 * Per dispose.md, dispose() orchestrates teardown through the OwnershipRecord
 * via the `safe(errors, fn)` accumulator (line 80). The GREEN-reachable contract
 * is: P24 records the completion of this NET-NEW teardown step on the ownership
 * record. This reader reads `ownership.extensionsDisposed` that P24 sets to
 * `true` when `extensionsManager.dispose()` completes. Pre-dispose: `false`;
 * post-dispose: `true`.
 *
 * GREEN: dispose.md line 80 runs `extensionsManager.dispose()` and P24 records
 * `ownership.extensionsDisposed = true`.
 */
export function extensionsDisposed(probe: DisposalProbe): boolean {
  const ownership = asRecord(probe.ownership);
  if (ownership === null) {
    return false;
  }
  // GREEN: dispose.md line 80 sets ownership.extensionsDisposed = true after
  // extensionsManager.dispose() completes.
  return ownership['extensionsDisposed'] === true;
}

/**
 * Reads the session-lock teardown completion marker on the ownership record.
 *
 * The session-lock teardown is a NET-NEW step (dispose.md lines 81-82: "FOR lock
 * IN ownership.sessionLocks / await safe(errors, () => lock.release()) —
 * NET-NEW"). `SessionLockManager.release()` (SessionLockManager.ts:113-122)
 * uses a CLOSURE variable `released = true`, NOT a property on the returned
 * handle; `LockHandle` (lines 34-37) is `{ lockPath; release(): Promise<void> }`
 * — no `.released`. The headless fake never acquires a lock, so the old reader
 * found no lock and returned false forever.
 *
 * Per dispose.md, dispose() orchestrates teardown through the OwnershipRecord
 * via the `safe(errors, fn)` accumulator (lines 81-82). The GREEN-reachable
 * contract is: P24 records the completion of this NET-NEW teardown step on the
 * ownership record. This reader reads `ownership.sessionLocksReleased` that P24
 * sets to `true` when every captured lock's `release()` completes. Pre-dispose:
 * `false`; post-dispose: `true`.
 *
 * GREEN: dispose.md lines 81-82 run `lock.release()` for each captured lock and
 * P24 records `ownership.sessionLocksReleased = true`.
 */
export function sessionLocksReleased(probe: DisposalProbe): boolean {
  const ownership = asRecord(probe.ownership);
  if (ownership === null) {
    return false;
  }
  // GREEN: dispose.md lines 81-82 set ownership.sessionLocksReleased = true
  // after every captured lock's release() completes.
  return ownership['sessionLocksReleased'] === true;
}

// ─── Generic flag reader (no exported cast surface) ─────────────────────────

function flagOf(obj: unknown, key: string = 'disposed'): boolean {
  const rec = asRecord(obj);
  if (rec === null) {
    return false;
  }
  const v = rec[key];
  return v === true;
}

// ─── AggregateDisposeError structural predicates (cast-free for specs) ──────
//
// AggregateDisposeError is created at P24 (dispose.md line 101). Until then it
// does not exist and MUST NOT be imported (would break typecheck). These
// structural predicates let specs assert the aggregate shape WITHOUT importing
// the class — they check `e instanceof Error && e.name === 'AggregateDisposeError'
// && Array.isArray(errors)`. At RED dispose() throws a plain NotYetImplemented
// Error whose name !== 'AggregateDisposeError' → predicate returns false → spec
// fails naturally. At P24 the real AggregateDisposeError surfaces and the
// predicate returns true.

/**
 * Cast-free structural predicate: is `e` an AggregateDisposeError? True iff `e`
 * is an Error whose `name === 'AggregateDisposeError'` and which carries an
 * iterable `errors` array.
 */
export function isAggregateDisposeError(e: unknown): boolean {
  if (!(e instanceof Error)) {
    return false;
  }
  if (e.name !== 'AggregateDisposeError') {
    return false;
  }
  return Array.isArray(aggregateErrors(e));
}

/**
 * Cast-free accessor for the aggregate's `errors` array. Returns an empty
 * readonly array when the shape does not match (never throws).
 */
export function aggregateErrors(e: unknown): readonly unknown[] {
  const rec = asRecord(e);
  if (rec === null) {
    return [];
  }
  const errs = rec['errors'];
  return Array.isArray(errs) ? errs : [];
}

/**
 * Cast-free accessor for the aggregate error's human-readable `message`.
 * Returns the Error.message when `e` is an Error, else the empty string.
 * Lets specs assert the aggregate's summary text (count + joined detail)
 * without importing the AggregateDisposeError class.
 */
export function aggregateMessage(e: unknown): string {
  return e instanceof Error ? e.message : '';
}

export interface FakeExtension {
  readonly name: string;
  readonly version: string;
  readonly isActive: boolean;
  readonly path: string;
  readonly contextFiles: readonly string[];
}

class ExtensionDisposalOwner {
  private config!: Config;
  private settings!: SettingsService;
  private settingsOwner!: SessionSettingsOwner;
  private policy!: RuntimePolicyOwner;
  private mcp!: Awaited<ReturnType<typeof buildTestMcpRuntime>>;
  private manager!: ReturnType<typeof acquirePreferredProviderManager>;
  private oauth!: ReturnType<typeof acquirePreferredOAuth>;
  private owner!: SessionClientOwner;
  private media!: SessionMediaOwner;
  private tokenizer!: ReturnType<typeof configureProviderTokenizer>;
  private content!: ReturnType<typeof createRuntimeContentGeneratorFactory>;
  private readonly release = new AcquisitionRelease();
  private readonly runtimeId = 'extension-' + randomUUID();
  private readonly files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  private readonly rollbackSteps: Array<() => void | Promise<void>> = [];
  private previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
  private directory!: string;
  constructor(
    private readonly credentials: OwnedCredentialFixture,
    private readonly loader: SimpleExtensionLoader,
  ) {}

  async create(): Promise<Agent> {
    try {
      await this.openWorkspace();
      this.acquireProviders();
      await this.bindClient();
      await this.activate();
      return await fromConfig(
        this.config,
        this.settings,
        { mcpOwnership: 'agent' },
        this.settingsOwner,
        this.manager,
        undefined,
        undefined,
        this.mcp,
        undefined,
        capturedSessionClient(this.owner),
      );
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        settleEngineRelease(
          [...this.rollbackSteps].reverse(),
          this.previousReplay,
        ),
      );
      throw primary;
    }
  }
  private async openWorkspace(): Promise<void> {
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('../fixtures/plain-text.jsonl', import.meta.url),
    );
    this.directory = await realpath(
      await mkdtemp(join(tmpdir(), 'extension-disposal-')),
    );
    this.rollbackSteps.push(() =>
      rm(this.directory, { recursive: true, force: true }),
    );
    this.config = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: this.directory,
      }),
      enableExtensionReloading: true,
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    this.rollbackSteps.push(() => this.config.dispose());
    this.settings = new SettingsService();
    for (const [key, value] of Object.entries(this.config.getInitialSettings()))
      this.settings.set(key, value);
    this.policy = new RuntimePolicyOwner(this.config);
    this.rollbackSteps.push(() => this.policy.dispose());
    injectConfirmationForcingPolicy(this.policy.session.confirmation);
    this.mcp = await buildTestMcpRuntime(
      this.config,
      this.policy.session.messageBus,
      {},
      this.loader,
      this.policy,
    );
    this.rollbackSteps.push(() => this.mcp.dispose());
  }
  private acquireProviders(): void {
    this.rollbackSteps.push(() => this.release.rollback());
    this.settingsOwner = new SessionSettingsOwner(this.settings);
    this.release.acquire('settings', () => this.settingsOwner.dispose());
    this.settingsOwner.initializeProviderSelection(
      this.config.getProvider(),
      this.config.getModel(),
    );
    this.settingsOwner.bindTelemetry(this.config);
    for (const scope of [this.runtimeId, this.config.getSessionId()])
      this.release.acquire('files', () =>
        releaseAdoptedFileScope(this.files, scope),
      );
    this.manager = acquirePreferredProviderManager(
      this.config,
      this.settings,
      this.settingsOwner,
      this.files,
      this.runtimeId,
      this.credentials.authority,
      this.release,
    );
    const factoriesTokenizer = configureProviderTokenizer(this.manager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    this.tokenizer = factoriesTokenizer;
    this.content = factoriesContent;
    this.oauth = acquirePreferredOAuth(
      undefined,
      this.policy.session.messageBus,
      this.config,
      this.settings,
      this.manager,
      this.runtimeId,
      this.mcp.profileDefinitions,
      this.credentials.authority,
      this.release,
      undefined,
    );
  }
  private async bindClient(): Promise<void> {
    this.media = new SessionMediaOwner(
      this.config.projectTempDir,
      1024 * 1024 * 1024,
    );
    this.rollbackSteps.push(() => this.media.dispose());
    this.owner = await createCapturedSessionOwner(
      this.config,
      assembleTaskSchemaPolicy(this.settings),
      this.manager,
      createAgentRuntimeFactoryBindings().agentClientFactory,
      this.media.store,
      this.mcp.readInstructions,
      this.mcp.workspacePaths,
      this.settingsOwner,
      this.content,
      this.tokenizer,
    );
    this.rollbackSteps.push(() => this.owner.dispose());
    this.owner.bindMcpRuntime(this.mcp);
    this.owner.bindProviderFiles(this.files, (provider) =>
      this.oauth.composeRetryOperations(provider),
    );
    this.owner.bindHooks();
  }
  private async activate(): Promise<void> {
    await preparePreferredProviderCompletion(
      this.config,
      this.settings,
      this.settingsOwner,
      this.manager,
      this.oauth,
      this.runtimeId,
      this.tokenizer,
      undefined,
    );
    await this.mcp.initialize();
    const activation = await executeProviderActivation(
      this.config,
      { provider: this.config.getProvider(), model: this.config.getModel() },
      assembleProviderSwitch(
        this.config,
        this.settings,
        this.manager,
        this.oauth,
        () => 'agent',
        () => this.owner.refreshAuth(),
        this.settingsOwner,
      ),
      this.settings,
      this.manager,
      (method) => this.owner.refreshAuth(method),
      assembleModelSelection(this.settingsOwner),
    );
    requireCallerActivation(activation);
    await this.owner.initializeTools();
    await capturedSessionClient(this.owner).startChat();
  }
  private closing: Promise<void> | undefined;
  close(): Promise<void> {
    return (this.closing ??= settleEngineRelease(
      [
        () => this.owner.dispose(),
        () => this.release.close(),
        () => this.media.dispose(),
        () => this.mcp.dispose(),
        () => this.policy.dispose(),
        () => this.config.dispose(),
        () => rm(this.directory, { recursive: true, force: true }),
      ],
      this.previousReplay,
    ));
  }
}
export async function buildExtensionDisposalAgent(
  extensions: readonly FakeExtension[],
  missingUnload = false,
): Promise<{
  agent: Agent;
  cleanup(): Promise<void>;
  recorder: { readonly unloaded: readonly string[] };
}> {
  const credentials = await OwnedCredentialFixture.create();
  const data = extensions.map((extension) => ({
    ...extension,
    contextFiles: [...extension.contextFiles],
  }));
  const loader = new SimpleExtensionLoader([...data]);
  const owner = new ExtensionDisposalOwner(credentials, loader);
  const agent = await owner.create().catch(async (primary: unknown) => {
    await cleanupAfterFailure(primary, () => credentials.dispose());
    throw primary;
  });
  if (missingUnload)
    Object.defineProperty(loader, 'unloadExtension', { value: undefined });
  return {
    agent,
    recorder: {
      get unloaded(): readonly string[] {
        return data
          .filter((extension) => !loader.getExtensions().includes(extension))
          .map((extension) => extension.name);
      },
    },
    cleanup: async () => {
      await agent.dispose().catch(() => undefined);
      await owner.close().catch(() => undefined);
      await credentials.dispose();
    },
  };
}

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
