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

/**
 * Disable the extra X11 mouse modes (?1003 any-event tracking + ?1000
 * normal mouse tracking). enableMouseEvents enables ?1002/?1006; this tears
 * down the additional modes that some integrations enable, ensuring a full
 * mouse disable on exit. Shared by the protocol-cleanup and mouse-events exit
 * handlers so both emit an identical, idempotent disable superset.
 */
export const DISABLE_EXTRA_MOUSE_MODES_SEQUENCE = '\x1b[?1003l\x1b[?1000l';

/** Show cursor */
export const SHOW_CURSOR = '\x1b[?25h';

/** Hide cursor */
export const HIDE_CURSOR = '\x1b[?25l';
