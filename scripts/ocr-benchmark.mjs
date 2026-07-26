#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OCR benchmark / experiment harness (Phase 3, issue #2649).
 *
 * Runs `ocr review` across a fixed set of git ranges with controlled
 * variables (OCR version, model, rules, concurrency) and records
 * quality, completeness, reliability, token, and duration outcomes
 * to a machine-readable results file.
 *
 * This script does NOT run inside CI. It is a local developer tool
 * that requires:
 *   - `ocr` on PATH (npm install -g @alibaba-group/open-code-review)
 *   - Git access to the repository
 *   - OCR_LLM_URL, OCR_LLM_TOKEN, OCR_LLM_MODEL env vars (or a
 *     ~/.opencodereview/config.json)
 *
 * Usage:
 *   node scripts/ocr-benchmark.mjs --from SHA1 --to SHA2 \
 *     --concurrency 2,4,8 --label "canary-v1.7.15"
 *
 * The --concurrency flag accepts a comma-separated list so a single
 * invocation can sweep multiple values. Each concurrency value is a
 * separate experiment; only one variable changes at a time per the
 * issue's controlled-experiment requirement.
 *
 * Output: ocr-benchmark-results.json in the current directory.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  if (idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getArgList(name) {
  const val = getArg(name);
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const fromSha = getArg('from');
const toSha = getArg('to');
const label = getArg('label') || 'unspecified';
const rawConcurrency = getArgList('concurrency');
const reviewTimeoutRaw = getArg('timeout') || '20';
const outputArg = getArg('output') || 'ocr-benchmark-results.json';
const outputFile = resolve(outputArg);
const processTimeoutMsRaw = getArg('process-timeout-ms');
const processTimeoutMsNum = Number(processTimeoutMsRaw);
const processTimeoutMs =
  processTimeoutMsRaw &&
  Number.isInteger(processTimeoutMsNum) &&
  processTimeoutMsNum > 0
    ? processTimeoutMsNum
    : 3600000;

if (!fromSha || !toSha) {
  process.stderr.write(
    'Usage: node scripts/ocr-benchmark.mjs --from SHA1 --to SHA2 ' +
      '--concurrency 2,4,8 [--label NAME] [--timeout 20] [--output FILE]\n',
  );
  process.exit(1);
}

// Validate the review timeout as a positive integer, consistent with
// concurrency validation. A non-numeric, zero, or negative value would
// produce an invalid OCR CLI argument.
const reviewTimeoutNum = Number(reviewTimeoutRaw);
if (!Number.isInteger(reviewTimeoutNum) || reviewTimeoutNum <= 0) {
  process.stderr.write(
    `Invalid --timeout value '${reviewTimeoutRaw}': must be a positive integer.\n`,
  );
  process.exit(1);
}
const reviewTimeout = String(reviewTimeoutNum);

// Phase 3 (deepthinker #10): validate concurrency values immediately and
// reject malformed input rather than silently defaulting. Convert to
// numbers so output types are consistent.
const concurrencyValues = [];
if (rawConcurrency.length > 0) {
  for (const raw of rawConcurrency) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      process.stderr.write(
        `Invalid concurrency value '${raw}': must be a positive integer.\n`,
      );
      process.exit(1);
    }
    concurrencyValues.push(n);
  }
  // Reject duplicates that would waste expensive OCR runs.
  const unique = new Set(concurrencyValues);
  if (unique.size !== concurrencyValues.length) {
    process.stderr.write('Duplicate concurrency values are not allowed.\n');
    process.exit(1);
  }
}
if (concurrencyValues.length === 0) {
  concurrencyValues.push(2, 4, 8);
}

// Phase 3 (deepthinker #6): record the actual OCR model. If the model
// cannot be determined, abort rather than recording 'unknown' and running
// experiments with an uncontrolled variable. This check runs BEFORE
// resolving refs so a missing model fails fast without spawning git.
const ocrModel = process.env.OCR_LLM_MODEL || '';
if (!ocrModel) {
  process.stderr.write(
    'OCR_LLM_MODEL is not set. Cannot record the controlled model ' +
      'identity. Set it before running experiments.\n',
  );
  process.exit(1);
}
if (!process.env.OCR_LLM_URL) {
  process.stderr.write(
    'OCR_LLM_URL is not set. The ocr review CLI requires it to connect to the provider.\n',
  );
  process.exit(1);
}
if (!process.env.OCR_LLM_TOKEN) {
  process.stderr.write(
    'OCR_LLM_TOKEN is not set. The ocr review CLI requires it for authentication.\n',
  );
  process.exit(1);
}

// Phase 3 (deepthinker #6): resolve refs to immutable commit IDs so branch
// movements between experiments cannot silently change the range.
function resolveRef(ref) {
  try {
    return execFileSync('git', ['rev-parse', `${ref}^{commit}`], {
      encoding: 'utf8',
    }).trim();
  } catch {
    process.stderr.write(
      `Could not resolve git ref '${ref}'. Aborting before any experiments run.\n`,
    );
    process.exit(1);
    return ref; // unreachable — satisfies consistent-return
  }
}

