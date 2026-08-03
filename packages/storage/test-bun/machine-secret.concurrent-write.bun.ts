/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic concurrency acceptance tests for the machine-secret provider
 * (issue #2927, T5).
 *
 * These tests prove serialization WITHOUT relying on sleep, timer values,
 * or wall-clock measurements for correctness. Instead they use:
 *
 *  - A shared backing store (Map) over which two independently TAGGED
 *    keyring facades are layered. Each facade appends an event record with a
 *    monotonically increasing counter (NOT a timestamp) to a shared array.
 *  - A deferred promise (releaseA) that holds caller A inside its critical
 *    section until the test explicitly resolves it, so the test can PROVE
 *    caller B is blocked on the lock (B records zero events while A holds
 *    it) before letting A proceed.
 *
 * Why the previous timing-based approach was flaky:
 *  (i) Under CI load the intended overlap window can be missed entirely, so
 *      operations run sequentially and the test passes for the WRONG reason.
 *  (ii) setCount === 1 is also satisfied when the second caller never
 *       contests the lock at all (e.g. it observes a cached value), so the
 *       assertion cannot distinguish real serialization from a cache
 *       short-circuit.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R3, R5
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { KeyringAdapter } from '../src/secure-store/secure-store.js';
import {
  getMachineSecret,
  resetMachineSecretCache,
} from '../src/secure-store/machine-secret.js';

/**
 * A tagged event record appended to a shared array. The counter is
 * monotonically increasing (NOT a timestamp) so ordering assertions are
 * deterministic regardless of scheduler timing.
 */
interface CriticalSectionEvent {
  readonly tag: 'A' | 'B';
  readonly op: 'setPassword-enter' | 'setPassword-exit';
  readonly seq: number;
}

/**
 * Creates a simple non-blocking shared keyring with event instrumentation.
 * Used by the coalescing test where the point is that both callers share one
 * in-flight promise and converge on the same winner — no deferred-release
 * hook is needed.
 */
function createSharedKeyring(): {
  keyring: KeyringAdapter;
  store: Map<string, string>;
  events: CriticalSectionEvent[];
  setCount: () => number;
  deleteCount: () => number;
} {
  const store = new Map<string, string>();
  const events: CriticalSectionEvent[] = [];
  let counter = 0;
  let setCount = 0;
  let deleteCount = 0;

  const keyring: KeyringAdapter = {
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      events.push({ tag: 'A', op: 'setPassword-enter', seq: counter });
      counter += 1;
      setCount += 1;
      store.set(`${service}:${account}`, password);
      events.push({ tag: 'A', op: 'setPassword-exit', seq: counter });
      counter += 1;
    },
    deletePassword: async (service: string, account: string) => {
      deleteCount += 1;
      return store.delete(`${service}:${account}`);
    },
  };

  return {
    keyring,
    store,
    events,
    setCount: () => setCount,
    deleteCount: () => deleteCount,
  };
}

/**
 * Creates a single shared backing store plus two independently TAGGED
 * keyring facades over it. Both facades share ONE Map so the durable state
 * they read/write is identical — exactly like two processes sharing one
 * OS keyring. Each facade appends events to a shared array so the test can
 * observe critical-section entry/exit ordering.
 *
 * The returned `releaseA` deferred lets the test hold caller A's
 * setPassword inside the critical section until the test is ready.
 */
