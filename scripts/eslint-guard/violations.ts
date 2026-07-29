/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Violation } from './types.ts';

export function formatViolations(violations: Violation[]) {
  return violations
    .map((violation) => {
      const location = violation.file + ':' + violation.lineNumber;
      return (
        location + ' ' + violation.message + '\n  ' + violation.content.trim()
      );
    })
    .join('\n');
}
