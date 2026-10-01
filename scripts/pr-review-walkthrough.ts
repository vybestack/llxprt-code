#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { acceptanceEvidence } from './pr-review-acceptance.ts';
import {
  bindSourceEvidence,
  renderRelatedSelections,
  readSourceContext,
} from './pr-review-evidence.ts';
import {
  buildMapPrompt,
  buildGroupPrompt,
  buildSynthesisPrompts,
  buildPreMergeChecksPrompt,
  DEFAULT_PR_TEMPLATE_SECTIONS,
} from './pr-review-prompts.ts';
import {
  runLlxprtPromptWithParse,
  saveParseFailureArtifact,
} from './pr-review-llm-helpers.ts';
import { readArtifacts, ArtifactFailure } from './pr-review-artifacts.ts';
import {
  extractJsonObject,
  parseMapResponse,
  parseGroupResponse,
  renderWalkthroughComment,
  validateGroupThemes,
  computeMagnitude,
  gateSequenceDiagram,
  sanitizeSequenceDiagram,
  type GroupTheme,
} from './pr-review-walkthrough-parse.ts';
import {
  createLocalReviewRunner,
  LOCAL_REVIEW_MODEL,
  splitReviewDiff,
  parseSynthesis,
  parsePreMergeChecks,
  checkDescription,
  batchReviewInputs,
  reviewResponseFormat,
} from './pr-review-local.ts';

export {
  buildMapPrompt,
  buildGroupPrompt,
  buildSynthesisPrompts,
  buildPreMergeChecksPrompt,
};
export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  isParseError,
  isRetryableLlxprtError,
  runLlxprtPromptWithParse,
  saveParseFailureArtifact,
} from './pr-review-llm-helpers.ts';
export {
  parseDiffManifest,
  resolveOriginalPath,
} from './pr-review-artifacts.ts';
export {
  parseMapResponse,
  parseGroupResponse,
  renderWalkthroughComment,
  validateGroupThemes,
  escapeMarkdownTableCell,
  computeMagnitude,
  gateSequenceDiagram,
  sanitizeSequenceDiagram,
} from './pr-review-walkthrough-parse.ts';
export type { GroupTheme };
export const MAX_DIFF_BYTES = 50000;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrencyLimit: unknown,
  asyncFn: (item: T) => Promise<R>,
): Promise<Array<R | { error: string; filePath: unknown }>> {
  const limit = Number(concurrencyLimit);
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('concurrencyLimit must be a positive integer');
  const results: Array<R | { error: string; filePath: unknown }> = new Array(
    items.length,
  );
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      try {
        results[index] = await asyncFn(item);
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : String(error),
          filePath:
            item && typeof item === 'object' && 'filePath' in item
              ? item.filePath
              : undefined,
        };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export { sanitizeErrorMessage } from './pr-review-llm-helpers.ts';

const artifactSchema = z.object({
  prContext: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().optional(),
    author: z.string().optional(),
    baseRefName: z.string().optional(),
    headRefName: z.string().optional(),
    additions: z.number().optional(),
    deletions: z.number().optional(),
    changedFiles: z.number().optional(),
    commits: z.number().optional(),
  }),
  issues: z.array(z.unknown()),
  acceptanceIssues: z.array(z.unknown()),
  acceptanceMode: z.enum(['fulfillment', 'alignment']),
  relatedItems: z.array(z.unknown()).default([]),
  relatedUnavailable: z.boolean().default(false),
  changedFilePaths: z.array(z.string()),
  diffs: z.array(z.object({ filePath: z.string(), content: z.string() })),
  magnitudeInput: z.object({
    additions: z.number(),
    deletions: z.number(),
    changedFiles: z.number(),
    packageCount: z.number(),
    criteriaCount: z.number(),
  }),
});
type Artifacts = z.infer<typeof artifactSchema>;
type PromptRunner = (
  prompt: string,
  responseFormat?: object,
  options?: { phase?: string },
) => Promise<string>;
interface FileSummary {
  filePath: string;
  summary: string;
  signature: string;
  triage: string;
  available: boolean;
  packet: number;
  source?: ReturnType<typeof bindSourceEvidence>;
}

