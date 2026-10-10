/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WorkspaceTrustInputs {
  readonly localTrust?: boolean;
  readonly ideTrust?: boolean;
}

export interface WorkspaceTrustWritePort {
  setTrustedFolderLive(trusted: boolean): Promise<void>;
  setIdeTrustLive(trusted: boolean | undefined): Promise<void>;
}