function createTaggedSharedKeyrings(): {
  keyringA: KeyringAdapter;
  keyringB: KeyringAdapter;
  store: Map<string, string>;
  events: CriticalSectionEvent[];
  setCount: () => number;
  deleteCount: () => number;
  releaseA: () => void;
} {
  const store = new Map<string, string>();
  const events: CriticalSectionEvent[] = [];
  let counter = 0;
  let setCount = 0;
  let deleteCount = 0;

  // Deferred promise that caller A's setPassword awaits, letting the test
  // hold A inside its critical section.
  let releaseAFn: () => void = () => undefined;
  const releaseAPromise = new Promise<void>((resolve) => {
    releaseAFn = resolve;
  });

  const record = (
    tag: 'A' | 'B',
    op: 'setPassword-enter' | 'setPassword-exit',
  ): void => {
    events.push({ tag, op, seq: counter });
    counter += 1;
  };

  const keyringFor = (tag: 'A' | 'B'): KeyringAdapter => ({
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      record(tag, 'setPassword-enter');
      if (tag === 'A') {
        // Caller A blocks inside its critical section until the test
        // resolves releaseA. This is the deterministic hook that lets the
        // test prove caller B is blocked on the lock, not on timing.
        await releaseAPromise;
      }
      setCount += 1;
      store.set(`${service}:${account}`, password);
      record(tag, 'setPassword-exit');
    },
    deletePassword: async (service: string, account: string) => {
      deleteCount += 1;
      return store.delete(`${service}:${account}`);
    },
  });

  return {
    keyringA: keyringFor('A'),
    keyringB: keyringFor('B'),
    store,
    events,
    setCount: () => setCount,
    deleteCount: () => deleteCount,
    releaseA: () => releaseAFn(),
  };
}

/**
 * Yields to the event loop for a bounded number of macrotask turns so any
 * pending microtasks/macrotasks get a chance to run. Used to prove that a
 * caller is blocked: if B were NOT blocked on the lock it would have
 * recorded events by now. Waiting more turns can only strengthen this
 * assertion, never weaken it, so it is not flaky in the dangerous direction.
 */
async function yieldNTurns(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Narrows an array element to non-undefined at runtime. Used instead of a
 * non-null assertion or an inline conditional (both are banned by ESLint in
 * test files) after a length assertion has already guaranteed the element
 * exists.
 */
function requireElement<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) {
    throw new Error(
      `Expected element at index ${index} but array has length ${arr.length}`,
    );
  }
  return value;
}

