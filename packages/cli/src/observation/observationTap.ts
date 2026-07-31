/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import type {
  JspActivityState,
  JspToolPhase,
  JspTurnOutcome,
  JspWaitReason,
} from './jspDocuments.js';

export interface ObservationTapTarget {
  onTurnStarted(): void;
  onTurnEnded(outcome: JspTurnOutcome): void;
  onActivityChanged(state: JspActivityState): void;
  onWaitOpened(reason: JspWaitReason): void;
  onWaitResolved(): void;
  onToolCreated(label: string, phase: JspToolPhase): void;
  onToolPhaseChanged(label: string, phase: JspToolPhase): void;
  onAssistantChunk(content: string): void;
  onAssistantMessageCommitted(content: string, committedMs: number): void;
  onSourceError(summary: string, code: string): void;
}

export interface ObservationTap {
  onTurnStarted(): void;
  processEvent(event: AgentEvent): void;
  onFlushCommitted(content: string, committedMs: number): void;
}

function mapDoneReason(reason: string): JspTurnOutcome {
  if (reason === 'aborted') {
    return 'cancelled';
  }
  if (reason === 'error' || reason === 'context-overflow') {
    return 'failed';
  }
  return 'completed';
}

function mapToolStatus(
  status: Extract<AgentEvent, { type: 'tool-status' }>['update']['status'],
): JspToolPhase {
  switch (status) {
    case 'awaiting-approval':
      return 'awaiting_approval';
    case 'scheduled':
      return 'scheduled';
    case 'executing':
      return 'executing';
    case 'success':
      return 'succeeded';
    case 'error':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'validating':
      return 'proposed';
    default:
      return 'proposed';
  }
}

export function createObservationTap(
  target: ObservationTapTarget | null,
): ObservationTap {
  if (target === null) {
    return {
      onTurnStarted: () => undefined,
      processEvent: () => undefined,
      onFlushCommitted: () => undefined,
    };
  }
  const toolLabels = new Map<string, string>();
  const awaitingConfirmation = new Set<string>();

  return {
    onTurnStarted(): void {
      target.onTurnStarted();
    },
    processEvent(event: AgentEvent): void {
      switch (event.type) {
        case 'text':
          target.onAssistantChunk(event.text);
          target.onActivityChanged('thinking');
          break;
        case 'thinking':
          target.onActivityChanged('thinking');
          break;
        case 'tool-call':
          toolLabels.set(event.call.id, event.call.name);
          target.onActivityChanged('acting');
          target.onToolCreated(event.call.name, 'proposed');
          break;
        case 'tool-confirmation':
          awaitingConfirmation.add(event.confirmation.toolCallId);
          target.onToolPhaseChanged(
            event.confirmation.name,
            'awaiting_approval',
          );
          target.onWaitOpened('permission');
          break;
        case 'tool-status': {
          const label = toolLabels.get(event.update.id) ?? event.update.name;
          const phase = mapToolStatus(event.update.status);
          target.onToolPhaseChanged(label, phase);
          if (
            phase !== 'awaiting_approval' &&
            awaitingConfirmation.delete(event.update.id)
          ) {
            target.onWaitResolved();
          }
          break;
        }
        case 'tool-result': {
          const label = toolLabels.get(event.result.id) ?? event.result.name;
          target.onToolPhaseChanged(
            label,
            event.result.isError === true ? 'failed' : 'succeeded',
          );
          toolLabels.delete(event.result.id);
          if (awaitingConfirmation.delete(event.result.id)) {
            target.onWaitResolved();
          }
          break;
        }
        case 'error':
          target.onSourceError(event.error.message, 'AGENT_ERROR');
          break;
        case 'done':
          target.onTurnEnded(mapDoneReason(event.reason));
          break;
        default:
          break;
      }
    },
    onFlushCommitted(content: string, committedMs: number): void {
      if (content.length > 0) {
        target.onAssistantMessageCommitted(content, committedMs);
      }
    },
  };
}
