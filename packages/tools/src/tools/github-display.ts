/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Human-readable rendering of `github` tool results.
 *
 * `llmContent` always carries the full shaped JSON the model needs; this
 * module produces the `returnDisplay` summary a person reads in the
 * transcript — "Commented on issue #438" instead of a raw JSON blob.
 *
 * `renderChecks` moved here from `github.ts`; `github.ts` re-exports it so
 * existing importers and tests keep working.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-013
 */

/** Maximum number of list/search lines rendered before a "… and N more" tail. */
const MAX_SUMMARY_LINES = 10;

type Data = Readonly<Record<string, unknown>>;
type Params = Readonly<Record<string, unknown>>;

/** Reads a string field, tolerating an absent or non-string value. */
function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Reads a numeric field, tolerating an absent or non-numeric value. */
function asNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Narrows an unknown value to a record without an assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads a nested record field, tolerating an absent or non-object value. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Reads a string array field, dropping non-string elements. */
function asStrArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((el): el is string => typeof el === 'string');
}

/** Reads an object array field, dropping non-object elements. */
function asDataArray(value: unknown): readonly Data[] {
  if (!Array.isArray(value)) return [];
  return value.filter((el): el is Data => isRecord(el));
}

/**
 * Renders a number prefix from the data (shaped result) falling back to the
 * request parameter, e.g. "#438". Returns an empty string when neither is a
 * number — the comment ops carry the number in the request, not the shape.
 */
function numberMarker(data: Data, params: Params): string {
  const fromData = asNum(data.number);
  if (fromData !== null) return `#${fromData}`;
  const fromParams = asNum(params.number);
  return fromParams !== null ? `#${fromParams}` : '';
}

/** Renders the "… and N more" tail for a list that exceeds the cap. */
function moreTail(total: number): string {
  const rest = total - MAX_SUMMARY_LINES;
  return rest > 0 ? `… and ${rest} more` : '';
}

/** Maximum displayed lines for a diff before a "… N more lines" tail. */
const MAX_DIFF_LINES = 200;
/**
 * Maximum displayed lines for an issue/PR body before a "… N more lines" tail.
 *
 * Deliberately small: the transcript's result pane shows the TAIL of an
 * oversized block, so a generous body cap pushes the "Issue #N · state ·
 * title" header off screen and leaves the reader with a fragment and no
 * context. The full text is always in `llmContent` for the model.
 */
const MAX_BODY_LINES = 10;
/** Maximum displayed lines for a single comment body. */
const MAX_COMMENT_LINES = 6;
/** Maximum displayed lines for a review-thread comment body. */
const MAX_REVIEW_COMMENT_LINES = 10;
/** Maximum number of comments rendered on an issue/PR view. */
const MAX_VIEW_COMMENTS = 3;

/**
 * Caps a block of text at `maxLines`, appending a "… N more lines" tail when
 * content is cut. The single helper used by every content renderer so the cap
 * and tail wording stay consistent.
 */
function capText(text: string, maxLines: number): string {
  if (text === '') return '';
  const NL = '\n';
  const lines = text.split(NL);
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines);
  return kept.join(NL) + NL + `… ${lines.length - maxLines} more lines`;
}

// ─── pr.checks (the watch renderer, unchanged) ───────────────────────────────

/** Marks a check's bucket for display. */
function bucketMark(bucket: string): string {
  if (bucket === 'pass') return 'pass';
  if (bucket === 'fail') return 'FAIL';
  if (bucket === 'skipping') return 'skip';
  return bucket || '?';
}

/**
 * Renders a checks result as a readable check list rather than raw JSON.
 *
 * `isWatch` distinguishes a blocking watch (which carries `concluded` /
 * `cancelled` status fields) from a plain `pr.checks` query (which returns
 * only `{ checks, summary }`). Sniffing for absent fields would label every
 * ordinary query "timed out", so the distinction is made explicit.
 *
 * Failures are listed first: after waiting minutes for CI, what you need is
 * the thing that broke, not an alphabetical roster.
 *
 * @plan PLAN-20260731-GHBROKER.P14
 * @requirement REQ-011
 */