type Stage = <T>(
  phase: string,
  prompt: string,
  parser: (raw: string) => T,
) => Promise<T>;
function createStage(
  reviewDir: string,
  runPrompt: PromptRunner,
  unavailable: string[],
  completed: Set<string>,
): Stage {
  return async <T>(
    phase: string,
    prompt: string,
    parser: (raw: string) => T,
  ): Promise<T> => {
    try {
      let correction = '';
      const result = await runLlxprtPromptWithParse(
        () =>
          runPrompt(prompt + correction, reviewResponseFormat(phase), {
            phase,
          }),
        (raw) => {
          try {
            return parser(raw);
          } catch {
            correction = `
The last response failed validation. Return all required fields and complete JSON only. Keep descriptions concise. For grouping, include every supplied path exactly once with no invented paths. For related, use only selections with verified numbers and short reasons, never markdown.`;
            throw new Error(
              `Invalid ${phase} response: response contract failed`,
            );
          }
        },
        {
          maxRetries: 1,
          phase,
          promptLength: prompt.length,
          saveParseFailure: (failedPhase, raw, promptLength) =>
            saveParseFailureArtifact(reviewDir, failedPhase, raw, {
              promptLength,
            }),
        },
      );
      completed.add(phase);
      return result;
    } catch (error) {
      recordPhaseFailure(unavailable, phase, error);
      throw error;
    }
  };
}

async function groupFiles(
  artifacts: Artifacts,
  summaries: FileSummary[],
  stage: Stage,
  unavailable: string[],
): Promise<GroupTheme[]> {
  const fallbackThemes = artifacts.changedFilePaths.map((filePath) => ({
    layer: path.dirname(filePath),
    files: [filePath],
    summary:
      summaries
        .filter((s) => s.filePath === filePath)
        .map((s) => s.summary)
        .join(' ') || '(per-file summary unavailable)',
  }));
  let themes: GroupTheme[] = fallbackThemes;
  try {
    const batches: GroupTheme[][] = [];
    const fileEvidence = artifacts.changedFilePaths.map((filePath) => ({
      filePath,
      sourceEvidence: summaries
        .filter((item) => item.filePath === filePath)
        .map((item) => item.source),
      summary: summaries
        .filter((item) => item.filePath === filePath)
        .map((item) => item.summary)
        .filter((summary, index, all) => all.indexOf(summary) === index)
        .join(' '),
    }));
    for (const batch of batchReviewInputs(
      fileEvidence,
      (items) => buildGroupPrompt(items, artifacts.prContext),
      12,
    )) {
      const grouped = await stage(
        'group',
        buildGroupPrompt(batch, artifacts.prContext),
        (raw) => {
          const result = parseGroupResponse(raw);
          const actual = result.themes.flatMap((theme) => theme.files);
          const expected = batch.map((item) => item.filePath);
          if (
            actual.length !== expected.length ||
            new Set(actual).size !== expected.length ||
            actual.some((file) => !expected.includes(file))
          )
            throw new Error(
              'Invalid group response: omitted, repeated or invented paths',
            );
          return result;
        },
      );
      batches.push(grouped.themes);
    }
    const groupedThemes = batches.flat();
    const files = groupedThemes.flatMap((theme) => theme.files);
    if (
      files.some((file) => !artifacts.changedFilePaths.includes(file)) ||
      artifacts.changedFilePaths.some((file) => !files.includes(file))
    )
      throw new Error('Grouping omitted or invented files');
    themes = groupedThemes;
  } catch {
    recordPhaseFailure(unavailable, 'group');
  }
  return themes;
}

