/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Marks Bun test processes and their children so browser launches fail closed. */
process.env.LLXPRT_RUNNING_TESTS = 'true';