export function renderChecks(data: Data, isWatch = false): string {
  const checks = asDataArray(data.checks);
  if (checks.length === 0) return 'No checks reported.';

  const summary = asRecord(data.summary) ?? {};
  const rank = (c: Data): number => {
    if (c.bucket === 'fail') return 0;
    if (c.bucket === 'pending') return 1;
    return 2;
  };
  const ordered = [...checks].sort((a, b) => rank(a) - rank(b));

  const lines = ordered.map((c) => {
    const name = asStr(c.name);
    return `  ${bucketMark(asStr(c.bucket))}  ${name}`;
  });

  const counts = ['pass', 'fail', 'pending', 'skipping']
    .map((k): [string, number] => [k, asNum(summary[k]) ?? 0])
    .filter(([, count]) => count > 0)
    .map(([k, count]) => `${count} ${k}`)
    .join(', ');
  let status = '';
  if (isWatch) {
    if (data.cancelled === true) status = ' cancelled';
    else if (data.concluded === true) status = ' complete';
    else status = ' timed out';
  }
  const header = `Checks${status}${counts ? ` — ${counts}` : ''}`;
  return [header, ...lines].join('\n');
}

// ─── per-op renderers ────────────────────────────────────────────────────────

/** issue.view / pr.view share a number · state · title first line. */
function renderViewHeader(prefix: string, data: Data): string {
  const n = asNum(data.number);
  const marker = n !== null ? `#${n}` : '?';
  return `${prefix} ${marker} · ${asStr(data.state)} · ${asStr(data.title)}`;
}

/** Renders the body and comment block shared by issue.view and pr.view. */
function renderViewContent(data: Data): string {
  const lines: string[] = [];
  const body = asStr(data.body);
  if (body !== '') {
    lines.push('');
    lines.push(capText(body, MAX_BODY_LINES));
  }
  const comments = asDataArray(data.comments);
  const shown = comments.slice(0, MAX_VIEW_COMMENTS);
  for (const c of shown) {
    const author = asStr(c.author);
    const created = asStr(c.createdAt);
    const who = author !== '' ? `${author}` : 'unknown';
    const when = created !== '' ? ` (${created})` : '';
    lines.push(`${who}${when}:`);
    lines.push(capText(asStr(c.body), MAX_COMMENT_LINES));
  }
  if (comments.length > MAX_VIEW_COMMENTS) {
    lines.push(`… and ${comments.length - MAX_VIEW_COMMENTS} more comments`);
  }
  return lines.join('\n');
}

/** Renders issue.view. */
function renderIssueView(data: Data): string {
  const lines = [renderViewHeader('Issue', data)];
  const author = asStr(data.author);
  if (author) lines.push(`by ${author}`);
  const labels = asStrArray(data.labels);
  if (labels.length > 0) lines.push(`labels: ${labels.join(', ')}`);
  const assignees = asStrArray(data.assignees);
  if (assignees.length > 0) lines.push(`assignees: ${assignees.join(', ')}`);
  const milestone = asStr(data.milestone);
  if (milestone) lines.push(`milestone: ${milestone}`);
  const comments = asDataArray(data.comments);
  if (comments.length > 0) lines.push(`${comments.length} comments`);
  const content = renderViewContent(data);
  if (content !== '') lines.push(content);
  return lines.join('\n');
}

/** Renders pr.view. */
function renderPrView(data: Data): string {
  const lines = [renderViewHeader('PR', data)];
  const head = asStr(data.headRefName);
  const base = asStr(data.baseRefName);
  if (head && base) lines.push(`${head} → ${base}`);
  if (data.isDraft === true) lines.push('draft');
  const review = asStr(data.reviewDecision);
  if (review) lines.push(`review: ${review}`);
  const comments = asDataArray(data.comments);
  if (comments.length > 0) lines.push(`${comments.length} comments`);
  const content = renderViewContent(data);
  if (content !== '') lines.push(content);
  return lines.join('\n');
}