describe('Machine Secret Provider — concurrent write acceptance (issue #2927, T5)', () => {
  let tempDir: string;
  let tempFilePath: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'machine-secret-concurrent-'),
    );
    tempFilePath = path.join(tempDir, 'machine_secret');
    lockDir = path.join(tempDir, 'locks');
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('two in-process resolutions sharing one loader reference coalesce and converge on one secret (non-timing assertions)', async () => {
    // A single shared keyringLoader reference means both calls share the
    // same module-level in-flight promise, so the second caller piggybacks
    // on the first resolution and converges on the same winner.
    const { keyring, store, events, setCount, deleteCount } =
      createSharedKeyring();
    const keyringLoader = async (): Promise<KeyringAdapter | null> => keyring;
    const sharedOptions = {
      filePath: tempFilePath,
      keyringLoader,
      lockDir,
    };

    const [secretA, secretB] = await Promise.all([
      getMachineSecret(sharedOptions),
      getMachineSecret(sharedOptions),
    ]);

    // Both non-null.
    expect(secretA).not.toBeNull();
    expect(secretB).not.toBeNull();
    const a: Buffer = secretA ?? Buffer.alloc(0);
    const b: Buffer = secretB ?? Buffer.from('__mismatch__');
    // Both converge on the SAME secret.
    expect(Buffer.compare(a, b)).toBe(0);

    // Exactly one setPassword (the winning write).
    expect(setCount()).toBe(1);
    // Zero deletions.
    expect(deleteCount()).toBe(0);

    // Exactly one durable value in the store.
    const stored = store.get('llxprt-code-machine-secret:default');
    expect(stored).toBeDefined();
    expect(Buffer.compare(Buffer.from(stored ?? '', 'base64'), a)).toBe(0);

    // With coalescing only ONE caller ever reaches the keyring, so there is
    // exactly one enter/exit pair and they are correctly ordered.
    const enters = events.filter((e) => e.op === 'setPassword-enter');
    const exits = events.filter((e) => e.op === 'setPassword-exit');
    expect(enters.length).toBe(1);
    expect(exits.length).toBe(1);
    expect(requireElement(enters, 0).seq).toBeLessThan(
      requireElement(exits, 0).seq,
    );
  });

  it('two resolutions with distinct loader references serialize through the filesystem lock — B is provably blocked (H2)', async () => {
    const {
      keyringA,
      keyringB,
      store,
      events,
      setCount,
      deleteCount,
      releaseA,
    } = createTaggedSharedKeyrings();

    // Two DISTINCT keyringLoader function references — so the module-level
    // in-flight coalescing cache does NOT merge them. They share one adapter
    // backing store and one lockDir, so they MUST serialize through the
    // filesystem lock.
    const loaderA = async (): Promise<KeyringAdapter | null> => keyringA;
    const loaderB = async (): Promise<KeyringAdapter | null> => keyringB;

    // 1) Start call A. A's facade blocks inside the critical section on
    //    releaseA.
    const promiseA = getMachineSecret({
      filePath: tempFilePath,
      keyringLoader: loaderA,
      lockDir,
    });

    // 2) Wait until A has recorded that it is INSIDE the critical section
    //    (setPassword-enter). Poll the shared events array.
    const deadline = Date.now() + 5_000;
    while (!events.some((e) => e.tag === 'A' && e.op === 'setPassword-enter')) {
      if (Date.now() > deadline) {
        throw new Error(
          'Caller A never entered its critical section within 5s',
        );
      }
      await yieldNTurns(1);
    }

    // 3) Only NOW start call B — after A is provably inside the lock.
    const promiseB = getMachineSecret({
      filePath: tempFilePath,
      keyringLoader: loaderB,
      lockDir,
    });

    // 4) Assert B has recorded ZERO events after allowing several macrotask
    //    turns. If B were not blocked on the lock it would have recorded
    //    events (B's getPassword would run immediately, and B would reach
    //    setPassword). Waiting more turns can only make this more reliable.
    await yieldNTurns(20);
    const bEvents = events.filter((e) => e.tag === 'B');
    expect(bEvents).toStrictEqual([]);

    // 5) Resolve releaseA so A can complete and release the lock, letting B
    //    proceed.
    releaseA();

    const [secretA, secretB] = await Promise.all([promiseA, promiseB]);

    // Both must be non-null.
    expect(secretA).not.toBeNull();
    expect(secretB).not.toBeNull();

    // Both must converge on the SAME secret.
    const a: Buffer = secretA ?? Buffer.alloc(0);
    const b: Buffer = secretB ?? Buffer.from('__mismatch__');
    expect(Buffer.compare(a, b)).toBe(0);

    // Exactly one setPassword call — both converged on a single winner.
    // (B re-reads the keyring under the lock and finds A's value.)
    expect(setCount()).toBe(1);
    // Zero deletions.
    expect(deleteCount()).toBe(0);

    // Critical sections do NOT interleave: no window of tag A overlaps tag
    // B. Each enter must be followed by its matching exit before the other
    // tag's enter can appear (verified by the sequence ordering of
    // enter/exit pairs).
    const aEnter = events.find(
      (e) => e.tag === 'A' && e.op === 'setPassword-enter',
    );
    const aExit = events.find(
      (e) => e.tag === 'A' && e.op === 'setPassword-exit',
    );
    // A entered and exited (A was the winner).
    expect(aEnter).toBeDefined();
    expect(aExit).toBeDefined();
    // Use requireElement to narrow at runtime instead of a non-null
    // assertion (banned) or an inline conditional (banned in tests).
    const allEnters = events.filter(
      (e) => e.tag === 'A' && e.op === 'setPassword-enter',
    );
    const allExits = events.filter(
      (e) => e.tag === 'A' && e.op === 'setPassword-exit',
    );
    expect(requireElement(allEnters, 0).seq).toBeLessThan(
      requireElement(allExits, 0).seq,
    );
    // B never reached setPassword (B observed A's persisted value under the
    // lock), so there is no B enter/exit pair.
    const bEnter = events.find(
      (e) => e.tag === 'B' && e.op === 'setPassword-enter',
    );
    expect(bEnter).toBeUndefined();

    // Exactly one durable value in the store: the keyring holds the winning
    // secret and the file fallback also holds it (or the keyring alone if
    // its read-back succeeded). The two callers agreed on one value.
    const stored = store.get('llxprt-code-machine-secret:default');
    expect(stored).toBeDefined();
    expect(Buffer.compare(Buffer.from(stored ?? '', 'base64'), a)).toBe(0);
  });
});
