/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compatibility shim: upstream gemini-cli uses a singleton `debugLogger`
 * at `utils/debugLogger`. LLxprt uses the `debug`-based `DebugLogger`
 * class at `debug/DebugLogger`. This module exports a singleton instance
 * so that cherry-picked upstream code that imports `debugLogger` works
 * without modification.
 */

import { DebugLogger } from '../debug/DebugLogger.js';

export const debugLogger = new DebugLogger('llxprt:debug');
