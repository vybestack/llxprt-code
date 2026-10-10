/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { plugin } from 'bun';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { installSourceEmittedSiblingResolution } from '../../scripts/source-emitted-sibling-resolution.js';
import { isolateStorageRoots } from '../storage/src/testing.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
installSourceEmittedSiblingResolution(root);
plugin({
  name: 'zed-source-config-resolution',
  setup(build) {
    build.onResolve(
      { filter: /^@vybestack\/llxprt-code-core\/config\/config\.js$/ },
      () => ({ path: resolve(root, 'packages/core/src/config/config.ts') }),
    );
  },
});

isolateStorageRoots();
