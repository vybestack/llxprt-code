/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

/**
 * The images of the request being sent alone exceed the request media budget,
 * after every earlier image was already omitted. Compressing history cannot
 * help, so the pending content is kept untouched and the cause is reported.
 * It is still a {@link RequestMediaByteOverflowError} for callers that
 * classify byte pressure.
 */
export class PendingMediaBudgetError extends RequestMediaByteOverflowError {
  constructor(readonly overflow: RequestMediaByteOverflowError) {
    super(
      overflow.contentId,
      overflow.turnId,
      overflow.totalBytes,
      overflow.budgetBytes,
    );
    this.name = 'PendingMediaBudgetError';
    this.message = `The images in this request total ${overflow.totalBytes} encoded bytes, over the ${overflow.budgetBytes} byte image budget even with every earlier image omitted. Send fewer images at once or resize or crop them; the conversation history was left unchanged.`;
  }
}
