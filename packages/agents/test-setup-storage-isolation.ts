/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isolateStorageRoots } from '../storage/src/testing.js';

isolateStorageRoots();

// The OS keyring disable and legacy-home override are owned by
// isolateStorageRoots(); see its doc comment for the rationale (real-keychain
// exposure and the libdbus/FD_SETSIZE crash on Linux).
