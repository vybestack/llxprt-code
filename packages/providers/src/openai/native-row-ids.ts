/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamingToolIdMapper } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';

/**
 * Looks up the tool ids one unit needs from the stored facts, once, and hands
 * out a fresh mapper over them each time the unit is converted. A unit is
 * converted once per thinking variant while it is measured, so the lookups
 * must not be spent by the first conversion.
 */
export type NativeRowIds = (
  row: IContent,
  index: number,
) => Promise<() => StreamingToolIdMapper>;
