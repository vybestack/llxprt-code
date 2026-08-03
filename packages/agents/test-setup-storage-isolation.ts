/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isolateStorageRoots } from '../storage/src/testing.js';

isolateStorageRoots();

// Storage roots are redirected above, but the OS credential store lives outside
// them. Without this, suites that build a real Agent reach the developer's
// actual keychain — several agents tests exercise tool-key storage, which is a
// genuine SecureStore read. Disable the native keyring so those reads use the
// encrypted-file fallback inside the isolated root instead.
//
// This also avoids a memory-corrupting crash in the credential stack on Linux:
// @napi-rs/keyring vendors libdbus, whose vendored build omits HAVE_POLL and so
// falls back to select(); FD_SET is undefined for descriptors >= FD_SETSIZE
// (1024) and writes out of bounds. See
// project-plans/20260803issue2845/keyring-root-cause.md and the upstream fix in
// diwic/dbus-rs#523.
process.env.LLXPRT_TEST_DISABLE_OS_KEYRING = '1';
