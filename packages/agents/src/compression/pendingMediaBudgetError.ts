/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

/**
 * The media of the request being sent (images, PDFs, audio) alone exceeds the
 * request media budget. Compressing history cannot help, so the pending
 * content is kept untouched and the cause is reported. It is still a
 * {@link RequestMediaByteOverflowError} for callers that classify byte
 * pressure; its inherited `totalBytes` is the resolver's running subtotal where
 * the budget was first crossed, while `pendingBytes` is the full pending total.
 */
export class PendingMediaBudgetError extends RequestMediaByteOverflowError {
  constructor(
    readonly overflow: RequestMediaByteOverflowError,
    readonly pendingBytes: number,
  ) {
    super(
      overflow.contentId,
      overflow.turnId,
      overflow.totalBytes,
      overflow.budgetBytes,
    );
    this.name = 'PendingMediaBudgetError';
    this.message = `The media attached to this request totals ${pendingBytes} encoded bytes, over the ${overflow.budgetBytes} byte request media budget on its own. Send fewer or smaller attachments; the conversation history was left unchanged.`;
  }
}
