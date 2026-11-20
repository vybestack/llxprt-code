/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scrollback pager wiring defaults (issue-854-design.md §8). The schema
 * defaults for ui.scrollbackMarginViewports / ui.scrollbackByteFloorKiB must
 * match the two DEFAULT_ values here; these constants are the fallbacks used
 * when a settings file carries a non-numeric value.
 */
export const DEFAULT_SCROLLBACK_MARGIN_VIEWPORTS = 2;
export const DEFAULT_SCROLLBACK_BYTE_FLOOR_KIB = 256;

/** Reset debounce for the pager's off-screen residency purge (§3). */
export const SCROLLBACK_PURGE_DEBOUNCE_MS = 1500;

/** Display rows collected per pageBack/pageForward cursor page. */
export const SCROLLBACK_PAGE_ROWS = 50;

/**
 * The pager store exposes no subscription API; the viewport component polls
 * getState() on this cadence to render newly paged rows.
 */
export const SCROLLBACK_VIEWPORT_POLL_MS = 100;
