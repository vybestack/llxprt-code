/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @plan:PLAN-20260626-RUNTIMEBOUNDARY.P02-P05 */

export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createControlError(message: string, cause: unknown): Error {
  const error = new Error(`${message}: ${formatError(cause)}`);
  error.name = 'ControlError';
  Object.defineProperty(error, 'cause', {
    value: cause,
    configurable: true,
    writable: true,
  });
  return error;
}
