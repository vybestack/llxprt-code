/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function isErrnoException(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  if (!(error instanceof Error) || !Object.hasOwn(error, 'code')) {
    return false;
  }
  const errorCode = (error as NodeJS.ErrnoException).code;
  return errorCode === code;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function propertyValue(error: unknown, property: PropertyKey): unknown {
  if (
    error === null ||
    typeof error !== 'object' ||
    !Object.hasOwn(error, property)
  ) {
    return undefined;
  }
  return (error as Record<PropertyKey, unknown>)[property];
}
