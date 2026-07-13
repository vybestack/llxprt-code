/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ConfigFileError {
  readonly path: string;
  readonly message: string;
}

export function formatConfigFileErrors(
  errors: readonly ConfigFileError[],
  fileDescription = 'configuration file(s)',
): string {
  const details = errors.map(
    (error) => `Error in ${error.path}: ${error.message}`,
  );
  return `${details.join('\n')}\nPlease fix the ${fileDescription} and try again.`;
}
