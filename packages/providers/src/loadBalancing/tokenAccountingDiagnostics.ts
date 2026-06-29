/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TokenAccountingDiagnostics {
  profileName: string;
  selectedSubProfile: string | null;
  activeProvider: string | null;
  activeModel: string | null;
  accountingSource: string;
  sharedContextLimit: number | null;
  lastEstimatedTokens: number | null;
}
