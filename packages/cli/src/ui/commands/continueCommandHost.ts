/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ContinueCommandOperations } from './continueCommand.js';

export function bindContinueCommandOperations(
  exportSession: ContinueCommandOperations['exportSession'],
  isInteractive: ContinueCommandOperations['isInteractive'],
  listContinueTargets: ContinueCommandOperations['listContinueTargets'],
  validateSessionPackage: ContinueCommandOperations['validateSessionPackage'],
): ContinueCommandOperations {
  return {
    exportSession,
    isInteractive,
    listContinueTargets,
    validateSessionPackage,
  };
}
