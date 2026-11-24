/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SendRequestState } from './sendRequestState.js';

/**
 * What one logical request keeps across the stream attempts a turn makes for
 * it (issue #4093). A watchdog timeout abandons an attempt and the turn sends
 * the request again as a new attempt; the request itself is the same one, so
 * its provider-ready form and its turn identity belong here rather than to
 * any one attempt. Everything per attempt is still made fresh: the
 * cancellation signal, the observers, the attempt index and the provider's
 * retry context, which tracks what that attempt's stream already exposed and
 * would wrongly bar the replacement from retrying if it were shared.
 */
export class LogicalSend {
  /** The request as it was sent, kept to be sent again unchanged. */
  readonly state = new SendRequestState();
  /** Turn identity the first attempt minted; later attempts reuse it. */
  turnId: string | undefined;
}