const fromResolved = resolveRef(fromSha);
const toResolved = resolveRef(toSha);

// Guard against identical refs: an empty range would waste OCR compute
// and tokens while still recording a 'successful' experiment.
if (fromResolved === toResolved) {
  process.stderr.write(
    `Invalid git range: from and to resolve to the same commit (${fromResolved}). The benchmark requires a non-empty forward range.\n`,
  );
  process.exit(1);
}

// Phase 3 (OCR finding): validate that 'from' is an ancestor of 'to' so the
// git range is well-formed. An invalid range would produce empty diffs or
// cross-branch noise, undermining the controlled-experiment design.
try {
  execFileSync(
    'git',
    ['merge-base', '--is-ancestor', fromResolved, toResolved],
    {
      encoding: 'utf8',
      stdio: 'ignore',
    },
  );
} catch {
  process.stderr.write(
    `Invalid git range: '${fromSha}' (${fromResolved}) is not an ancestor of '${toSha}' (${toResolved}). The benchmark requires a forward merge-base-to-head range.
`,
  );
  process.exit(1);
}

const ocrVersion = (() => {
  try {
    return execFileSync('ocr', ['version'], { encoding: 'utf8' }).trim();
  } catch {
    process.stderr.write('Could not determine OCR version. Is ocr on PATH?\n');
    process.exit(1);
    return 'unknown'; // unreachable — satisfies consistent-return
  }
})();

