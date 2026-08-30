/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Context-dump seam for the Responses executor (issues #3159, #3140).
 *
 * Split out of openAIResponsesExecutor.ts, which #2771 and #2772 both grew
 * and together pushed past the 800-line max-lines budget. Dumping is a
 * self-contained diagnostics concern with no callers outside the executor.
 */

import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import {
  shouldDumpSDKContext,
  dumpSDKRequestContext,
  type RequestDumpMetadata,
  bestEffortDump,
} from '../utils/dumpSDKContext.js';
import { buildHttpDumpMetadata } from './openAIResponsesHttpStream.js';
import type { DumpMode } from '../utils/dumpContext.js';

import type {
  RequestContext,
  ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { StreamResponsesParams } from './openAIResponsesHttpStream.js';
import { CODEX_WEBSOCKET_BETA_HEADER } from './openAIResponsesWebSocketTransport.js';

/**
 * Convert an https/http base URL to its WebSocket scheme for the dump so the
 * recorded URL reveals the WebSocket transport even when the WebSocket handshake
 * itself does not surface a URL (#3159).
 */
export function toWebSocketDumpURL(httpsURL: string): string {
  return httpsURL.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

export interface DumpFinalizedResult {
  baseId?: string;
  dumpMode?: DumpMode;
}

/**
 * Dumps the finalized Responses request at the common pre-transport seam when
 * context dumping is enabled, matching OpenAI Chat and Anthropic parity.
 * Records the REAL headers the transport will send (credentials redacted on
 * write) and a transport discriminator so WebSocket dumps are distinguishable
 * from HTTP POSTs (issue #3159).
 * Best-effort: failures are logged and never block the request.
 * Returns the dump base id and resolved mode so the transport can write a
 * linked error-response dump on failure (issue #3140).
 */
export async function dumpFinalizedRequest(
  requestContext: RequestContext,
  invocationEphemerals: Record<string, unknown>,
  deps: ResponsesExecutorDeps,
  options: NormalizedGenerateChatOptions,
  sentOverHttp = false,
): Promise<DumpFinalizedResult> {
  const dumpMode = invocationEphemerals['dumpcontext'] as DumpMode | undefined;
  if (!shouldDumpSDKContext(dumpMode, false)) {
    return { dumpMode };
  }
  // A stateless rebuild only exists to be sent over HTTP (the WebSocket
  // fallback path), so it must be dumped with HTTP transport metadata even
  // while the WebSocket transport is still the active choice for fresh
  // requests (#3159).
  const transportActive =
    !sentOverHttp && (deps.isWebSocketTransportActive?.() ?? false);
  let dumpMetadata: RequestDumpMetadata;
  let baseURLForDump: string;
  try {
    if (transportActive) {
      dumpMetadata = {
        headers: await buildWebSocketHandshakeHeaders(
          { apiKey: requestContext.apiKey, normalizedOptions: options },
          deps,
        ),
        transport: { type: 'websocket', frameType: 'response.create' },
      };
      baseURLForDump = toWebSocketDumpURL(requestContext.baseURL);
    } else {
      dumpMetadata = await buildHttpDumpMetadata(
        {
          apiKey: requestContext.apiKey,
          isCodex: requestContext.isCodex,
          normalizedOptions: options,
        },
        deps,
      );
      baseURLForDump = requestContext.baseURL;
    }
  } catch (error) {
    deps.logger.debug(
      () =>
        `Best-effort dump metadata failed for ${deps.providerName}: ${String(error)}`,
    );
    // Header observation failed, but the selected transport is still known;
    // keep recording it honestly instead of relabeling the request as HTTP.
    // An explicitly empty header map means "nothing observed" — passing no
    // headers here would make the dump synthesize legacy default headers
    // the transport never sent.
    dumpMetadata = {
      headers: {},
      transport: transportActive
        ? { type: 'websocket', frameType: 'response.create' }
        : { type: 'http' },
    };
    baseURLForDump = transportActive
      ? toWebSocketDumpURL(requestContext.baseURL)
      : requestContext.baseURL;
  }
  const result = await bestEffortDump(
    'request',
    deps.providerName,
    () =>
      dumpSDKRequestContext(
        deps.providerName,
        '/responses',
        requestContext.request,
        baseURLForDump,
        dumpMetadata,
      ),
    deps.logger,
  );
  return { baseId: result?.baseId, dumpMode };
}

/**
 * Builds the WebSocket handshake headers.
 *
 * Lives here rather than in the executor so the runtime dependency runs one
 * way (executor -> dump): the dump has to record the exact headers the
 * handshake will send, and the executor needs the same values to perform it.
 */
export async function buildWebSocketHandshakeHeaders(
  params: Pick<StreamResponsesParams, 'apiKey' | 'normalizedOptions'>,
  deps: ResponsesExecutorDeps,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    ...(deps.getCustomHeaders(params.normalizedOptions) ?? {}),
  };
  headers['ChatGPT-Account-ID'] = await deps.getCodexAccountId();
  headers['originator'] = 'codex_cli_rs';
  const invocationSessionId = params.normalizedOptions.invocation.runtimeId;
  const sessionId =
    typeof invocationSessionId === 'string' && invocationSessionId.trim() !== ''
      ? invocationSessionId
      : params.normalizedOptions.runtime?.runtimeId;
  if (typeof sessionId === 'string' && sessionId.trim() !== '') {
    headers['session-id'] = sessionId;
    headers['thread-id'] = sessionId;
    headers['x-client-request-id'] = sessionId;
  }
  headers['OpenAI-Beta'] = CODEX_WEBSOCKET_BETA_HEADER;
  return headers;
}
