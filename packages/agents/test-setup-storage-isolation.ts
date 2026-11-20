/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'node:url';
import { installSourceEmittedSiblingResolution } from '../../scripts/source-emitted-sibling-resolution.js';
import { isolateStorageRoots } from '../storage/src/testing.js';

installSourceEmittedSiblingResolution(
  fileURLToPath(new URL('../..', import.meta.url)),
  true,
);
isolateStorageRoots();

// The OS keyring disable and legacy-home override are owned by
// isolateStorageRoots(); see its doc comment for the rationale (real-keychain
// exposure and the libdbus/FD_SETSIZE crash on Linux).