// Phase 3 (deepthinker #6): hash the OCR rules file so experiments can be
// compared across runs. Unlike a missing model, a missing rules file means
// OCR would use its built-in defaults — an uncontrolled variable for a
// benchmark. Fail fast so the operator fixes the environment before spending
// tokens on incomparable runs.
const rulesHash = (() => {
  const homeDir = process.env.HOME;
  if (!homeDir) {
    process.stderr.write(
      'HOME environment variable is not set. Cannot locate ~/.opencodereview/rule.json. Set HOME or run on a platform with a home directory.\n',
    );
    process.exit(1);
    return ''; // unreachable — satisfies consistent-return
  }
  const rulesPath = homeDir + '/.opencodereview/rule.json';
  if (!existsSync(rulesPath)) {
    process.stderr.write(
      `OCR rules file not found at ${rulesPath}. Reproducible benchmarks require a committed rules file. Run the OCR workflow once or copy the trusted rule.json into place.
`,
    );
    process.exit(1);
    return ''; // unreachable — satisfies consistent-return
  }
  try {
    const content = readFileSync(rulesPath, 'utf8');
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch (err) {
    process.stderr.write(
      `Could not read OCR rules file at ${rulesPath}: ${err.message}
`,
    );
    process.exit(1);
    return ''; // unreachable — satisfies consistent-return
  }
})();

function gitDiffStat(from, to) {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${from}..${to}`],
      { encoding: 'utf8' },
    );
    const files = output.trim().split('\n').filter(Boolean);
    const numstat = execFileSync(
      'git',
      ['diff', '--numstat', '--diff-filter=ACMRTUXB', `${from}..${to}`],
      { encoding: 'utf8' },
    );
    let additions = 0;
    let deletions = 0;
    for (const line of numstat.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        additions += parts[0] === '-' ? 0 : Number(parts[0]) || 0;
        deletions += parts[1] === '-' ? 0 : Number(parts[1]) || 0;
      }
    }
    return {
      files: files.length,
      paths: files,
      additions,
      deletions,
      lines: { additions, deletions, total: additions + deletions },
    };
  } catch {
    process.stderr.write(
      `Warning: git diff statistics failed for range ${from}..${to}. Scope data for this experiment may be unreliable.
`,
    );
    return {
      files: 0,
      paths: [],
      additions: 0,
      deletions: 0,
      lines: { additions: 0, deletions: 0, total: 0 },
    };
  }
}

// Phase 3 (deepthinker #7): parse the OCR output envelope faithfully,
// distinguishing empty/malformed output from a genuine zero-finding run.
function parseOcrOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      parseStatus: 'empty',
      findings: [],
      tokens: {},
      completedFiles: 0,
      selectedFiles: 0,
      warnings: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      parseStatus: 'malformed',
      findings: [],
      tokens: {},
      completedFiles: 0,
      selectedFiles: 0,
      warnings: [],
    };
  }
  let findings;
  if (Array.isArray(parsed)) {
    findings = parsed;
  } else if (parsed && Array.isArray(parsed.comments)) {
    findings = parsed.comments;
  } else {
    return {
      parseStatus: 'unsupported-envelope',
      findings: [],
      tokens: {},
      completedFiles: 0,
      selectedFiles: 0,
      warnings: [],
    };
  }
  const summary = parsed?.summary || parsed?.usage || {};
  const tokens = {
    input: summary.input_tokens || summary.input || 0,
    output: summary.output_tokens || summary.output || 0,
    cache: summary.cache_tokens || summary.cache || 0,
    total: summary.total_tokens || summary.total || 0,
  };
  const warnings = Array.isArray(parsed?.warnings)
    ? parsed.warnings.map((w) => redact(String(w)))
    : [];
  const completedFiles = summary.files_reviewed?.completed || 0;
  const selectedFiles = summary.files_reviewed?.selected || 0;
  return {
    parseStatus: 'ok',
    findings,
    tokens,
    completedFiles,
    selectedFiles,
    warnings,
  };
}

// Phase 3 (deepthinker #11): redact secrets from error messages and any
// persisted stdout/stderr before writing results.
const SECRET_PATTERNS = [
  process.env.OCR_LLM_TOKEN,
  process.env.OCR_LLM_URL,
].filter((s) => typeof s === 'string' && s.length > 0);

function redact(value) {
  let sanitized = String(value ?? '');
  for (const secret of SECRET_PATTERNS) {
    if (secret) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
    }
  }
  return sanitized
    .replace(
      /\b(Authorization\s*:\s*(?:(?:Bearer|Basic|token|ApiKey)\s+)?)([^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(x-api-key\s*:\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b(api[_-]?key\s*[=:]\s*)([^\s,;&]+)/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|api[_-]?key|token)=)([^\s,;&]+)/gi, '$1[REDACTED]')
    .replace(/\b(token\s*[=:]\s*)([A-Za-z0-9_./+=:@-]{16,})/gi, '$1[REDACTED]')
    .replace(
      /\b(secret\s*[=:]\s*)([A-Za-z0-9_./+=:@-]{16,})/gi,
      '$1[REDACTED]',
    );
}

function runOcrReview(from, to, concurrency) {
  const startTime = Date.now();
  const env = { ...process.env, NO_COLOR: '1', OCR_NO_UPDATE: '1' };
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let timedOut = false;
  try {
    stdout = execFileSync(
      'ocr',
      [
        'review',
        '--from',
        from,
        '--to',
        to,
        '--format',
        'json',
        '--audience',
        'agent',
        '--timeout',
        String(reviewTimeout),
        '--concurrency',
        String(concurrency),
      ],
      {
        encoding: 'utf8',
        env,
        timeout: processTimeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (err) {
    exitCode = err.status || 1;
    timedOut = err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';
    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      stderr = `OCR review output exceeded the 64MB maxBuffer. This indicates an abnormally large review payload. Narrow the git range or increase maxBuffer in the harness.
`;
      stdout = typeof err.stdout === 'string' ? err.stdout : '';
    } else {
      stdout = typeof err.stdout === 'string' ? err.stdout : '';
      stderr =
        typeof err.stderr === 'string'
          ? err.stderr
          : String(err.message || err);
    }
  }
  const elapsed = Date.now() - startTime;
  const parsed = parseOcrOutput(stdout);
  return {
    exitCode,
    timedOut,
    elapsed,
    parseStatus: parsed.parseStatus,
    findingCount: parsed.findings.length,
    findings: parsed.findings.map((f) => {
      if (typeof f === 'string') {
        return redact(f);
      }
      if (f && typeof f === 'object') {
        return JSON.parse(redact(JSON.stringify(f)));
      }
      return f;
    }),
    tokens: parsed.tokens,
    completedFiles: parsed.completedFiles,
    selectedFiles: parsed.selectedFiles,
    warnings: parsed.warnings,
    stdoutSize: stdout.length,
    stderr: redact(stderr),
    error: exitCode === 0 ? null : redact(stderr || 'OCR review failed'),
  };
}

const cumulativeScope = gitDiffStat(fromResolved, toResolved);
const experiments = [];

for (const concurrency of concurrencyValues) {
  process.stderr.write(
    `Running benchmark: concurrency=${concurrency} label=${label} ocr=${ocrVersion}\n`,
  );
  const result = runOcrReview(fromResolved, toResolved, concurrency);
  experiments.push({
    label,
    timestamp: new Date().toISOString(),
    ocr_version: ocrVersion,
    ocr_model: ocrModel,
    rules_hash: rulesHash,
    concurrency,
    from_sha: fromResolved,
    to_sha: toResolved,
    cumulative_files: cumulativeScope.files,
    cumulative_lines: cumulativeScope.lines,
    finding_count: result.findingCount,
    findings: result.findings,
    completed_files: result.completedFiles,
    selected_files: result.selectedFiles,
    elapsed_ms: result.elapsed,
    timed_out: result.timedOut,
    parse_status: result.parseStatus,
    tokens: result.tokens,
    warnings: result.warnings,
    exit_code: result.exitCode,
    stderr: result.stderr,
    error: result.error,
  });
}

const resultsPayload = {
  schema: 1,
  generated_at: new Date().toISOString(),
  label,
  cumulative_scope: cumulativeScope,
  experiments,
};

const outputDir = dirname(outputFile);
try {
  mkdirSync(outputDir, { recursive: true });
} catch (err) {
  process.stderr.write(
    `Could not create output directory ${outputDir}: ${err.message}\n`,
  );
  process.exit(1);
}

writeFileSync(outputFile, JSON.stringify(resultsPayload, null, 2) + '\n');
process.stderr.write(`Results written to ${outputFile}\n`);
process.stdout.write(
  JSON.stringify({ experiments: experiments.length, label, outputFile }) + '\n',
);
