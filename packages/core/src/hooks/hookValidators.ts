/**
 * Hook Event Payload Validators
 *
 * Type-predicate validators for each hook event family.
 * Validation runs at mediated ingress (MessageBus path) before planning.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P09
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */

import type {
  BeforeToolInput,
  AfterToolInput,
  BeforeAgentInput,
  AfterAgentInput,
  BeforeModelInput,
  AfterModelInput,
  BeforeToolSelectionInput,
  NotificationInput,
} from './types.js';

/**
 * Type guard: checks if value is a non-null, non-array object.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-005
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Type guard: checks if value is a non-empty string.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-005
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validates BeforeTool event input.
 * Required fields: tool_name (non-empty string), tool_input (object)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateBeforeToolInput(
  input: unknown,
): input is BeforeToolInput {
  if (!isObject(input)) return false;
  if (!isNonEmptyString(input['tool_name'])) return false;
  if (!isObject(input['tool_input'])) return false;
  return true;
}

/**
 * Validates AfterTool event input.
 * Required fields: tool_name (non-empty string), tool_input (object), tool_response (object)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateAfterToolInput(
  input: unknown,
): input is AfterToolInput {
  if (!isObject(input)) return false;
  if (!isNonEmptyString(input['tool_name'])) return false;
  if (!isObject(input['tool_input'])) return false;
  if (!isObject(input['tool_response'])) return false;
  return true;
}

/**
 * Validates BeforeAgent event input.
 * Required fields: prompt (string)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateBeforeAgentInput(
  input: unknown,
): input is BeforeAgentInput {
  if (!isObject(input)) return false;
  if (typeof input['prompt'] !== 'string') return false;
  return true;
}

/**
 * Validates AfterAgent event input.
 * Required fields: prompt (string), prompt_response (string), stop_hook_active (boolean)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateAfterAgentInput(
  input: unknown,
): input is AfterAgentInput {
  if (!isObject(input)) return false;
  if (typeof input['prompt'] !== 'string') return false;
  if (typeof input['prompt_response'] !== 'string') return false;
  if (typeof input['stop_hook_active'] !== 'boolean') return false;
  return true;
}

/**
 * Validates BeforeModel event input.
 * Required fields: llm_request (object)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateBeforeModelInput(
  input: unknown,
): input is BeforeModelInput {
  if (!isObject(input)) return false;
  if (!isObject(input['llm_request'])) return false;
  return true;
}

/**
 * Validates AfterModel event input.
 * Required fields: llm_request (object), llm_response (object)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateAfterModelInput(
  input: unknown,
): input is AfterModelInput {
  if (!isObject(input)) return false;
  if (!isObject(input['llm_request'])) return false;
  if (!isObject(input['llm_response'])) return false;
  return true;
}

/**
 * Validates BeforeToolSelection event input.
 * Required fields: llm_request (object)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateBeforeToolSelectionInput(
  input: unknown,
): input is BeforeToolSelectionInput {
  if (!isObject(input)) return false;
  if (!isObject(input['llm_request'])) return false;
  return true;
}

/**
 * Validates Notification event input.
 * Required fields: notification_type (enum), message (non-empty string), details (object)
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P11
 * @requirement DELTA-HPAY-001, DELTA-HPAY-005
 */
export function validateNotificationInput(
  input: unknown,
): input is NotificationInput {
  if (!isObject(input)) return false;
  if (!('notification_type' in input)) return false;
  if (!isNonEmptyString(input['message'])) return false;
  if (!isObject(input['details'])) return false;
  return true;
}
