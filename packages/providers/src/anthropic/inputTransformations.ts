/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface InputTransformationLogger {
  debug: (message: () => string) => void;
}

export function logInputTransformations(
  response: unknown,
  logger: InputTransformationLogger,
): void {
  if (!isRecord(response)) return;
  const transformations = response['input_transformations'];
  if (!Array.isArray(transformations)) return;
  for (const entry of transformations) {
    if (!isRecord(entry)) continue;
    const type = entry['type'];
    const path = entry['path'];
    const reason = entry['reason'];
    logger.debug(
      () =>
        `Anthropic input transformation: type=${String(type)}, path=${String(path)}, reason=${String(reason)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
