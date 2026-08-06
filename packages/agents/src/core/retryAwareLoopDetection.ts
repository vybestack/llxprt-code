/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import { AgentEventType, type ServerAgentStreamEvent } from './turn.js';

export interface LoopCheckedEvent {
  readonly event: ServerAgentStreamEvent;
  readonly loopDetected: boolean;
}

/**
 * Defers a loop verdict until the next stream event establishes whether the
 * triggering output belongs to an abandoned attempt. A Retry discards the
 * pending verdict; any other event confirms it.
 */
export async function* applyRetryAwareLoopDetection(
  events: AsyncIterable<ServerAgentStreamEvent>,
  loopDetector: LoopDetectionService,
): AsyncGenerator<LoopCheckedEvent> {
  let pendingLoopEvent: ServerAgentStreamEvent | undefined;

  for await (const event of events) {
    if (pendingLoopEvent !== undefined) {
      if (event.type === AgentEventType.Retry) {
        pendingLoopEvent = undefined;
        yield { event, loopDetected: false };
        continue;
      }
      yield { event: pendingLoopEvent, loopDetected: true };
      return;
    }

    if (event.type === AgentEventType.Retry) {
      yield { event, loopDetected: false };
    } else if (loopDetector.addAndCheck(event)) {
      pendingLoopEvent = event;
    } else {
      yield { event, loopDetected: false };
    }
  }

  if (pendingLoopEvent !== undefined) {
    yield { event: pendingLoopEvent, loopDetected: true };
  }
}