interface Synthesis {
  walkthrough: string;
  releaseNotes: string;
  sequenceDiagram: string;
  related: string;
}
interface SynthesisUnit {
  theme: GroupTheme;
  observation: FileSummary;
}
function splitObservation(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const character of text) {
    if (Buffer.byteLength(current + character) > 4000) {
      chunks.push(current);
      current = '';
    }
    current += character;
  }
  return [...chunks, current];
}
function synthesisUnits(
  themes: GroupTheme[],
  summaries: FileSummary[],
): SynthesisUnit[] {
  return themes.flatMap((theme) =>
    theme.files.flatMap((filePath) =>
      summaries
        .filter((summary) => summary.filePath === filePath)
        .flatMap((observation) => {
          const notes = splitObservation(observation.summary);
          const signatures = splitObservation(observation.signature);
          const themeNotes = splitObservation(theme.summary);
          return Array.from(
            {
              length: Math.max(
                notes.length,
                signatures.length,
                themeNotes.length,
              ),
            },
            (_, index) => ({
              theme: {
                ...theme,
                files: [filePath],
                summary: themeNotes[index] ?? '',
              },
              observation: {
                ...observation,
                summary: notes[index] ?? '',
                signature: signatures[index] ?? '',
              },
            }),
          );
        }),
    ),
  );
}
function synthesisPrompts(
  artifacts: Artifacts,
  units: SynthesisUnit[],
): ReturnType<typeof buildSynthesisPrompts> {
  return buildSynthesisPrompts({
    prContext: artifacts.prContext,
    themes: units.map((unit) => unit.theme),
    summaries: units.map((unit) => unit.observation),
    fullIssueBodies: [...artifacts.issues, ...artifacts.relatedItems],
  });
}
function recordPhaseFailure(
  unavailable: string[],
  phase: string,
  error?: unknown,
): void {
  if (!unavailable.includes(phase)) unavailable.push(phase);
  const cause =
    error instanceof Error &&
    /^Local inference HTTP [1-5][0-9]{2}$/.test(error.message)
      ? error.message
      : 'construction, inference or validation';
  console.error(`[walkthrough] ${phase} unavailable (${cause}).`);
}
async function synthesize(
  artifacts: Artifacts,
  summaries: FileSummary[],
  themes: GroupTheme[],
  stage: Stage,
  unavailable: string[],
): Promise<Synthesis> {
  const buildPrompts = (
    items: SynthesisUnit[],
  ): ReturnType<typeof buildSynthesisPrompts> =>
    synthesisPrompts(artifacts, items);
  const units = synthesisUnits(themes, summaries);
  let walkthrough =
    `This PR changes ${artifacts.changedFilePaths.length} file(s).\n\n` +
    summaries.map((s) => `- \`${s.filePath}\`: ${s.summary}`).join('\n');
  let releaseNotes = '';
  try {
    const sections: Array<ReturnType<typeof parseSynthesis>> = [];
    for (const batch of batchReviewInputs(
      units,
      (items) => buildPrompts(items).walkthroughReleaseNotes,
    )) {
      sections.push(
        await stage(
          'synthesis',
          buildPrompts(batch).walkthroughReleaseNotes,
          parseSynthesis,
        ),
      );
    }
    walkthrough = sections.map((section) => section.walkthrough).join('\n\n');
    releaseNotes = sections
      .map((section) => section.release_notes)
      .join('\n\n');
  } catch {
    recordPhaseFailure(unavailable, 'synthesis');
  }
  let sequenceDiagram = '';
  if (
    gateSequenceDiagram(validateGroupThemes(themes), artifacts.changedFilePaths)
  ) {
    try {
      sequenceDiagram = await synthesizeDiagrams(
        units,
        (items) => buildPrompts(items).sequenceDiagram,
        stage,
        unavailable,
      );
    } catch {
      recordPhaseFailure(unavailable, 'diagram');
    }
  }
  let related = 'Related assessment unavailable.';
  try {
    const relatedPrompt = buildSynthesisPrompts({
      prContext: artifacts.prContext,
      themes,
      summaries: [],
      fullIssueBodies: [...artifacts.issues, ...artifacts.relatedItems],
    }).related;
    batchReviewInputs([relatedPrompt], (items) => items.join(''));
    related = await stage('related', relatedPrompt, (raw) =>
      renderRelatedSelections(raw, [
        ...artifacts.issues,
        ...artifacts.relatedItems,
      ]),
    );
  } catch {
    recordPhaseFailure(unavailable, 'related');
  }
  if (artifacts.relatedUnavailable)
    related =
      'Related discovery unavailable. Retrieved items do not establish complete discovery.\n' +
      related;
  return { walkthrough, releaseNotes, sequenceDiagram, related };
}

async function synthesizeDiagrams(
  themes: SynthesisUnit[],
  render: (items: SynthesisUnit[]) => string,
  stage: Stage,
  unavailable: string[],
): Promise<string> {
  const diagrams: string[] = [];
  for (const batch of batchReviewInputs(themes, render)) {
    const diagram = await stage('diagram', render(batch), (raw) =>
      z.object({ diagram: z.string() }).parse(extractJsonObject(raw)),
    );
    const sanitized = sanitizeSequenceDiagram(diagram.diagram);
    if (diagram.diagram.trim() && !sanitized)
      unavailable.push('invalid sequence diagram');
    if (sanitized) diagrams.push(sanitized);
  }
  return diagrams.join('\n\n');
}

