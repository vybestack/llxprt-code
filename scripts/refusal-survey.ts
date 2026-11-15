/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import {
  resolveGlobalCacheDir,
  resolveGlobalLogDir,
} from '../packages/storage/src/config/path-resolver.ts';
import {
  readDumpIndex,
  type DumpIndexEntry,
} from './lib/refusal-survey-dump-index.ts';
import {
  hasRecoveryContent,
  readJournalIndex,
  type Journal,
} from './lib/refusal-survey-journal-index.ts';
import {
  correlationFor,
  type Correlation,
  type JoinMethod,
} from './lib/refusal-survey-correlation.ts';
import { formatRefusalSurvey } from './lib/refusal-survey-report.ts';

type Obj = Record<string, unknown>;
type ObservedCall = {
  projectHash: string;
  session: string;
  prompt: string;
  runtime: string;
  ts: string;
  refusal: boolean;
  childRuntime: boolean;
};
type Attempt = {
  projectHash: string;
  project: string;
  file: string;
  session: string;
  prompt: string;
  runtime: string;
  ts: string;
  model: string;
  provider: string;
  category: string | null;
  contextTokens: number | null;
  outcome: string;
  legacy: boolean;
  attemptIndex: number | null;
  dumpBaseId: string | null;
  raw: Obj;
};
type Run = Obj;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const walk = (root: string): string[] => {
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) found.push(file);
    }
  };
  visit(root);
  return found.sort();
};

async function* readLines(
  file: string,
  malformed: { count: number; examples: string[] },
): AsyncGenerator<unknown> {
  let lineNo = 0;
  const reader = createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    lineNo++;
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as unknown;
    } catch {
      malformed.count++;
      if (malformed.examples.length < 5)
        malformed.examples.push(`${file}:${lineNo}`);
    }
  }
}

function argumentsFrom(argv: string[]): {
  root: string;
  cache: string;
  since: number | null;
  project: string | null;
  json: string | null;
} {
  let root = path.join(resolveGlobalLogDir(), 'tmp');
  const cache = resolveGlobalCacheDir();
  let since: number | null = null;
  let project: string | null = null;
  let json: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = argv[i + 1];
    if (arg === '--root' && value) {
      root = path.resolve(value);
      i++;
    } else if (arg === '--since' && value) {
      const parsed = Date.parse(value);
      if (!Number.isFinite(parsed))
        throw new Error(`Invalid --since date: ${value}`);
      since = parsed;
      i++;
    } else if (arg === '--project' && value) {
      project = value;
      i++;
    } else if (arg === '--json' && value) {
      json = value;
      i++;
    } else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return { root, cache, since, project, json };
}

function displayProject(value: string): string {
  const segments = value.split(/[\\\\/]/).filter(Boolean);
  return segments.slice(-2).join('/') || value;
}

function projectName(projectDir: string, journals: Journal[]): string {
  const start = journals.find((record) => record.type === 'session_start');
  for (const key of ['workspace', 'cwd', 'project']) {
    const value = start ? str(start.payload[key]) : null;
    if (value) return displayProject(value);
  }
  const workspaceDirs = start?.payload['workspaceDirs'];
  const firstWorkspace = Array.isArray(workspaceDirs)
    ? workspaceDirs.find((item): item is string => typeof item === 'string')
    : null;
  if (firstWorkspace) return displayProject(firstWorkspace);
  return path.basename(projectDir);
}

function contentPreview(record: Journal): string {
  if (record.type === 'tool_response') {
    return `tool:${str(record.payload['toolName']) ?? 'unknown'}: ${str(record.payload['result']) ?? ''}`;
  }
  const content = isObj(record.payload['content'])
    ? record.payload['content']
    : null;
  const blocks =
    content && Array.isArray(content['blocks']) ? content['blocks'] : [];
  const snippets = blocks.flatMap((item) => {
    if (!isObj(item)) return [];
    if (item['type'] === 'text' && typeof item['text'] === 'string')
      return [item['text']];
    if (item['type'] === 'thinking' && typeof item['thought'] === 'string')
      return [item['thought']];
    if (item['type'] === 'tool_call')
      return [`tool:${String(item['name'] ?? 'unknown')}`];
    if (item['type'] === 'tool_response')
      return [
        `tool:${str(item['toolName']) ?? 'unknown'}: ${str(item['result']) ?? ''}`,
      ];
    return [];
  });
  const speaker = str(content?.['speaker']) ?? 'entry';
  const label = speaker === 'tool' ? '' : `${speaker}: `;
  return `${label}${snippets.join(' ').slice(0, 300)}`;
}

