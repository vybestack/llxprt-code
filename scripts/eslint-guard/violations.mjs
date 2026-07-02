/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function formatViolations(violations) {
  return violations
    .map((violation) => {
      const location = violation.file + ':' + violation.lineNumber;
      return (
        location + ' ' + violation.message + '\n  ' + violation.content.trim()
      );
    })
    .join('\n');
}