async function assessAcceptance(
  artifacts: Artifacts,
  summaries: FileSummary[],
  missingPaths: string[],
  stage: Stage,
): Promise<ReturnType<typeof parsePreMergeChecks> | null> {
  let preMergeChecks: ReturnType<typeof parsePreMergeChecks> | null = null;
  try {
    const checks: Array<ReturnType<typeof parsePreMergeChecks>> = [];
    for (const issue of artifacts.acceptanceIssues.length
      ? artifacts.acceptanceIssues
      : [null]) {
      const evidence = await acceptanceEvidence(
        artifacts,
        issue,
        stage,
        summaries,
      );
      checks.push(
        await stage(
          'pre-merge',
          buildPreMergeChecksPrompt(
            artifacts.prContext,
            [issue],
            DEFAULT_PR_TEMPLATE_SECTIONS,
            evidence,
            artifacts.acceptanceMode,
          ),
          parsePreMergeChecks,
        ),
      );
    }
    const first = checks[0];
    if (!first) throw new Error('No linked acceptance evidence');
    preMergeChecks = {
      ...first,
      description: checkDescription(artifacts.prContext.body ?? ''),
      linked_issues: {
        ok: checks.every((check) => check.linked_issues.ok),
        note: `${artifacts.acceptanceMode === 'alignment' ? 'Referenced alignment' : 'Closing fulfillment'}: ${checks.map((check) => check.linked_issues.note).join(' ')}`,
      },
      out_of_scope: {
        note: [...new Set(checks.map((check) => check.out_of_scope.note))].join(
          ' ',
        ),
      },
    };
    if (
      summaries.some((summary) => !summary.available) ||
      missingPaths.length
    ) {
      preMergeChecks = {
        ...preMergeChecks,
        linked_issues: {
          ok: false,
          note: 'Acceptance alignment is unverified because changed-file evidence is incomplete.',
        },
      };
    }
  } catch {
    console.error(
      '[walkthrough] pre-merge unavailable (construction, inference or validation).',
    );
  }
  return preMergeChecks;
}

