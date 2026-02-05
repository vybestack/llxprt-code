/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import baseConfig from './vitest.config.js';

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['src/gemini.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
};
