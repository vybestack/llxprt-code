/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'bun:test';

test('self-terminate', () => {
  process.kill(process.pid, 'SIGTERM');
});
