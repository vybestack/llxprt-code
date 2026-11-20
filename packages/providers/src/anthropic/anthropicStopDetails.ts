/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { parseAnthropicStopDetails } from './finishReasonMapping.js';

export function readAnthropicMessageDeltaStopDetails(
  chunk: Anthropic.MessageStreamEvent & { type: 'message_delta' },
) {
  const parsed = z
    .object({
      delta: z.object({ stop_details: z.unknown().optional() }).passthrough(),
    })
    .passthrough()
    .safeParse(chunk);
  return parsed.success
    ? parseAnthropicStopDetails(parsed.data.delta.stop_details)
    : undefined;
}
