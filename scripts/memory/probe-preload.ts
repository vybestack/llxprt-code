/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preload entry for the memory probe:
 *
 *   bun --preload scripts/memory/probe-preload.ts <entry> [args...]
 *
 * This file — not probe.ts — owns the install side effect, so importing
 * probe.ts (from the launcher for shared constants, or from tests) never
 * installs a probe, even when LLXPRT_MEM_DIR is ambiently set in the
 * importing process.
 */

import { installProbe } from './probe.ts';

installProbe();
