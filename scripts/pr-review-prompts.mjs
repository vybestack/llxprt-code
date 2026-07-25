/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const TRIAGE_TAGS = [
  'feature',
  'test',
  'docs',
  'refactor',
  'fix',
  'chore',
  'ci',
];

export const DEFAULT_PR_TEMPLATE_SECTIONS = [
  'TLDR',
  'Dive Deeper',
  'Reviewer Test Plan',
  'Testing Matrix',
  'Linked issues / bugs',
];

export function buildMapPrompt(filePath, diffContent, prContext) {
  return [
    `You are analyzing a single file changed in PR #${prContext.number}: "${prContext.title}".`,
    `File: ${filePath}`,
    '',
    '## Diff',
    '```diff',
    diffContent,
    '```',
    '',
    '## Task',
    'Produce a concise per-file summary for a walkthrough/changes table.',
    `- summary: describe what changed in this file, 100 words or fewer.`,
    '- signature: notable exported signatures or behavior changes (e.g. "foo() -> number").',
    `- triage: exactly one of: ${TRIAGE_TAGS.join(', ')}.`,
    '',
    '## Output',
    'Respond with STRICT JSON only — no prose outside the JSON:',
    '{"summary": "...", "signature": "...", "triage": "..."}',
  ].join('\n');
}

export function buildGroupPrompt(summaries, prContext) {
  const fileList = summaries
    .map((s) => `- ${s.filePath}: ${s.summary} [${s.triage}]`)
    .join('\n');
  return [
    `You are grouping changed files from PR #${prContext.number} into themes.`,
    '',
    '## File Summaries',
    fileList,
    '',
    '## Task',
    'Cluster these files into logical themes/layers. Each theme groups related changes.',
    'For each theme provide:',
    '- layer: a short label (e.g. "core", "ui", "tests", "ci")',
    '- files: array of file paths in that theme',
    '- summary: one-line description of what the theme accomplishes',
    '',
    'These themes will be rendered as a markdown table with columns:',
    'Layer | File(s) | Summary',
    '',
    '## Output',
    'Respond with STRICT JSON only:',
    '{"themes": [{"layer": "...", "files": ["..."], "summary": "..."}]}',
  ].join('\n');
}

export function buildSynthesisPrompts(context) {
  const { prContext, themes, fullIssueBodies } = context;
  const list = themes.map((t) => `- ${t.layer}: ${t.summary}`).join('\n');
  const issueList = (fullIssueBodies ?? [])
    .map((i) => `- #${i.number}: ${i.title}`)
    .join('\n');
  const walkthrough = [
    `You are writing a walkthrough for PR #${prContext.number}: "${prContext.title}".`,
    '',
    '## Themes',
    list,
    '',
    '## Task — Part 1: Walkthrough',
    'Write a before→after walkthrough paragraph explaining what this PR changes.',
    'Describe the state before this PR and the state after.',
    '',
    '## Task — Part 2: Release Notes',
    'Produce categorized release notes bullets. Use these headings as needed:',
    '- New Features',
    '- Bug Fixes',
    '- Tests',
    '- Documentation',
    '- Refactor',
    '- Chore',
    'Omit any heading that has no entries.',
    '',
    '## Output',
    'Respond with STRICT JSON only:',
    '{"walkthrough": "...", "release_notes": "## Release Notes\\n..."}',
  ].join('\n');
  const sequenceDiagram = [
    `You are drawing a runtime sequence diagram for PR #${prContext.number}.`,
    '',
    '## Themes',
    list,
    '',
    '## Task',
    'If the changes involve inter-component runtime flow, produce a single',
    'Mermaid sequenceDiagram showing the runtime interaction between components.',
    '',
    '## Output',
    'Respond with STRICT JSON only:',
    '{"diagram": "```mermaid\\nsequenceDiagram\\n  A->>B: ...\\n```"}',
    'If no meaningful runtime flow changed, return: {"diagram": ""}',
  ].join('\n');
  const related = [
    `You are finding related issues and PRs for PR #${prContext.number}.`,
    '',
    '## Known Linked Issues',
    issueList || '(none)',
    '',
    '## Task',
    'Identify other issues or PRs in this repository that are semantically related.',
    'For each, explain why it is related in one line.',
    '',
    '## Output',
    'Respond with STRICT JSON only:',
    '{"related": "- #123: related because ...\\n- #456: related because ..."}',
    'If none found, return: {"related": ""}',
  ].join('\n');
  return { walkthroughReleaseNotes: walkthrough, sequenceDiagram, related };
}

export function buildPreMergeChecksPrompt(
  prContext,
  fullIssueBodies,
  prTemplateSections,
  changeEvidence = [],
) {
  const sections =
    prTemplateSections.length > 0
      ? prTemplateSections
      : DEFAULT_PR_TEMPLATE_SECTIONS;
  const issueBodies = fullIssueBodies
    .map((i) => `### Issue #${i.number}: ${i.title}\n${i.body}`)
    .join('\n\n');
  const evidenceList = changeEvidence
    .map((c) => `- ${c.filePath} [${c.triage}]: ${c.summary}`)
    .join('\n');
  const evidenceBlock = evidenceList || '(no per-file summaries available)';
  return [
    `You are performing pre-merge checks for PR #${prContext.number}: "${prContext.title}".`,
    '',
    '## PR Description',
    prContext.body || '(no description)',
    '',
    '## Linked Issues (full bodies with acceptance criteria)',
    issueBodies,
    '',
    '## Actual Code Changes (per-file summaries)',
    evidenceBlock,
    '',
    '## PR Template Sections (expected in the description)',
    sections.map((s) => `- ${s}`).join('\n'),
    '',
    '## Task',
    'Evaluate this PR against pre-merge criteria:',
    '- title: Is the PR title clear and descriptive?',
    `- description: Does the PR body include the expected template sections (${sections.join(', ')})?`,
    '- linked_issues: Do the changes actually fulfill the linked issue acceptance criteria?',
    `  Judge fulfillment against these actual changes:\n${evidenceBlock}`,
    '- out_of_scope: Note anything out of scope or missing.',
    '',
    '## Output',
    'Respond with STRICT JSON only:',
    '{"title": {"ok": true, "note": "..."}, "description": {"ok": true, "note": "..."}, "linked_issues": {"ok": true, "note": "..."}, "out_of_scope": {"note": "..."}}',
  ].join('\n');
}
