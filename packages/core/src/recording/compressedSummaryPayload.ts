/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Issue #4128: replay recognizes the summary of a `compressed` record by
 * reading every block's `type` and every text block's `text`. A block without
 * a string `type`, or a text block without string `text`, makes the record
 * malformed. Other block kinds keep their recorded shape, as they always have
 * on replay.
 */
const RecordedTextBlockSchema = z
  .object({ type: z.literal('text'), text: z.string() })
  .passthrough();

const RecordedOtherBlockSchema = z
  .object({ type: z.string().refine((type) => type !== 'text') })
  .passthrough();

export const RecordedSummaryBlocksSchema = z.array(
  z.union([RecordedTextBlockSchema, RecordedOtherBlockSchema]),
);