const STOP_WORDS = new Set([
  'tool',
  'human',
  'ai',
  'run',
  'shell',
  'command',
  'and',
  'the',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'you',
  'your',
  'not',
  'but',
  'about',
  'then',
  'when',
  'what',
  'will',
  'would',
  'can',
  'could',
  'should',
  'after',
  'before',
  'there',
  'their',
  'they',
  'them',
  'his',
  'her',
  'she',
  'him',
  'its',
  'our',
  'out',
  'all',
  'one',
  'two',
  'use',
  'using',
]);

function terms(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const original = match[0];
    const word = original.toLocaleLowerCase();
    if (isContentTerm(word) && !/[\p{Ll}][\p{Lu}]/u.test(original)) {
      words.add(word);
    }
  }
  return words;
}

function isContentTerm(value: string): boolean {
  return (
    value.length >= 3 &&
    /^\p{L}+$/u.test(value) &&
    !/^[\da-f]{8,}$/iu.test(value) &&
    !STOP_WORDS.has(value)
  );
}

type Malformed = { count: number; examples: string[] };
type Evidence = {
  attempts: Attempt[];
  calls: ObservedCall[];
  journals: Map<string, Journal[]>;
};
type Context = {
  prior: Journal | undefined;
  before: Journal[];
  lastCompression: Journal | undefined;
  contentSince: Journal[];
  rewritten: boolean;
};
type Counts = {
  categories: Record<string, number>;
  models: Record<string, number>;
  projects: Record<string, number>;
  terms: Map<string, { refused: number; accepted: number; pairs: number }>;
};
type CompressionCounts = Record<
  'after-compression' | 'elsewhere' | 'missing-evidence',
  { refusals: number; attempts: number }
>;

function isLegacyRefusal(row: Obj, outcome: string, model: string): boolean {
  const terminalRefusal =
    outcome === 'refusal' || str(row['finish_reason']) === 'refusal';

  const claudeEmpty =
    model.toLowerCase().includes('claude') && num(row['output_tokens']) === 0;
  const hasTiming = Object.hasOwn(row, 'ttft_ms');
  const contradictory =
    ['error', 'aborted', 'abandoned'].includes(outcome) ||
    ['stop', 'tool_calls', 'length', 'safety', 'content_filter'].includes(
      str(row['finish_reason']) ?? '',
    );
  return !terminalRefusal && claudeEmpty && !hasTiming && !contradictory;
}

function isIncludedUsage(value: unknown, since: number | null): value is Obj {
  return (
    isObj(value) &&
    (value['record_type'] === undefined || value['record_type'] === 'turn') &&
    isSinceMatch(str(value['ts']) ?? '', since)
  );
}

function isSinceMatch(ts: string, since: number | null): boolean {
  if (since === null) return true;
  return ts !== '' && Date.parse(ts) >= since;
}

function isRefusal(row: Obj, outcome: string, legacy: boolean): boolean {
  if (legacy) return true;
  return outcome === 'refusal' || str(row['finish_reason']) === 'refusal';
}

