/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HookEventName } from './types.js';
import {
  validateBeforeToolInput,
  validateAfterToolInput,
  validateBeforeAgentInput,
  validateAfterAgentInput,
  validateBeforeModelInput,
  validateAfterModelInput,
  validateBeforeToolSelectionInput,
  validateNotificationInput,
} from './hookValidators.js';

function extractPayload(rawMessage: unknown): Record<string, unknown> | null {
  if (
    rawMessage !== null &&
    typeof rawMessage === 'object' &&
    'payload' in rawMessage
  ) {
    const payload = (rawMessage as { payload: unknown }).payload;
    if (payload !== null && typeof payload === 'object') {
      return payload as Record<string, unknown>;
    }
  }
  return null;
}

function extractCorrelationIdFromPayload(
  payload: Record<string, unknown>,
): string | null {
  if (
    'correlationId' in payload &&
    typeof payload.correlationId === 'string' &&
    payload.correlationId.length > 0
  ) {
    return payload.correlationId;
  }
  return null;
}

export function extractCorrelationIdFromMessage(
  rawMessage: unknown,
): string | null {
  const payload = extractPayload(rawMessage);
  return payload === null ? null : extractCorrelationIdFromPayload(payload);
}

/**
 * Route validation to the appropriate type-predicate validator.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-002
 */
export function validateEventPayload(
  eventName: HookEventName,
  input: unknown,
): boolean {
  switch (eventName) {
    case HookEventName.BeforeTool:
      return validateBeforeToolInput(input);
    case HookEventName.AfterTool:
      return validateAfterToolInput(input);
    case HookEventName.BeforeAgent:
      return validateBeforeAgentInput(input);
    case HookEventName.AfterAgent:
      return validateAfterAgentInput(input);
    case HookEventName.BeforeModel:
      return validateBeforeModelInput(input);
    case HookEventName.AfterModel:
      return validateAfterModelInput(input);
    case HookEventName.BeforeToolSelection:
      return validateBeforeToolSelectionInput(input);
    case HookEventName.Notification:
      return validateNotificationInput(input);
    default:
      return false;
  }
}
