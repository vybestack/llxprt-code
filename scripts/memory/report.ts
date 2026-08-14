/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renders a growth report from recorded JSC samples.
 *
 *   npm run mem:report                  # most recent run
 *   npm run mem:report -- <path|dir>    # a specific samples.jsonl or run dir
 *
 * The per-object-class delta is the diagnostic signal: a class whose count
 * climbs turn over turn is a retention candidate. The report presents observed
 * growth without attributing any single class to a specific owner, because the
 * same histogram entry can be retained by unrelated code.
 *
 * HONESTY ABOUT TRUNCATION
 * Each sample records only the top object-type entries (see DEFAULT_TOP_TYPES
 * in sample.ts). A type absent from a sample's histogram is not necessarily
 * absent from the heap — it may simply have fallen below the cutoff. The
 * report therefore only compares types present in BOTH endpoint samples, and
 * calls out that absence is inconclusive rather than zero. It never claims the
 * object graph is flat: when no comparable type increased, it reports exactly
 * that measured fact, with the truncation caveat where it applies.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TOP_TYPES, type Sample, parseSamples } from './sample.ts';
import { MEMPROFILE_DIR_NAME, resolveSamplesPath } from './paths.ts';

const MB = 1024 * 1024;

export const REPORT_USAGE = `Usage: npm run mem:report -- [path]

  (default)   analyze the most recent .memprofile run
  <path>      a specific samples.jsonl file or a run directory containing one
  -h, --help  print this help

Unknown options and extra arguments are rejected.`;

export class ReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportParseError';
  }
}

export interface ReportCliOptions {
  readonly help: boolean;
  readonly target: string | undefined;
}

/**
 * Parses report CLI argv: at most one positional target, help flags, and
 * nothing else. Unknown options, flag-shaped targets, or extra arguments
 * fail fast. Exported for testing.
 */
export function parseReportArgs(argv: readonly string[]): ReportCliOptions {
  let help = false;
  let target: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new ReportParseError(
        `unknown option: ${arg}. ${REPORT_USAGE.split('\n')[0]}`,
      );
    } else if (target !== undefined) {
      throw new ReportParseError(`unexpected extra argument: ${arg}`);
    } else {
      target = arg;
      i += 1;
    }
  }
  return { help, target };
}

function fmtMb(bytes: number): string {
  return (bytes / MB).toFixed(1).padStart(10);
}

function rateLabel(deltaPerMinute: number, unit: string): string {
  const sign = deltaPerMinute >= 0 ? '+' : '';
  return `${sign}${deltaPerMinute.toFixed(1)} ${unit}/min`;
}

function renderHeader(samples: readonly Sample[]): string {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const minutes = Math.max(
    (Date.parse(last.t) - Date.parse(first.t)) / 60_000,
    1 / 60,
  );
  return `${samples.length} samples over ${minutes.toFixed(1)} min (pid ${first.pid})`;
}

function renderTable(samples: readonly Sample[]): string[] {
  const lines: string[] = [
    '  time      tag              heapMB     extraMB       rssMB      objects',
  ];
  for (const s of samples) {
    lines.push(
      `  ${s.t.slice(11, 19)}  ${s.tag.padEnd(14)}${fmtMb(s.heapSize)}` +
        `${fmtMb(s.extraMemorySize)}${fmtMb(s.rss)}  ${s.objectCount
          .toLocaleString('en-US')
          .padStart(11)}`,
    );
  }
  return lines;
}

function renderTrend(samples: readonly Sample[]): string[] {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const minutes = Math.max(
    (Date.parse(last.t) - Date.parse(first.t)) / 60_000,
    1 / 60,
  );
  const heapRate = (last.heapSize - first.heapSize) / MB / minutes;
  const rssRate = (last.rss - first.rss) / MB / minutes;
  return [
    ``,
    `  heap ${(first.heapSize / MB).toFixed(1)} -> ${(last.heapSize / MB).toFixed(1)} MB   (${rateLabel(heapRate, 'MB')})`,
    `  rss  ${(first.rss / MB).toFixed(1)} -> ${(last.rss / MB).toFixed(1)} MB   (${rateLabel(rssRate, 'MB')})`,
  ];
}

function renderNotes(samples: readonly Sample[]): string[] {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const lines: string[] = [];
  if (last.extraMemorySize > last.heapSize) {
    lines.push(
      '  NOTE: extraMemorySize exceeds heapSize. These are separate, potentially\n' +
        '        overlapping JSC accounting signals; inspect both trends, but do\n' +
        '        not add the counters together.',
    );
  }
  if (
    first.protectedObjectCount === 0
      ? last.protectedObjectCount > 0
      : last.protectedObjectCount > first.protectedObjectCount * 2
  ) {
    lines.push(
      `  NOTE: protectedObjectCount ${first.protectedObjectCount.toLocaleString('en-US')} -> ` +
        `${last.protectedObjectCount.toLocaleString('en-US')}. Something native is holding JS objects alive.`,
    );
  }
  return lines;
}