async function readUsage(
  dir: string,
  projectHash: string,
  project: string,
  options: ReturnType<typeof argumentsFrom>,
  malformed: Malformed,
): Promise<{ attempts: Attempt[]; calls: ObservedCall[] }> {
  const attempts: Attempt[] = [];
  const calls: ObservedCall[] = [];

  for (const file of walk(path.join(dir, 'token-usage')).filter((name) =>
    name.endsWith('.jsonl'),
  )) {
    for await (const value of readLines(file, malformed)) {
      if (!isIncludedUsage(value, options.since)) continue;
      const ts = str(value['ts']) ?? '';
      const outcome =
        str(value['attempt_outcome']) ?? str(value['finish_reason']) ?? '';
      const model = str(value['model']) ?? 'unknown';
      const legacy = isLegacyRefusal(value, outcome, model);
      const refusal = isRefusal(value, outcome, legacy);
      const session = str(value['session_id']) ?? path.basename(file, '.jsonl');
      const prompt = str(value['prompt_id']) ?? '';
      const runtime = str(value['runtime_id']) ?? '';
      const childRuntime =
        session.includes('::') ||
        /(?:^|[:/])(?:child|subagent)(?:[:/]|$)/iu.test(runtime) ||
        Boolean(str(value['subagent_id']) ?? str(value['subagent']) ?? '') ||
        value['is_subagent'] === true;
      calls.push({
        projectHash,
        session,
        prompt,
        runtime,
        ts,
        refusal,
        childRuntime,
      });
      if (refusal)
        attempts.push({
          projectHash,
          project,
          file,
          session,
          prompt: str(value['prompt_id']) ?? `file:${path.basename(file)}`,
          runtime,
          ts,
          model,
          provider: str(value['provider']) ?? 'unknown',
          category: str(value['refusal_category']),
          contextTokens:
            num(value['actual_prompt_tokens']) ??
            num(value['effective_actual_tokens']),
          outcome: legacy ? 'suspected' : 'refusal',
          legacy,
          attemptIndex: num(value['attempt_index']),
          dumpBaseId: str(value['dump_base_id']),
          raw: value,
        });
    }
  }
  return { attempts, calls };
}

async function collectEvidence(
  options: ReturnType<typeof argumentsFrom>,
  malformed: Malformed,
): Promise<Evidence> {
  const attempts: Attempt[] = [];
  const calls: ObservedCall[] = [];
  const journals = new Map<string, Journal[]>();
  if (!fs.existsSync(options.root)) return { attempts, calls, journals };
  const dirs = fs
    .readdirSync(options.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(options.root, entry.name))
    .sort();
  for (const dir of dirs) {
    const projectHash = path.basename(dir);
    if (options.project && !projectHash.startsWith(options.project)) continue;
    const projectJournals = await readJournalIndex(dir, malformed);
    journals.set(projectHash, projectJournals);
    const project = projectName(dir, projectJournals);
    const usage = await readUsage(
      dir,
      projectHash,
      project,
      options,
      malformed,
    );
    attempts.push(...usage.attempts);
    calls.push(...usage.calls);
  }
  return { attempts, calls, journals };
}

function compareAttempts(a: Attempt, b: Attempt): number {
  const fileOrder = a.file.localeCompare(b.file);
  if (fileOrder !== 0) return fileOrder;
  const timeOrder = a.ts.localeCompare(b.ts);
  if (timeOrder !== 0) return timeOrder;
  return (a.attemptIndex ?? -1) - (b.attemptIndex ?? -1);
}

function sameRunContext(previous: Run, attempt: Attempt): boolean {
  return (
    previous['projectHash'] === attempt.projectHash &&
    previous['session'] === attempt.session &&
    previous['runtime'] === attempt.runtime
  );
}

function sameRun(previous: Run, attempt: Attempt): boolean {
  return (
    sameRunContext(previous, attempt) &&
    previous['file'] === attempt.file &&
    previous['promptId'] === attempt.prompt
  );
}

function groupRuns(attempts: Attempt[]): Run[] {
  const runs: Run[] = [];
  for (const attempt of attempts.sort(compareAttempts)) {
    const previous = runs.at(-1);
    if (previous !== undefined && sameRun(previous, attempt)) {
      (previous['attempts'] as Attempt[]).push(attempt);
      previous['lastTime'] = attempt.ts;
    } else {
      runs.push({
        projectHash: attempt.projectHash,
        project: attempt.project,
        file: attempt.file,
        session: attempt.session,
        runtime: attempt.runtime,
        promptId: attempt.prompt,
        firstTime: attempt.ts,
        lastTime: attempt.ts,
        attempts: [attempt],
      });
    }
  }
  return runs;
}

