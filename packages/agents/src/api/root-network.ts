/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

export function acquireRootNetwork(
  release: AcquisitionRelease,
  proxy: string | undefined,
): OwnedFetch {
  const network = new OwnedFetch(proxy);
  release.beforeRelease(() => network.closeAdmissionAndAbort());
  release.acquire('network', () => network.dispose());
  return network;
}
