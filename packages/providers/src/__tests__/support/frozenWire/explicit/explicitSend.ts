/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: sends for the named counterexamples. A case may send
 * several times through one provider instance (a rejected stateful parent
 * followed by a second source), answer a request with an error, or use an
 * OAuth token, so this module takes the provider and the answers from the
 * case instead of building them.
 */

import { createHash } from 'node:crypto';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import type { IProvider, ProviderToolset } from '../../../../IProvider.js';
import {
  buildRouteCallOptions,
  installFakeTransport,
  type CapturedWireRequest,
  type MediaBinding,
  type WireRoute,
} from '../../wireBodyCapture.js';
import type { FrozenFormat } from '../frozenCases.js';
import { topLevelMember } from '../topLevelMember.js';

/** Stored verbatim next to its hash when this small. */
const MAX_STORED_BODY_BYTES = 8 * 1024;

export interface ObservedBody {
  readonly length: number;
  readonly sha256: string;
  /** Byte length of the history member (`messages` or `input`). */
  readonly member: number;
  readonly body?: string;
}

export interface ObservedThrow {
  readonly threw: string;
}

export type Observed = ObservedBody | ObservedThrow;

export interface ExplicitSend {
  readonly rows: readonly IContent[];
  readonly systemInstruction?: string;
  readonly tools?: ProviderToolset;
  readonly ephemerals?: Readonly<Record<string, unknown>>;
  readonly globalSettings?: Readonly<Record<string, unknown>>;
  readonly model?: string;
  readonly baseURL?: string;
  /** Replaces the resolved auth token (an OAuth token selects OAuth mode). */
  readonly authToken?: string;
  readonly providerSettings?: Readonly<Record<string, unknown>>;
  /** Answers the n-th request of the send; the route's own answer otherwise. */
  readonly respond?: (requestIndex: number) => Response;
}

export function observeBody(
  request: CapturedWireRequest,
  member: string,
): ObservedBody {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(request.bytes);
  const memberText = topLevelMember(text, member);
  if (memberText === undefined) {
    throw new Error(`request body has no ${member} member`);
  }
  const record = {
    length: request.bytes.byteLength,
    sha256: createHash('sha256').update(request.bytes).digest('hex'),
    member: Buffer.byteLength(memberText),
  };
  return request.bytes.byteLength > MAX_STORED_BODY_BYTES
    ? record
    : { ...record, body: text };
}

function routeFor(format: FrozenFormat, send: ExplicitSend): WireRoute {
  return {
    ...format.route,
    model: send.model ?? format.route.model,
    baseURL: send.baseURL ?? format.route.baseURL,
    providerSettings: {
      ...format.route.providerSettings,
      ...send.providerSettings,
    },
    respond: () => format.route.respond(),
  };
}

/** One send through `provider`; returns every model request it produced. */
export async function sendThrough(
  format: FrozenFormat,
  provider: IProvider,
  send: ExplicitSend,
): Promise<Observed[]> {
  const route = routeFor(format, send);
  let requestIndex = 0;
  const answering: WireRoute = {
    ...route,
    respond: () =>
      send.respond === undefined
        ? route.respond()
        : send.respond(requestIndex++),
  };
  const captured: CapturedWireRequest[] = [];
  const restore = installFakeTransport(answering, captured);
  let threw: string | undefined;
  try {
    const built = buildRouteCallOptions(
      route,
      {
        ...(send.tools === undefined ? {} : { tools: send.tools }),
        ...(send.systemInstruction === undefined
          ? {}
          : { systemInstruction: send.systemInstruction }),
        ...(send.ephemerals === undefined
          ? {}
          : { ephemerals: send.ephemerals }),
        ...(send.globalSettings === undefined
          ? {}
          : { globalSettings: send.globalSettings }),
      },
      send.rows.map((row) => structuredClone(row)),
      new SettingsService(),
    );
    const options =
      send.authToken === undefined
        ? built
        : {
            ...built,
            resolved: { ...built.resolved, authToken: send.authToken },
          };
    for await (const chunk of provider.generateChatCompletion(options)) {
      void chunk;
    }
  } catch (error) {
    // A rejected send is part of what the case freezes.
    threw = error instanceof Error ? error.message : String(error);
  } finally {
    restore();
  }
  const bodies: Observed[] = captured
    .filter((request) => new URL(request.url).pathname.endsWith(route.endpoint))
    .map((request) => observeBody(request, format.historyMember));
  return threw === undefined ? bodies : [...bodies, { threw }];
}

/** One send through a fresh provider of the format's route. */
export function sendFresh(
  format: FrozenFormat,
  send: ExplicitSend,
  media?: MediaBinding,
): Promise<Observed[]> {
  const created = routeFor(format, send).createProvider();
  const provider =
    media === undefined
      ? created
      : bindProviderMedia(created, media.resolver, media.budgetBytes);
  return sendThrough(format, provider, send);
}
