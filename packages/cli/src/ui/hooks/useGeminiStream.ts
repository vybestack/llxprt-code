/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Backward-compatibility shim — all logic lives in geminiStream/
export { useGeminiStream } from './geminiStream/index.js';
export {
  mergePartListUnions,
  mergePendingToolGroupsForDisplay,
} from './geminiStream/index.js';
