/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buildPreMergeChecksPrompt,
  DEFAULT_PR_TEMPLATE_SECTIONS,
  type PrContext,
} from './pr-review-prompts.ts';
import { LOCAL_REVIEW_PROMPT_BYTES } from './pr-review-local.ts';
import type { bindSourceEvidence } from './pr-review-evidence.ts';

interface AcceptanceArtifacts {
  prContext: PrContext;
  diffs: Array<{ filePath: string; content: string }>;
  acceptanceMode: 'fulfillment' | 'alignment';
}
interface FileSummary {
  filePath: string;
  summary: string;
  signature: string;
  packet: number;
  available: boolean;
  source?: ReturnType<typeof bindSourceEvidence>;
}

export async function acceptanceEvidence(
  artifacts: AcceptanceArtifacts,
  issue: unknown,
  _stage: unknown,
  summaries: FileSummary[],
): Promise<unknown[]> {
  // Small changes keep original source, avoiding another lossy extraction pass.
  const raw = artifacts.diffs.map((diff) => ({
    filePath: diff.filePath,
    diff: diff.content,
    sources: summaries
      .filter((item) => item.filePath === diff.filePath)
      .map((item) => item.source),
  }));
  const notes = [...new Set(summaries.map((item) => item.filePath))].map(
    (filePath) => {
      const items = summaries.filter((item) => item.filePath === filePath);
      return {
        filePath,
        packets: items.map((item) => ({
          packet: item.packet,
          available: item.available,
        })),
        summaries: [...new Set(items.map((item) => item.summary))],
        signatures: [...new Set(items.map((item) => item.signature))],
        sources: [
          ...new Map(
            items.map((item) => [
              JSON.stringify({
                kind: item.source?.kind,
                execution: item.source?.execution,
                context: item.source?.context,
              }),
              {
                kind: item.source?.kind,
                execution: item.source?.execution,
                context: item.source?.context,
              },
            ]),
          ).values(),
        ],
      };
    },
  );
  const render = (evidence: unknown[]): string =>
    buildPreMergeChecksPrompt(
      artifacts.prContext,
      [issue],
      DEFAULT_PR_TEMPLATE_SECTIONS,
      evidence,
      artifacts.acceptanceMode,
    );
  if (Buffer.byteLength(render(raw)) <= LOCAL_REVIEW_PROMPT_BYTES) return raw;
  if (Buffer.byteLength(render(notes)) <= LOCAL_REVIEW_PROMPT_BYTES)
    return notes;
  // A complete manifest is retained in the result even when acceptance cannot fit.
  throw new Error(
    'Acceptance evidence exceeds bounded context; fulfillment is unverified',
  );
}