/**
 * True when a sample's type histogram was capped at the top-N cutoff and may
 * therefore be missing entries. An array shorter than the cutoff contains
 * every type in the heap; one at exactly the cutoff may have dropped ties.
 */
function isPossiblyTruncated(sample: Sample): boolean {
  return sample.types.length >= DEFAULT_TOP_TYPES;
}

/** True when any endpoint sample may be missing type entries. */
function typesMayBeTruncated(samples: readonly Sample[]): boolean {
  return (
    isPossiblyTruncated(samples[0]) ||
    isPossiblyTruncated(samples[samples.length - 1])
  );
}

interface GrewClass {
  readonly type: string;
  readonly count: number;
  readonly delta: number;
}

function grewClasses(samples: readonly Sample[]): GrewClass[] {
  const firstTypes = new Map(samples[0].types);
  const last = samples[samples.length - 1];
  const grew: GrewClass[] = [];
  // Only types present in BOTH endpoint histograms have a reliable baseline;
  // a type missing from the first sample's truncated top list may have had a
  // nonzero count, so its absence must not be read as "grew from zero".
  for (const [type, count] of last.types) {
    const baseline = firstTypes.get(type);
    if (baseline === undefined) {
      continue;
    }
    const delta = count - baseline;
    if (delta > 0) {
      grew.push({ type, count, delta });
    }
  }
  grew.sort((a, b) => b.delta - a.delta);
  return grew;
}

function renderClasses(samples: readonly Sample[]): string[] {
  const grew = grewClasses(samples).slice(0, 15);
  const truncated = typesMayBeTruncated(samples);
  const lines: string[] = ['', '  Object classes that grew:'];
  if (grew.length === 0) {
    lines.push(
      '    (no object type increased between the endpoint samples among',
      '     the types carried across both)',
    );
    if (truncated) {
      lines.push(
        '     INCONCLUSIVE: per-sample histograms are truncated to the',
        `     top ${DEFAULT_TOP_TYPES} types, so growth in unseen types cannot be ruled out`,
      );
    }
    return lines;
  }
  for (const entry of grew) {
    lines.push(
      `    ${entry.type.padEnd(30)} +${entry.delta
        .toLocaleString('en-US')
        .padStart(12)}   (now ${entry.count.toLocaleString('en-US')})`,
    );
  }
  if (truncated) {
    lines.push(
      '',
      `    Types absent from either endpoint's top ${DEFAULT_TOP_TYPES} are not`,
      '    reported: absence from a truncated histogram is inconclusive, not zero.',
    );
  }
  return lines;
}

/**
 * Renders the full report text for a list of samples. Pure (no I/O) so it can
 * be exercised directly by tests against synthetic samples.
 */
export function renderReport(samples: readonly Sample[]): string {
  if (samples.length < 2) {
    return `Only ${samples.length} sample(s) — the session was too short to show a trend. Run longer, or lower --interval.`;
  }
  const blocks = [
    renderHeader(samples),
    '',
    ...renderTable(samples),
    ...renderTrend(samples),
    ...renderNotes(samples),
    ...renderClasses(samples),
    '',
    '  These are observed counts, not ownership proofs: a class that grows is a\n' +
      '  retention candidate to investigate, not a conclusion about who retains it.\n' +
      '  heapSize and extraMemorySize are reported separately and never summed,\n' +
      '  because extraMemorySize already overlaps heapSize for natively-held data.',
  ];
  return blocks.join('\n');
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function loadSamples(path: string): Sample[] {
  if (!existsSync(path)) {
    throw new Error(`No samples at ${path}`);
  }
  return parseSamples(readFileSync(path, 'utf8'));
}

function main(): void {
  const options = parseReportArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${REPORT_USAGE}\n`);
    return;
  }
  const samplesPath = resolveSamplesPath({
    explicit: options.target,
    memprofileRoot: join(repoRoot(), MEMPROFILE_DIR_NAME),
  });
  const samples = loadSamples(samplesPath);
  process.stdout.write(`${renderReport(samples)}\n`);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    if (error instanceof ReportParseError) {
      process.stderr.write(`${error.message}\n\n${REPORT_USAGE}\n`);
      process.exit(2);
    }
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