/** Renders issue.list / pr.list. */
function renderList(op: string, data: Data): string {
  const key = op === 'issue.list' ? 'issues' : 'prs';
  const noun = op === 'issue.list' ? 'issues' : 'pull requests';
  const items = asDataArray(data[key]);
  const lines = [`${items.length} ${noun}`];
  for (const item of items.slice(0, MAX_SUMMARY_LINES)) {
    let line = `#${asNum(item.number) ?? '?'} ${asStr(item.state)}  ${asStr(item.title)}`;
    if (op === 'issue.list') {
      const assignees = asStrArray(item.assignees);
      const milestone = asStr(item.milestone);
      if (assignees.length > 0)
        line += ` (${assignees.join(', ')}${milestone ? ` · ${milestone}` : ''})`;
      else if (milestone) line += ` (${milestone})`;
    }
    lines.push(line);
  }
  const tail = moreTail(items.length);
  if (tail) lines.push(tail);
  return lines.join('\n');
}

/** Renders search.issues / search.prs. */
function renderSearch(op: string, data: Data): string {
  const key = op === 'search.issues' ? 'issues' : 'prs';
  const items = asDataArray(data[key]);
  const lines = [`${items.length} results`];
  for (const item of items.slice(0, MAX_SUMMARY_LINES)) {
    lines.push(
      `${asStr(item.repository)}#${asNum(item.number) ?? '?'} ${asStr(
        item.state,
      )}  ${asStr(item.title)}`,
    );
  }
  const tail = moreTail(items.length);
  if (tail) lines.push(tail);
  return lines.join('\n');
}

/** Renders run.list. */
function renderRunList(data: Data): string {
  const items = asDataArray(data.runs);
  const lines = [`${items.length} workflow runs`];
  for (const item of items.slice(0, MAX_SUMMARY_LINES)) {
    const verdict = asStr(item.conclusion) || asStr(item.status) || '?';
    lines.push(`${verdict}  ${asStr(item.name)}  (${asStr(item.headBranch)})`);
  }
  const tail = moreTail(items.length);
  if (tail) lines.push(tail);
  return lines.join('\n');
}

/** Renders label.list. */
function renderLabelList(data: Data): string {
  const items = asDataArray(data.labels);
  // Filter to labels that carry a non-empty string name: a label object with
  // an absent or non-string `name` renders nothing, so the header, slice and
  // tail must all use the filtered `names` count to stay consistent.
  const names = items.map((item) => asStr(item.name)).filter((n) => n);
  const lines = [`${names.length} labels`];
  const shown = names.slice(0, MAX_SUMMARY_LINES);
  if (shown.length > 0) lines.push(shown.join(', '));
  const tail = moreTail(names.length);
  if (tail) lines.push(tail);
  return lines.join('\n');
}

/**
 * Renders the truncation note for a shaped result.
 *
 * `truncated` is not one type across operations: pr.diff shapes it as
 * `{ field, originalBytes }` or null, pr.reviews as a boolean. Rather than
 * each renderer knowing which of the two its op happens to produce — and
 * silently dropping the notice if that ever changes — this reads both forms
 * and returns an empty string when nothing was cut.
 */
function truncationNote(value: unknown): string {
  if (value === true) return '(truncated)';
  const record = asRecord(value);
  if (record === null) return '';
  const bytes = asNum(record.originalBytes);
  return bytes !== null ? `truncated at ${bytes} bytes` : '(truncated)';
}

/** Renders pr.diff. */
function renderPrDiff(params: Params, data: Data): string {
  const n = asNum(params.number);
  const diff = asStr(data.diff);
  const lineCount = diff === '' ? 0 : diff.split('\n').length;
  const lines = [`Diff for PR #${n ?? '?'} — ${lineCount} lines`];
  const note = truncationNote(data.truncated);
  if (note !== '') lines.push(note);
  if (diff !== '') {
    lines.push(capText(diff, MAX_DIFF_LINES));
  }
  return lines.join('\n');
}