const COMPRESSION_WINDOW_MS = 60_000;

function compressionBucket(
  hasCompression: boolean,
  withinWindow: boolean,
): keyof CompressionCounts {
  if (!hasCompression) return 'missing-evidence';
  return withinWindow ? 'after-compression' : 'elsewhere';
}

function summaryAuthor(
  provider: string | null,
  model: string | null,
): string | null {
  if (!model) return null;
  return provider ? `${provider}/${model}` : model;
}

function recoveryStatus(recovered: boolean, rewritten: boolean): string {
  if (!recovered) return 'none';
  return rewritten ? 'rewrite' : 'retry';
}

function compressionCounts(
  calls: ObservedCall[],
  journals: Map<string, Journal[]>,
): { counts: CompressionCounts; joins: Record<JoinMethod, number> } {
  const counts: CompressionCounts = {
    'after-compression': { refusals: 0, attempts: 0 },
    elsewhere: { refusals: 0, attempts: 0 },
    'missing-evidence': { refusals: 0, attempts: 0 },
  };
  const joins: Record<JoinMethod, number> = {
    exact: 0,
    'legacy-prompt-prefix': 0,
    'legacy-timestamp': 0,
    none: 0,
  };
  for (const call of calls.sort((a, b) => a.ts.localeCompare(b.ts))) {
    const correlation = correlationFor(
      call,
      journals.get(call.projectHash) ?? [],
    );
    joins[correlation.method]++;
    const latest = correlation.records
      .filter((record) => record.type === 'compressed' && record.ts <= call.ts)
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .at(-1);
    const elapsed = latest ? Date.parse(call.ts) - Date.parse(latest.ts) : -1;
    const bucket = compressionBucket(
      latest !== undefined,
      elapsed >= 0 && elapsed <= COMPRESSION_WINDOW_MS,
    );
    counts[bucket].attempts++;
    if (call.refusal) counts[bucket].refusals++;
  }
  return { counts, joins };
}

function contextFor(
  first: Attempt,
  list: Attempt[],
  journal: Journal[],
): Context {
  const related = journal.filter(
    (entry) =>
      str(entry.payload['prompt_id']) === first.prompt ||
      str(entry.payload['promptId']) === first.prompt,
  );
  const prior =
    related.find((entry) => entry.type === 'refusal') ??
    journal.find(
      (entry) =>
        entry.type === 'refusal' &&
        str(entry.payload['dump_base_id']) === first.dumpBaseId,
    );
  const priorSeq = prior?.seq ?? -1;
  const priorTime = prior?.ts ?? first.ts;
  const before = journal.filter(
    (entry) =>
      (entry.type === 'content' || entry.type === 'tool_response') &&
      (priorSeq >= 0 ? entry.seq < priorSeq : entry.ts <= priorTime),
  );
  const lastCompression = journal
    .filter(
      (entry) =>
        entry.type === 'compressed' &&
        (priorSeq >= 0 ? entry.seq < priorSeq : entry.ts <= priorTime),
    )
    .at(-1);
  const contentSince = lastCompression
    ? before.filter((entry) => entry.seq > lastCompression.seq)
    : [];
  const rewritten = journal.some(
    (entry) =>
      entry.type === 'refusal_rewrite' &&
      str(entry.payload['prompt_id']) === first.prompt &&
      list.some(
        (attempt) =>
          attempt.attemptIndex === num(entry.payload['attempt_index']),
      ),
  );
  return { prior, before, lastCompression, contentSince, rewritten };
}

