/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Tests use Bun's full ambient globals (`Bun.*`, `fetch.preconnect`). They are
// loaded from this test-only file so production sources, and the runtime
// boundary analyzer's production program, keep the narrow bun-types split.
import type {} from 'bun';