/** Renders pr.reviews. */
function renderPrReviews(data: Data): string {
  const threads = asDataArray(data.threads);
  const lines = [`${threads.length} review threads`];
  for (const thread of threads.slice(0, MAX_SUMMARY_LINES)) {
    const path = asStr(thread.path);
    const line = asNum(thread.line);
    const location = line !== null ? `${path}:${line}` : path;
    lines.push(location);
    const comments = asDataArray(thread.comments);
    // The upstream query fetches up to 100 comments per thread, so a single
    // thread could otherwise swallow the whole pane. Cap per thread the same
    // way the view renderer caps an issue/PR's comment list.
    const shown = comments.slice(0, MAX_VIEW_COMMENTS);
    for (const c of shown) {
      const author = asStr(c.author);
      const who = author !== '' ? `${author}: ` : '';
      const body = capText(asStr(c.body), MAX_REVIEW_COMMENT_LINES);
      lines.push(`  ${who}${body}`);
    }
    if (comments.length > MAX_VIEW_COMMENTS) {
      lines.push(
        `  … and ${comments.length - MAX_VIEW_COMMENTS} more comments`,
      );
    }
  }
  const tail = moreTail(threads.length);
  if (tail) lines.push(tail);
  const note = truncationNote(data.truncated);
  if (note !== '') lines.push(note);
  return lines.join('\n');
}

/** Renders the simple write-confirmation ops that return a number or name. */
function renderWriteSimple(op: string, params: Params, data: Data): string {
  switch (op) {
    case 'issue.create': {
      const n = asNum(data.number);
      const head = n !== null ? `Created issue #${n}` : 'Created an issue';
      return appendUrl(head, data);
    }
    case 'pr.create': {
      const n = asNum(data.number);
      const head =
        n !== null ? `Created pull request #${n}` : 'Created a pull request';
      return appendUrl(head, data);
    }
    case 'issue.comment':
      return appendUrl(
        `Commented on issue ${numberMarker(data, params)}`,
        data,
      );
    case 'pr.comment':
      return appendUrl(
        `Commented on pull request ${numberMarker(data, params)}`,
        data,
      );
    case 'issue.edit':
      return `Updated issue ${numberMarker(data, params)}`;
    case 'pr.edit':
      return `Updated pull request ${numberMarker(data, params)}`;
    case 'issue.close':
      return `Closed issue ${numberMarker(data, params)}`;
    case 'pr.ready':
      return `Marked pull request ${numberMarker(data, params)} ready for review`;
    case 'pr.resolve-thread':
      return 'Resolved review thread';
    case 'label.create':
      return `Created label ${asStr(data.name)}`.trim();
    default:
      return '';
  }
}

/** Appends a URL on its own line when the shaped result carries one. */
function appendUrl(head: string, data: Data): string {
  const url = asStr(data.url);
  return url ? `${head}\n${url}` : head;
}

/** Per-op renderer dispatch. */
const RENDERERS: Readonly<
  Record<string, (params: Params, data: Data) => string>
> = {
  'issue.view': (_p, d) => renderIssueView(d),
  'pr.view': (_p, d) => renderPrView(d),
  'issue.list': (_p, d) => renderList('issue.list', d),
  'pr.list': (_p, d) => renderList('pr.list', d),
  'search.issues': (_p, d) => renderSearch('search.issues', d),
  'search.prs': (_p, d) => renderSearch('search.prs', d),
  'run.list': (_p, d) => renderRunList(d),
  'label.list': (_p, d) => renderLabelList(d),
  'pr.diff': (p, d) => renderPrDiff(p, d),
  'pr.reviews': (_p, d) => renderPrReviews(d),
  'pr.checks': (p, d) => renderChecks(d, p.watch === true),
};

/**
 * Renders a shaped github result as a human-readable summary. The op selects
 * the renderer; an unknown op or missing fields never throws — absent fields
 * are simply omitted rather than replaced with raw JSON.
 *
 * When the call carried an explicit `repo`, it is appended so the transcript
 * shows where the action happened.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-013
 */
export function renderGithubResult(
  op: string,
  params: Params,
  data: Data,
): string {
  const rendered =
    op in RENDERERS
      ? RENDERERS[op](params, data)
      : renderWriteSimple(op, params, data);
  // An op with no renderer still gets a line naming it, so the transcript is
  // never blank; the full shaped JSON remains in llmContent either way.
  const core =
    rendered === '' ? `${op} ${numberMarker(data, params)}`.trim() : rendered;
  const repo = asStr(params.repo);
  if (repo === '') return core;
  // On the FIRST line: trailing it would strand "in owner/name" below a
  // 200-line diff, where it reads as part of the content.
  const [first, ...rest] = core.split('\n');
  return [`${first} in ${repo}`, ...rest].join('\n');
}
