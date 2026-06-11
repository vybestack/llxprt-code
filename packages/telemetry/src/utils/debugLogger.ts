/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Convenience singleton: re-exports DebugLogger class and a pre-built
 * default instance for quick access to debug logging.
 */

import { DebugLogger } from '../debug/DebugLogger.js';

export { DebugLogger };
export const debugLogger = new DebugLogger('llxprt:debug');
