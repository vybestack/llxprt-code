/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Request-scoped wire-body lease (issue #854, P05b4).
 *
 * One lease per physical transport call: the provider builds its SDK-shaped
 * body and hands it to the SDK inside the lease, then releases the lease once
 * the call settles (any outcome). Arrays inside the body graph are owned by
 * the lease — release() splices them so no wire array outlives the request
 * that sent it.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { collectContents } from './collectContents.js';

/** Any object graph handed to a provider SDK as a request body. */
type BodyGraph = Record<string, unknown>;

function computeByteLength(value: unknown): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf-8');
  return -1;
}

function spliceOwnedArrays(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  const graph = value as BodyGraph;
  for (const key of Object.keys(graph)) {
    const entry = graph[key];
    if (Array.isArray(entry)) entry.splice(0);
  }
}

/**
 * A wire body built for exactly one transport call (issue #854 P05b4).
 * `value` is the SDK-shaped object graph (e.g. the Anthropic/Responses
 * request object, or the OpenAI messages array). Arrays inside it are owned
 * by the lease: release() splices them so nothing outlives the request.
 */
export interface RequestScopedBody<T> {
  /** The SDK-shaped body. Throws if the lease was released. */
  readonly value: T;
  /** Provider name the lease was acquired for (telemetry/debug only). */
  readonly provider: string;
  /** Byte length of the serialized body when cheaply known; -1 otherwise. */
  readonly byteLength: number;
  /**
   * Splices every array the lease owns and drops the body graph. Idempotent;
   * second and later calls resolve without effect.
   */
  release(): Promise<void>;
}

const activeLeases = new Set<object>();

class RequestScopedBodyLease<T> implements RequestScopedBody<T> {
  readonly provider: string;
  readonly byteLength: number;

  private released = false;
  private payload: T | undefined;

  constructor(provider: string, payload: T) {
    this.provider = provider;
    this.payload = payload;
    this.byteLength = computeByteLength(payload);
    activeLeases.add(this);
  }

  get value(): T {
    const current = this.payload;
    if (this.released || current === undefined) {
      throw new Error(
        'Request-scoped body consumed after release (issue #854 P05b4)',
      );
    }
    return current;
  }

  release(): Promise<void> {
    if (this.released) return Promise.resolve();
    this.released = true;
    const current = this.payload;
    if (current !== undefined) spliceOwnedArrays(current);
    this.payload = undefined;
    activeLeases.delete(this);
    return Promise.resolve();
  }
}

/**
 * Acquires a lease over an already-built body. Use this only when the body's
 * lifetime is managed by an external request-scoped owner (e.g. the media
 * request) that is guaranteed to call release() when the request settles;
 * otherwise prefer {@link withRequestScopedBody}.
 */
export function acquireRequestScopedBody<T>(
  provider: string,
  value: T,
): RequestScopedBody<T> {
  return new RequestScopedBodyLease(provider, value);
}

/**
 * Runs `consume` with a lease over a body built by `build`. Acquires before
 * `build`, releases after `consume` settles (success or throw), and
 * propagates the consumer's error after releasing. The body never outlives
 * this call.
 */
export async function withRequestScopedBody<T, R>(
  provider: string,
  build: () => T,
  consume: (body: RequestScopedBody<T>) => Promise<R>,
): Promise<R> {
  const body = acquireRequestScopedBody(provider, build());
  try {
    return await consume(body);
  } finally {
    await body.release();
  }
}

/** Global count of currently-acquired leases (in-flight bound probe). */
export function activeRequestBodyCount(): number {
  return activeLeases.size;
}

/**
 * Memoized materialization of a one-shot history source (issue #854 P05b4).
 * The transport holds one of these per request: the first `materialize()`
 * drains the source inside the request-scoped lease, and every later consumer
 * (input rebuilds, retry recovery, stateless fallbacks) resolves the SAME
 * array instead of draining the exhausted source again.
 */
export interface RequestScopedContents {
  /** Drains the source exactly once; later calls resolve the same array. */
  materialize(): Promise<IContent[]>;
  /** True once the source has been drained (or a drain is in flight). */
  readonly isMaterialized: boolean;
}

export function requestScopedContents(
  source: AsyncIterable<IContent>,
): RequestScopedContents {
  let drain: Promise<IContent[]> | undefined;
  return {
    get isMaterialized(): boolean {
      return drain !== undefined;
    },
    materialize(): Promise<IContent[]> {
      drain ??= collectContents(source);
      return drain;
    },
  };
}
