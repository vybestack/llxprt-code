/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Re-export the pure helpers so components can resolve border/spinner styles
// without violating the Rules of Hooks. These are NOT hooks: they read a
// module-level singleton that is configured once at app startup (mirroring the
// existing themeManager / terminalCapabilityManager pattern).
export {
  getBorderStyle,
  getSpinnerType,
  isUnicodeSupported,
  configureUnicodeSupport,
  resetUnicodeSupportForTesting,
  type BorderStyleName,
  type UnicodeMode,
} from '../utils/unicodeSupport.js';
