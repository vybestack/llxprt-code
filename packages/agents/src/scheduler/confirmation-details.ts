/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-tools';
import type { SerializableConfirmationDetails } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
export function isInteractiveConfirmationDetails(
  details: ToolCallConfirmationDetails | SerializableConfirmationDetails,
): details is ToolCallConfirmationDetails {
  return 'onConfirm' in details;
}

export function getConfirmationCorrelationId(
  details:
    | ToolCallConfirmationDetails
    | SerializableConfirmationDetails
    | undefined,
): string | undefined {
  if (!details || !('correlationId' in details)) {
    return undefined;
  }

  const correlationId = details.correlationId;
  return typeof correlationId === 'string' ? correlationId : undefined;
}

export function isConfirmationDetails(
  value:
    | ToolCallConfirmationDetails
    | SerializableConfirmationDetails
    | false
    | null
    | undefined,
): value is ToolCallConfirmationDetails {
  return (
    value !== false && value != null && isInteractiveConfirmationDetails(value)
  );
}
