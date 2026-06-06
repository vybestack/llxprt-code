/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural contracts for media block classification.
 *
 * Core compression utils receive already-classified MediaBlock objects through
 * these contracts, not by importing classifyMediaBlock from providers.
 * Provider package owns the classifyMediaBlock implementation.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-09, lines 80-85
 */

/**
 * Core-owned media category classification.
 *
 * Mirrors the classification that providers produce via classifyMediaBlock.
 * Core receives already-classified values; it does not perform classification.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export type MediaBlockType = 'image' | 'pdf' | 'audio' | 'video' | 'unknown';

/**
 * Core-owned structural media block contract.
 *
 * Extends the basic MediaBlock from IContent with classification data.
 * Provider code classifies media blocks and passes classified objects
 * into core through this contract.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export interface ClassifiedMediaBlock {
  mimeType: string;
  data: string;
  encoding?: string;
  filename?: string;
  mediaType: MediaBlockType;
}