function acceptedDumpFor(
  prompt: string,
  refusedId: string | null,
  dumps: Map<string, DumpIndexEntry>,
): [string, DumpIndexEntry] | undefined {
  return [...dumps.entries()].find(([id, item]) => {
    const promptId = item.promptId;
    const outcome = item.outcome;
    return (
      id !== refusedId &&
      promptId === prompt &&
      (outcome === 'paired-success' || outcome === 'success')
    );
  });
}

function updateCounts(list: Attempt[], counts: Counts): void {
  for (const attempt of list) {
    const category = attempt.category ?? 'unspecified';
    const model = `${attempt.provider}/${attempt.model}`;
    counts.categories[category] = (counts.categories[category] ?? 0) + 1;
    counts.models[model] = (counts.models[model] ?? 0) + 1;
    counts.projects[attempt.project] =
      (counts.projects[attempt.project] ?? 0) + 1;
  }
}

function addTermCounts(
  refused: Set<string>,
  accepted: Set<string>,
  counts: Counts,
): void {
  for (const term of new Set([...refused, ...accepted])) {
    const value = counts.terms.get(term) ?? {
      refused: 0,
      accepted: 0,
      pairs: 0,
    };
    if (refused.has(term)) value.refused++;
    if (accepted.has(term)) value.accepted++;
    value.pairs++;
    counts.terms.set(term, value);
  }
}

function joinForAttempt(
  first: Attempt,
  journals: Map<string, Journal[]>,
): Correlation {
  return correlationFor(
    {
      projectHash: first.projectHash,
      session: first.session,
      prompt: first.prompt,
      runtime: first.runtime,
      ts: first.ts,
      childRuntime:
        first.session.includes('::') ||
        /(?:^|[:/])(?:child|subagent)(?:[:/]|$)/iu.test(first.runtime) ||
        Boolean(
          str(first.raw['subagent_id']) ?? str(first.raw['subagent']) ?? '',
        ) ||
        first.raw['is_subagent'] === true,
    },
    journals.get(first.projectHash) ?? [],
  );
}

function decorateRun(
  run: Run,
  journals: Map<string, Journal[]>,
  dumps: Map<string, DumpIndexEntry>,
  counts: Counts,
): void {
  const list = run['attempts'] as Attempt[];
  const first = list[0]!;
  const correlation = joinForAttempt(first, journals);
  const journal = correlation.records;
  run['join'] = correlation.method;
  const context = contextFor(first, list, journal);
  const acceptedPair = acceptedDumpFor(first.prompt, first.dumpBaseId, dumps);
  const accepted = acceptedPair?.[1];
  const recovered =
    accepted !== undefined ||
    hasRecoveryContent(journal, first.prompt, list.at(-1)!.attemptIndex);
  const author =
    context.lastCompression &&
    isObj(context.lastCompression.payload['summaryAuthor'])
      ? context.lastCompression.payload['summaryAuthor']
      : null;
  const authorModel = context.lastCompression
    ? (str(context.lastCompression.payload['summary_author_model']) ??
      str(author?.['model']))
    : null;
  const authorProvider = context.lastCompression
    ? (str(context.lastCompression.payload['summary_author_provider']) ??
      str(author?.['provider']))
    : null;
  const refusedDump =
    first.dumpBaseId === null ? undefined : dumps.get(first.dumpBaseId);
  const refusedTerms =
    refusedDump !== undefined && refusedDump.requestTerms.length > 0
      ? new Set(refusedDump.requestTerms)
      : terms(context.before.slice(-8).map(contentPreview).join(' '));
  const acceptedTerms =
    accepted !== undefined && accepted.requestTerms.length > 0
      ? new Set(accepted.requestTerms)
      : terms(
          journal
            .filter(
              (entry) =>
                entry.type === 'content' &&
                isObj(entry.payload['content']) &&
                entry.payload['content']['speaker'] === 'assistant',
            )
            .map(contentPreview)
            .join(' '),
        );
  if (acceptedTerms.size > 0)
    addTermCounts(refusedTerms, acceptedTerms, counts);
  updateCounts(list, counts);
  writeRunFields(
    run,
    list,
    context,
    dumps,
    acceptedPair,
    recovered,
    authorProvider,
    authorModel,
    refusedTerms,
    acceptedTerms,
  );
}

