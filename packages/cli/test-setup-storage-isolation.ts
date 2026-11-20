/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'node:url';
import { installSourceEmittedSiblingResolution } from '../../scripts/source-emitted-sibling-resolution.js';
import { isolateStorageRoots } from '../storage/src/testing.js';
import { traceNativePreloadPhase } from './test-utils/native-preload-phase.js';

traceNativePreloadPhase('storage.body-after-static-imports');
traceNativePreloadPhase('storage.sibling-scan.entry');
installSourceEmittedSiblingResolution(
  fileURLToPath(new URL('../..', import.meta.url)),
  true,
);
traceNativePreloadPhase('storage.sibling-scan.exit');
traceNativePreloadPhase('storage.isolation.entry');
isolateStorageRoots();
traceNativePreloadPhase('storage.isolation.exit');
traceNativePreloadPhase('storage.complete');
