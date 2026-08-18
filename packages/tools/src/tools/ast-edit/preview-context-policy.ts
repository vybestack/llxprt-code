/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Internal bounding policies for ast_edit preview output (issue #3242).
 *
 * Preview describes a localized exact replacement, so its model-facing
 * context is selected by proximity to the edit's start line and assembled
 * under a hard UTF-8 byte budget. These are internal safety policies, not
 * public tool parameters.
 */

import { Buffer } from 'node:buffer';
import { ASTConfig } from './ast-config.js';
import type { AstValidationSummary } from './validation-categorizer.js';
import type { EnhancedDeclaration } from './types.js';

interface RankedDeclaration {
  readonly declaration: EnhancedDeclaration;
  readonly sourceIndex: number;
}

function sourceOrder(
  entry: RankedDeclaration,
  other: RankedDeclaration,
): number {
  const byLine = entry.declaration.line - other.declaration.line;
  if (byLine !== 0) {
    return byLine;
  }
  const byColumn = entry.declaration.column - other.declaration.column;
  if (byColumn !== 0) {
    return byColumn;
  }
  return entry.sourceIndex - other.sourceIndex;
}

function proximityOrder(
  entry: RankedDeclaration,
  other: RankedDeclaration,
  anchorLine: number,
): number {
  const byDistance =
    Math.abs(entry.declaration.line - anchorLine) -
    Math.abs(other.declaration.line - anchorLine);
  if (byDistance !== 0) {
    return byDistance;
  }
  const byLine = entry.declaration.line - other.declaration.line;
  if (byLine !== 0) {
    return byLine;
  }
  return entry.sourceIndex - other.sourceIndex;
}

function renderDeclarationLine(declaration: EnhancedDeclaration): string {
  return `- ${declaration.type}: ${declaration.name} (line ${declaration.line})`;
}

function boundedMarkerLine(shown: number, total: number): string {
  return `- Declarations: bounded preview — showing ${shown} of ${total} (selected nearest to the edit)`;
}

function utf8Bytes(lines: readonly string[]): number {
  return Buffer.byteLength(lines.join('\n'), 'utf8');
}

const VALIDATION_LINE_PREFIX = '- AST errors: ';

/**
 * Mandatory pre-existing-error status for previews whose only syntax
 * errors predate the edit. Fixed-width by policy: per-error locations
 * already live in the separately budgeted validation detail, so even tens
 * of thousands of pre-existing diagnostics cannot expand non-budgetable
 * mandatory content past the hard byte budget.
 */
export function preExistingSyntaxErrorStatus(
  hasOnlyPreExistingSyntaxErrors: boolean,
): string {
  return hasOnlyPreExistingSyntaxErrors
    ? '- Pre-existing syntax errors: Yes'
    : '';
}

/**
 * Fixed-width suffix shared by every oversized-label fallback: it states
 * truthfully that validation locations were dropped for the preview byte
 * budget. A compile-time constant, so every fallback label is bounded
 * independent of how many parser diagnostics produced the summary.
 */
const OMITTED_VALIDATION_LOCATIONS =
  '; validation locations omitted for preview byte budget)';

/**
 * Preview-only bounding policy for the mandatory AST validation summary
 * line.
 *
 * Ordinary (small) labels pass through byte-identical, so preview wording
 * and semantics are unchanged. The shared categorizer embeds every
 * diagnostic line number into its labels, so a diagnostic-dense file can
 * produce a label that alone exceeds the entire PREVIEW_LLM_MAX_BYTES
 * budget; such a label is mandatory, non-droppable content, so the preview
 * could never fit. A label above PREVIEW_VALIDATION_SUMMARY_MAX_BYTES is
 * therefore replaced by a fixed-width truthful classification that
 * preserves whether the failure is pre-existing, newly introduced, or
 * mixed (and keeps resolved-pre-existing PASSED as a resolution). No
 * string is ever sliced, so the result is valid UTF-8 by construction.
 *
 * Throws (fail fast) for a categorizer summary the policy cannot
 * classify truthfully: every SKIPPED label is a fixed short string, and
 * every FAILED summary carries at least one classification flag, so an
 * unclassifiable oversized label means the categorizer contract broke and
 * must surface rather than be silently mislabeled.
 */
export function boundedValidationSummaryLabel(
  summary: AstValidationSummary,
): string {
  if (
    Buffer.byteLength(summary.label, 'utf8') <=
    ASTConfig.PREVIEW_VALIDATION_SUMMARY_MAX_BYTES
  ) {
    return summary.label;
  }
  const { status, preExisting, newlyIntroduced } = summary;
  if (status === 'PASSED') {
    // The categorizer's only PASSED label that grows with diagnostics is
    // the resolved-pre-existing one; a plain PASSED label is 6 bytes.
    return `PASSED (edit resolved pre-existing error${OMITTED_VALIDATION_LOCATIONS}`;
  }
  if (status === 'FAILED') {
    if (preExisting && newlyIntroduced) {
      return `FAILED (file had pre-existing errors; post-edit errors may be newly introduced${OMITTED_VALIDATION_LOCATIONS}`;
    }
    if (preExisting) {
      return `FAILED (pre-existing error — present before this edit${OMITTED_VALIDATION_LOCATIONS}`;
    }
    if (newlyIntroduced) {
      return `FAILED (new error introduced by this edit${OMITTED_VALIDATION_LOCATIONS}`;
    }
  }
  throw new Error(
    `ast_edit preview cannot bound a validation summary label it cannot classify (status ${status}, preExisting ${String(preExisting)}, newlyIntroduced ${String(newlyIntroduced)})`,
  );
}

function renderValidationLine(
  detail: readonly string[],
  shown: number,
): string {
  const total = detail.length;
  if (shown === 0) {
    return `${VALIDATION_LINE_PREFIX}${total} errors omitted (preview byte budget)`;
  }
  const shownText = detail.slice(0, shown).join(', ');
  if (shown === total) {
    return `${VALIDATION_LINE_PREFIX}${shownText}`;
  }
  return `${VALIDATION_LINE_PREFIX}${shownText} (+${total - shown} more errors omitted; ${total} total)`;
}

/**
 * Budget the variable validation detail line: keep whole items (earliest
 * first) while the frame fits the hard budget, then state truthfully how
 * many were omitted. Greedy item accumulation gives the estimate; the exact
 * frame check is authoritative because the omission marker's digit width
 * can shrink as items are added. Throws when even the minimal truthful
 * omission line cannot fit.
 */
function budgetValidationDetailLine(
  validationDetail: readonly string[],
  frameWith: (detailLine: string) => number,
): string {
  const itemBytes = validationDetail.map((item) =>
    Buffer.byteLength(item, 'utf8'),
  );
  const available =
    ASTConfig.PREVIEW_LLM_MAX_BYTES -
    frameWith(renderValidationLine(validationDetail, 0));
  let shown = 0;
  let used = 0;
  while (
    shown < itemBytes.length &&
    used + itemBytes[shown] + (shown > 0 ? 2 : 0) <= available
  ) {
    used += itemBytes[shown] + (shown > 0 ? 2 : 0);
    shown++;
  }
  while (
    shown > 0 &&
    frameWith(renderValidationLine(validationDetail, shown)) >
      ASTConfig.PREVIEW_LLM_MAX_BYTES
  ) {
    shown--;
  }
  if (
    frameWith(renderValidationLine(validationDetail, shown)) >
    ASTConfig.PREVIEW_LLM_MAX_BYTES
  ) {
    throw new Error(
      `ast_edit preview cannot fit mandatory content plus validation omission metadata within the ${ASTConfig.PREVIEW_LLM_MAX_BYTES}-byte budget`,
    );
  }
  return renderValidationLine(validationDetail, shown);
}

export interface BoundedPreviewResult {
  readonly lines: readonly string[];
  readonly renderedDeclarations: number;
  readonly totalDeclarations: number;
  readonly bounded: boolean;
}

/** Ordered sections assembled by {@link assembleBoundedPreview}. */
export interface BoundedPreviewInput {
  /** Mandatory lines rendered before the validation detail. */
  readonly mandatoryHead: readonly string[];
  /**
   * Variable validation diagnostic detail (one item per diagnostic). The
   * rendered line keeps whole items while the byte budget allows and then
   * states truthfully how many were omitted — it never silently claims the
   * full diagnostic list. Empty for a valid candidate.
   */
  readonly validationDetail: readonly string[];
  /** Mandatory lines rendered after the validation detail. */
  readonly mandatoryTail: readonly string[];
  readonly declarations: readonly EnhancedDeclaration[];
  /** 1-based line where the exact replacement starts. */
  readonly anchorLine: number;
  /** Mandatory trailing lines (next-step footer). */
  readonly mandatorySuffix: readonly string[];
}

/**
 * Assemble the declaration section under the hard byte budget. The
 * complete UNMARKED frame is measured first: an omission marker is
 * accounted for only once a declaration is actually omitted (by the
 * PREVIEW_MAX_DECLARATIONS policy or by the byte budget), so a complete
 * frame that fits never loses a declaration to a marker that would not be
 * rendered. Once omission is required, the marker is required content and
 * rendered lines drop farthest-from-edit first (ties drop the later line
 * first) until the frame fits.
 */
function assembleDeclarationFrame(
  mandatory: readonly string[],
  selected: readonly RankedDeclaration[],
  droppable: readonly RankedDeclaration[],
  totalDeclarations: number,
  mandatorySuffix: readonly string[],
): { lines: readonly string[]; rendered: readonly string[] } {
  let rendered = selected.map((entry) =>
    renderDeclarationLine(entry.declaration),
  );
  if (
    selected.length === totalDeclarations &&
    utf8Bytes([...mandatory, ...rendered, ...mandatorySuffix]) <=
      ASTConfig.PREVIEW_LLM_MAX_BYTES
  ) {
    return { lines: [...mandatory, ...rendered, ...mandatorySuffix], rendered };
  }
  const dropped = new Set<number>();
  let marker = boundedMarkerLine(rendered.length, totalDeclarations);
  while (
    utf8Bytes([...mandatory, marker, ...rendered, ...mandatorySuffix]) >
      ASTConfig.PREVIEW_LLM_MAX_BYTES &&
    dropped.size < selected.length
  ) {
    dropped.add(droppable[dropped.size].sourceIndex);
    rendered = selected
      .filter((entry) => !dropped.has(entry.sourceIndex))
      .map((entry) => renderDeclarationLine(entry.declaration));
    marker = boundedMarkerLine(rendered.length, totalDeclarations);
  }
  return {
    lines: [...mandatory, marker, ...rendered, ...mandatorySuffix],
    rendered,
  };
}

/**
 * Assemble the preview output lines under the hard UTF-8 byte budget.
 *
 * Fixed mandatory lines (status/summary head, snippet/timestamp tail,
 * next-step footer) are never dropped or split. Variable validation detail
 * is budgeted first at whole diagnostic items with a truthful omission
 * marker; declarations are then capped at PREVIEW_MAX_DECLARATIONS by
 * absolute line distance from the edit anchor (ties break to the earlier
 * line), rendered back in source order, and — only once an omission is
 * actually required — dropped farthest-first until the assembled bytes
 * fit; the complete unmarked frame is always measured before any marker
 * accounting. No line is ever split, so the result is valid UTF-8 by
 * construction. Whenever any declaration was omitted (policy cap or byte
 * budget), the truthful selected/total bounded marker is emitted.
 *
 * Throws (fail fast) when the truly fixed mandatory content alone — or the
 * fixed content plus the minimal truthful omission metadata — cannot fit
 * the budget: such a preview must surface as an error, never as an
 * over-budget success.
 */
export function assembleBoundedPreview(
  input: BoundedPreviewInput,
): BoundedPreviewResult {
  const {
    mandatoryHead,
    validationDetail,
    mandatoryTail,
    declarations,
    anchorLine,
    mandatorySuffix,
  } = input;

  const fixedMandatory = [
    ...mandatoryHead,
    ...mandatoryTail,
    ...mandatorySuffix,
  ];
  if (utf8Bytes(fixedMandatory) > ASTConfig.PREVIEW_LLM_MAX_BYTES) {
    throw new Error(
      `ast_edit preview fixed mandatory content (${utf8Bytes(fixedMandatory)} bytes) alone exceeds the ${ASTConfig.PREVIEW_LLM_MAX_BYTES}-byte budget`,
    );
  }

  // Worst-case declaration framing: once the byte budget forces every
  // declaration line out, the truthful bounded marker remains.
  const emptyMarker =
    declarations.length > 0 ? [boundedMarkerLine(0, declarations.length)] : [];
  const frameWith = (detailLine: string): number =>
    utf8Bytes([
      ...mandatoryHead,
      detailLine,
      ...mandatoryTail,
      ...emptyMarker,
      ...mandatorySuffix,
    ]);

  const validationLines =
    validationDetail.length > 0
      ? [budgetValidationDetailLine(validationDetail, frameWith)]
      : [];

  const ranked = declarations
    .map((declaration, sourceIndex) => ({ declaration, sourceIndex }))
    .sort(sourceOrder);
  const byProximity = [...ranked].sort((entry, other) =>
    proximityOrder(entry, other, anchorLine),
  );
  const selectedByProximity = byProximity.slice(
    0,
    ASTConfig.PREVIEW_MAX_DECLARATIONS,
  );
  const selected = [...selectedByProximity].sort(sourceOrder);
  // Drop order is the reverse of proximity selection (farthest first).
  const droppable = [...selectedByProximity].reverse();
  const mandatory = [...mandatoryHead, ...validationLines, ...mandatoryTail];

  const { lines, rendered } = assembleDeclarationFrame(
    mandatory,
    selected,
    droppable,
    declarations.length,
    mandatorySuffix,
  );
  const bounded = rendered.length < declarations.length;

  // Authoritative final measurement: the drop loop above can exhaust every
  // selected declaration while the required bounded marker still does not
  // fit, so the assembled frame is re-measured and refused rather than
  // returned as an over-budget success.
  if (utf8Bytes(lines) > ASTConfig.PREVIEW_LLM_MAX_BYTES) {
    throw new Error(
      `ast_edit preview cannot fit mandatory content plus declaration omission metadata within the ${ASTConfig.PREVIEW_LLM_MAX_BYTES}-byte budget`,
    );
  }

  return {
    lines,
    renderedDeclarations: rendered.length,
    totalDeclarations: declarations.length,
    bounded,
  };
}
