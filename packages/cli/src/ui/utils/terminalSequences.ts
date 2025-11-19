/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Terminal control sequences for managing terminal modes and cursor state.
 * These sequences are used to enable/disable various terminal features and
 * need to be re-sent after terminal resume (e.g., tmux reattach).
 */

/** Enable bracketed paste mode - terminal wraps pasted text with special sequences */
export const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';

/** Disable bracketed paste mode */
export const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

/** Enable focus tracking - terminal sends sequences when window gains/loses focus */
export const ENABLE_FOCUS_TRACKING = '\x1b[?1004h';

/** Disable focus tracking */
export const DISABLE_FOCUS_TRACKING = '\x1b[?1004l';

/** Show cursor */
export const SHOW_CURSOR = '\x1b[?25h';

/** Hide cursor */
export const HIDE_CURSOR = '\x1b[?25l';
