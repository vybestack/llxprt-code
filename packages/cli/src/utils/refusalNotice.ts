/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue:2329 — CLI-side access to the shared safety-classifier refusal
 * notice. Re-exported from core so there is a single source of truth for the
 * notice text across the CLI, the headless CLI, and the a2a-server.
 */
export { REFUSAL_NOTICE_MESSAGE } from '@vybestack/llxprt-code-core';
