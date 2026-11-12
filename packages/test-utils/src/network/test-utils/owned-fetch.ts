/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

export function createTestOwnedFetch(proxy?: string): OwnedFetch {
  return new OwnedFetch(proxy);
}