async function writeResult(
  reviewDir: string,
  artifacts: Artifacts,
  summaries: FileSummary[],
  themes: GroupTheme[],
  synthesis: Synthesis,
  preMergeChecks: ReturnType<typeof parsePreMergeChecks> | null,
  unavailable: string[],
  model: string,
): Promise<void> {
  const { walkthrough, releaseNotes, sequenceDiagram, related } = synthesis;
  const uniqueUnavailable = [...new Set(unavailable)];
  const state = uniqueUnavailable.length ? 'incomplete' : 'complete';
  const completion =
    state === 'incomplete'
      ? `## Review incomplete\nCoverage or stages unavailable: ${uniqueUnavailable.map((item) => `\`${item}\``).join(', ')}. Acceptance completion is not established. Inspect diagnostics.`
      : '## Review completion\nAll changed-file packets and walkthrough stages completed. This advisory walkthrough does not establish correctness or merge readiness.';
  const comment = renderWalkthroughComment({
    walkthrough: `${completion}\n\nRunner-local model: ${model}. Completion reports evidence and stage coverage, not factual accuracy or quality approval.\n\n${walkthrough}`,
    releaseNotes,
    themes,
    sequenceDiagram,
    magnitude: computeMagnitude(artifacts.magnitudeInput),
    related,
    preMergeChecks: preMergeChecks ?? {
      title: { ok: false, note: 'Title assessment unavailable.' },
      description: checkDescription(artifacts.prContext.body ?? ''),
      linked_issues: {
        ok: false,
        note: 'Issue assessment unavailable. Fulfillment or alignment is unverified.',
      },
      out_of_scope: { note: 'Scope assessment unavailable.' },
    },
  });
  await fs.writeFile(path.join(reviewDir, 'comment.md'), comment);
  await fs.writeFile(path.join(reviewDir, 'walkthrough.md'), comment);
  await fs.writeFile(
    path.join(reviewDir, 'result.json'),
    JSON.stringify(
      {
        state,
        model,
        baseSha: process.env.MERGE_BASE,
        headSha: process.env.PR_HEAD_SHA,
        unavailable: uniqueUnavailable,
        summaries,
        themes,
        preMergeChecks,
      },
      null,
      2,
    ),
  );
}

export async function runPipeline(
  reviewDir: string,
  runPrompt: PromptRunner = createLocalReviewRunner({
    endpoint: process.env.LOCAL_REVIEW_ENDPOINT,
    evidenceDir: path.join(reviewDir, 'inference'),
  }),
  {
    model = LOCAL_REVIEW_MODEL,
    requireRelated = false,
  }: { model?: string; requireRelated?: boolean } = {},
): Promise<void> {
  const artifacts = artifactSchema.parse(
    await readArtifacts(reviewDir, { requireRelated }),
  );
  const unavailable: string[] = [];
  const completed = new Set<string>();
  const stage = createStage(reviewDir, runPrompt, unavailable, completed);
  if (artifacts.relatedUnavailable) unavailable.push('related-discovery');
  const summaries = await mapFiles(reviewDir, artifacts, stage);
  const missingPaths = artifacts.changedFilePaths.filter(
    (file) => !summaries.some((summary) => summary.filePath === file),
  );
  unavailable.push(...missingPaths.map((file) => 'missing diff: ' + file));
  unavailable.push(
    ...summaries
      .filter((s) => !s.available)
      .map((s) => 'unreviewed packet: ' + s.filePath + ' (' + s.packet + ')'),
  );
  if (artifacts.diffs.length === 0) unavailable.push('no diff evidence');
  const themes = await groupFiles(artifacts, summaries, stage, unavailable);
  const synthesis = await synthesize(
    artifacts,
    summaries,
    themes,
    stage,
    unavailable,
  );
  const preMergeChecks = await assessAcceptance(
    artifacts,
    summaries,
    missingPaths,
    stage,
  );
  if (!preMergeChecks) unavailable.push('pre-merge');
  const required = ['map', 'group', 'synthesis', 'related', 'pre-merge'];
  if (
    gateSequenceDiagram(validateGroupThemes(themes), artifacts.changedFilePaths)
  )
    required.push('diagram');
  for (const phase of required) {
    if (!completed.has(phase)) recordPhaseFailure(unavailable, phase);
  }
  if (!synthesis.releaseNotes.trim())
    recordPhaseFailure(unavailable, 'synthesis');
  await writeResult(
    reviewDir,
    artifacts,
    summaries,
    themes,
    synthesis,
    preMergeChecks,
    unavailable,
    model,
  );
}

async function mapFiles(
  reviewDir: string,
  artifacts: Artifacts,
  stage: Stage,
): Promise<FileSummary[]> {
  const context = await readSourceContext(reviewDir);
  const packets = artifacts.diffs.flatMap((diff) =>
    splitReviewDiff(diff.content).map((packet, index) => ({
      filePath: diff.filePath,
      ...packet,
      packet: index + 1,
    })),
  );
  const results = await mapWithConcurrency(
    packets,
    1,
    async (item): Promise<FileSummary> => {
      if (!item.available)
        return {
          filePath: item.filePath,
          packet: item.packet,
          available: false,
          summary: '(per-file summary unavailable: oversized hunk)',
          signature: '',
          triage: 'chore',
        };
      const mapped = await stage(
        'map',
        buildMapPrompt(item.filePath, item.content, artifacts.prContext, {
          packet: item.packet,
          packetCount: packets.filter(
            (packet) => packet.filePath === item.filePath,
          ).length,
          source: bindSourceEvidence(
            item.filePath,
            item.content,
            item.packet,
            [],
            context[item.filePath] ?? [],
          ),
        }),
        (raw) => ({
          ...parseMapResponse(raw),
          source: bindSourceEvidence(
            item.filePath,
            item.content,
            item.packet,
            [],
            context[item.filePath] ?? [],
          ),
        }),
      );
      return {
        ...mapped,
        filePath: item.filePath,
        packet: item.packet,
        available: true,
      };
    },
  );
  const summaries: FileSummary[] = results.map((result, index) =>
    'error' in result
      ? {
          filePath: packets[index].filePath,
          packet: packets[index].packet,
          available: false,
          summary: '(per-file summary unavailable)',
          signature: '',
          triage: 'chore',
        }
      : result,
  );
  await fs.mkdir(path.join(reviewDir, 'summaries'), { recursive: true });
  await fs.writeFile(
    path.join(reviewDir, 'summaries/all.json'),
    JSON.stringify(summaries, null, 2),
  );
  return summaries;
}

async function main(): Promise<void> {
  const reviewDir = process.env.REVIEW_DIR || 'review';
  try {
    await runPipeline(reviewDir, undefined, { requireRelated: true });
  } catch (error) {
    const diagnostic =
      error instanceof ArtifactFailure
        ? error.diagnostic
        : {
            category: 'pipeline-failure',
            operation: 'execute',
            path: 'review',
          };
    console.error(
      `Walkthrough pipeline unavailable: ${JSON.stringify(diagnostic)}. Inspect private diagnostics.`,
    );
    await fs.mkdir(reviewDir, { recursive: true });
    await fs.writeFile(
      path.join(reviewDir, 'comment.md'),
      '<!-- llxprt-walkthrough -->\n\n## LLxprt walkthrough unavailable\nThe walkthrough pipeline could not complete. Please inspect the workflow logs.',
    );
    await fs.writeFile(
      path.join(reviewDir, 'result.json'),
      JSON.stringify({ state: 'unavailable', diagnostic }),
    );
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
