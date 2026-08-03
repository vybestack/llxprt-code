/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { beforeEach, vi } from 'vitest';

beforeEach(async () => {
  await yieldToEventLoop();
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    appendFileSync: vi.fn(),
  };
});
