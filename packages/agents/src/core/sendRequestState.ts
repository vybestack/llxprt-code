/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSessionConfig } from './chatSession.js';
import type { ToolSelectionHookResult } from './streamRequestHelpers.js';

/**
 * A provider-ready request as it left the BeforeModel hook and the context
 * enforcement: the contents the provider is sent, the tool selection and the
 * system prompt of that moment (issue #4036).
 */
export interface ProviderReadyRequest {
  readonly contents: IContent[];
  readonly toolSelection: ToolSelectionHookResult;
  readonly systemInstruction: ChatSessionConfig['systemInstruction'];
}

/**
 * What one streamed send remembers across its attempts. An identical resend
 * of a refused request must send the request that was refused, so the request
 * is kept after it is built and replayed instead of rebuilt from the live
 * history (which may have moved) and run through the hooks again (which may
 * not answer the same way). A content retry or a reviewer rewrite changes what
 * should be sent, so it discards the kept request and the next attempt builds
 * a new one.
 */
export class SendRequestState {
  private kept: ProviderReadyRequest | undefined;
  private replay = false;
  private started = 0;

  /** Marks the start of an attempt; true when an earlier one ran in this send. */
  begin(): boolean {
    const isResend = this.started > 0;
    this.started += 1;
    return isResend;
  }

  /** The request the next attempt must resend as it is, if it is an identical resend. */
  replayable(): ProviderReadyRequest | undefined {
    return this.replay ? this.kept : undefined;
  }

  keep(request: ProviderReadyRequest): void {
    this.kept = request;
  }

  /** The next attempt resends the kept request unchanged. */
  resendIdentically(): void {
    this.replay = true;
  }

  /** The next attempt builds its request afresh. */
  discard(): void {
    this.kept = undefined;
    this.replay = false;
  }
}
