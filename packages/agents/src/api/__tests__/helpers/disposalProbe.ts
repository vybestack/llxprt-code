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

import type { Agent } from '@vybestack/llxprt-code-agents';

// ─── Internal record narrowing (cast-exempt in the helper) ──────────────────

interface RecordLike {
  readonly [key: string]: unknown;
}

function asRecord(v: unknown): RecordLike | null {
  return typeof v === 'object' && v !== null ? (v as RecordLike) : null;
}

/**
 * Narrows the opaque public `Agent` to its AgentImpl internals WITHOUT
 * exporting a cast. This narrowing lives ONLY in this helper; specs receive
 * {@link Agent} and pass it to {@link captureProbe}.
 */
function agentInternals(agent: Agent): RecordLike {
  return agent as unknown as RecordLike;
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

/**
 * Captures the disposal probe snapshot from a built agent. Call BEFORE
 * `agent.dispose()`. Every field is read via a guarded structural probe of the
 * AgentImpl internals; absent fields yield `null`. The captured references are
 * what the post-dispose flag reads observe.
 */
export function captureProbe(agent: Agent): DisposalProbe {
  const impl = agentInternals(agent);
  return {
    agentClient: readField(impl, 'agentClient'),
    scheduler:
      readField(impl, 'injectedFactoryScheduler') ??
      readField(impl, 'scheduler'),
    confirmationCoordinator:
      readField(impl, 'injectedFactoryCoordinator') ??
      readField(impl, 'confirmationCoordinator'),
    messageBus: readField(impl, 'messageBus') ?? readField(impl, 'bus'),
    // dispose.md §Interface Contracts: `dispose(ownership: OwnershipRecord)`.
    // The ownership record is recorded at createAgent line 141 (per dispose.md)
    // and held by the facade. P24's dispose() receives it and sets per-resource
    // teardown completion markers for the NET-NEW steps. Captured pre-dispose so
    // the post-dispose reads observe the markers set on the SAME record.
    ownership: readField(impl, 'ownership'),
  };
}

function readField(rec: RecordLike, key: string): unknown {
  if (key in rec) {
    const v = rec[key];
    if (v !== undefined && v !== null) {
      return v;
    }
  }
  return null;
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
 * Reads the agentClient disposed state by observing the GENUINE state
 * transition of its runtime-subscription handle. The real `AgentClient`
 * constructor (client.ts:146) sets `this._unsubscribe =
 * subscribeToAgentRuntimeState(...)` (a function). `AgentClient.dispose()`
 * (client.ts:263-265) calls `this._unsubscribe()` then sets
 * `this._unsubscribe = undefined`. There is NO `disposed`/`isDisposed` boolean
 * on AgentClient — the genuine observable is the `_unsubscribe` handle
 * transitioning `function → undefined`.
 *
 * This reader returns `true` when `_unsubscribe` is `undefined` (disposed) and
 * `false` when it is a `function` (still subscribed). The headless fake client
 * IS constructed by Config.refreshAuth and its constructor DOES set
 * `_unsubscribe` (client.ts:146), so the pre-dispose state is genuinely
 * "subscribed" (function) and the post-dispose state is genuinely
 * "unsubscribed" (undefined) — a real transition, not undefined→undefined.
 *
 * GREEN: client.ts:146 sets `_unsubscribe` (function); client.ts:263-265 sets
 * `_unsubscribe = undefined` on dispose.
 */
export function agentClientDisposed(probe: DisposalProbe): boolean {
  const client = asRecord(probe.agentClient);
  if (client === null) {
    return false;
  }
  const unsub = client['_unsubscribe'];
  // GREEN: client.ts:263-265 sets `_unsubscribe = undefined` on dispose.
  // Pre-dispose (client.ts:146): `_unsubscribe` is a function → false.
  // Post-dispose: `_unsubscribe` is undefined → true.
  return unsub === undefined;
}

/**
 * Reads the facade-held injected-factory scheduler disposed flag. At P24
 * dispose() line 41 calls `injectedFactoryScheduler.dispose()` which sets
 * `disposed = true` on the captured handle.
 */
export function schedulerDisposed(probe: DisposalProbe): boolean {
  return flagOf(probe.scheduler);
}

/**
 * Reads the confirmationCoordinator disposed flag. At P24 dispose() line 46
 * calls `injectedFactoryCoordinator.dispose()`.
 */
export function confirmationCoordinatorDisposed(probe: DisposalProbe): boolean {
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

// ─── Extension-teardown observation (dispose.md line 80) ────────────────────
//
// dispose() tears down active extensions via the Config-owned ExtensionLoader:
// it reads `config.getExtensionLoader().getExtensions()`, filters to
// `isActive`, and calls `loader.unloadExtension(ext)` for each active one
// (agentImpl.ts collectActiveExtensions / unloadExtensionSafely). The headless
// fake Config exposes a loader with ZERO extensions, so the active-extension
// teardown path (the isActive filter + the unload call) is never exercised.
//
// This installer replaces the captured Config's `getExtensionLoader` with a
// fake loader carrying a caller-supplied extension set, and records the NAMES
// of every extension actually passed to `unloadExtension`. The disposal spec
// then asserts the OBSERVABLE contract: ONLY active extensions are unloaded
// (inactive ones are filtered out), in encounter order. This is genuine
// behavioral observation of the teardown's filtering output — not a spy
// call-count substituted for behavior.

/**
 * Minimal structural view of a GeminiCLIExtension as needed for teardown
 * observation. Mirrors core configTypes.GeminiCLIExtension's teardown-relevant
 * fields (name + isActive); the loader only reads these during unload.
 */
export interface FakeExtension {
  readonly name: string;
  readonly version: string;
  readonly isActive: boolean;
  readonly path: string;
  readonly contextFiles: readonly string[];
}

/**
 * Records the observable result of the extension-teardown step: the ordered
 * list of extension names actually unloaded during dispose().
 */
export interface ExtensionTeardownRecorder {
  /** Names of extensions passed to loader.unloadExtension(), in call order. */
  readonly unloaded: readonly string[];
}

interface MutableRecorder {
  unloaded: string[];
}

/**
 * Installs a fake extension loader on the captured Config so that dispose()'s
 * active-extension teardown path runs against a known extension set. Returns a
 * recorder whose `unloaded` array is populated (in call order) with the name of
 * every extension dispose() passes to `unloadExtension`. Call BEFORE
 * `agent.dispose()`.
 *
 * The fake loader surfaces exactly the two methods dispose() probes
 * (`getExtensions`, `unloadExtension`), matching the real ExtensionLoader's
 * teardown surface. `getExtensions` returns the supplied list verbatim;
 * `unloadExtension` records the received extension's name. dispose() filters to
 * `isActive` before calling unloadExtension, so the recorder observes ONLY the
 * active extensions — the genuine filtering contract.
 */
/**
 * Cast-free accessor for the probe's owned Config record. The disposal probe
 * always wires an owned Config; a missing ownership/config indicates broken
 * test setup, so this throws rather than silently returning an inert recorder.
 */
function requireProbeConfig(probe: DisposalProbe): Record<string, unknown> {
  const ownership = asRecord(probe.ownership);
  if (ownership === null) {
    throw new Error('disposal probe is missing its ownership record');
  }
  const config = asRecord(ownership['config']);
  if (config === null) {
    throw new Error('disposal probe ownership is missing its config');
  }
  return config;
}

export function installFakeExtensionLoader(
  probe: DisposalProbe,
  extensions: readonly FakeExtension[],
): ExtensionTeardownRecorder {
  const recorder: MutableRecorder = { unloaded: [] };
  const config = requireProbeConfig(probe);
  const fakeLoader = {
    getExtensions(): readonly FakeExtension[] {
      return extensions;
    },
    unloadExtension(extension: FakeExtension): void {
      recorder.unloaded.push(extension.name);
    },
  };
  // Override the Config-owned loader accessor with one returning the fake.
  const mutableConfig = config as { getExtensionLoader?: () => unknown };
  mutableConfig.getExtensionLoader = (): unknown => fakeLoader;
  return recorder;
}

/**
 * Installs a fake extension loader whose object does NOT expose the optional
 * `unloadExtension` method, exercising dispose()'s defensive guard
 * (unloadExtensionSafely skips loaders lacking the method rather than
 * crashing). Returns a recorder that — because the method is absent — stays
 * empty even though active extensions are present. The spec asserts dispose()
 * completes without throwing AND nothing was unloaded.
 */
export function installLoaderWithoutUnload(
  probe: DisposalProbe,
  extensions: readonly FakeExtension[],
): ExtensionTeardownRecorder {
  const recorder: MutableRecorder = { unloaded: [] };
  const config = requireProbeConfig(probe);
  const fakeLoader = {
    getExtensions(): readonly FakeExtension[] {
      return extensions;
    },
  };
  const mutableConfig = config as { getExtensionLoader?: () => unknown };
  mutableConfig.getExtensionLoader = (): unknown => fakeLoader;
  return recorder;
}
