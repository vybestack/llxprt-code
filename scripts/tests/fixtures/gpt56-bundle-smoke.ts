/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { get_encoding } from '@dqbd/tiktoken';

const encoder = get_encoding('o200k_base');
try {
  process.stdout.write(
    `${encoder.encode('The quick brown fox jumps over the lazy dog.', [], []).length}\n`,
  );
} finally {
  encoder.free();
}