function writeRunFields(
  run: Run,
  list: Attempt[],
  context: Context,
  dumps: Map<string, DumpIndexEntry>,
  pair: [string, Obj] | undefined,
  recovered: boolean,
  authorProvider: string | null,
  authorModel: string | null,
  refusedTerms: Set<string>,
  acceptedTerms: Set<string>,
): void {
  const first = list[0]!;
  run['category'] = first.category;
  run['model'] = first.model;
  run['contextTokens'] = first.contextTokens;
  run['refusalAttempts'] = list.length;
  run['legacySuspect'] = list.some((attempt) => attempt.legacy);
  run['attempts'] = list.map((attempt) => ({
    time: attempt.ts,
    model: attempt.model,
    category: attempt.category,
    outcome: attempt.outcome,
    attemptIndex: attempt.attemptIndex,
    requestId: str(attempt.raw['request_id']),
    dumpBaseId: attempt.dumpBaseId,
  }));
  run['entriesSinceCompression'] = context.lastCompression
    ? context.contentSince.length
    : null;
  run['compression'] = context.lastCompression?.ts ?? null;
  run['summaryAuthor'] = summaryAuthor(authorProvider, authorModel);
  run['newestEntriesBeforeRefusal'] = context.before
    .slice(-5)
    .map(contentPreview);
  run['partialOutput'] = context.prior?.payload['partial_output'] ?? null;
  run['recovery'] = recoveryStatus(recovered, context.rewritten);
  run['dumpPairs'] = list
    .filter((attempt) => attempt.dumpBaseId !== null)
    .map((attempt) => ({
      promptId: first.prompt,
      refused: attempt.dumpBaseId,
      refusedPresent: dumps.has(attempt.dumpBaseId!),
      accepted: pair?.[0] ?? null,
      acceptedPresent: pair !== undefined,
    }));
  run['overrepresentedTerms'] = [...refusedTerms]
    .filter((term) => !acceptedTerms.has(term))
    .sort()
    .slice(0, 20);
}

async function survey(options: ReturnType<typeof argumentsFrom>): Promise<Obj> {
  const malformed: Malformed = { count: 0, examples: [] };

  const evidence = await collectEvidence(options, malformed);
  const runs = groupRuns(evidence.attempts);
  const dumps = readDumpIndex(options.cache, () => malformed.count++);
  const counts: Counts = {
    categories: {},
    models: {},
    projects: {},
    terms: new Map(),
  };
  for (const run of runs) decorateRun(run, evidence.journals, dumps, counts);
  const compression = compressionCounts(evidence.calls, evidence.journals);
  const termContrasts = [...counts.terms.entries()]
    .map(([term, value]) => ({
      term,
      ...value,
      logRatio: Math.log((value.refused + 1) / (value.accepted + 1)),
    }))
    .filter((row) => row.logRatio > 0)
    .sort((a, b) => b.logRatio - a.logRatio || a.term.localeCompare(b.term))
    .slice(0, 50);
  return {
    filters: {
      since:
        options.since === null ? null : new Date(options.since).toISOString(),
      project: options.project,
    },
    runs,
    summary: {
      refusalAttempts: evidence.attempts.length,
      runs: runs.length,
      definite: evidence.attempts.filter((attempt) => !attempt.legacy).length,
      suspected: evidence.attempts.filter((attempt) => attempt.legacy).length,
      models: counts.models,
      categories: counts.categories,
      projects: counts.projects,
      compression: compression.counts,
      joins: compression.joins,
      termContrasts,
    },
    diagnostics: {
      malformedLines: malformed.count,
      malformedExamples: malformed.examples,
    },
  };
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const options = argumentsFrom(argv);
  const report = await survey(options);
  const text = formatRefusalSurvey(report);
  if (options.json === '-') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
    if (options.json) {
      fs.mkdirSync(path.dirname(path.resolve(options.json)), {
        recursive: true,
      });
      fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
