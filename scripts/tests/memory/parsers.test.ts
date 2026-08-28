/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fail-fast parsing tests for the request CLI and the heap analyzer
 * (issue #3230): unknown options, missing values, flag-shaped values, and
 * nonfinite/nonpositive numbers must all be rejected with a clear error
 * rather than silently falling back to a default.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RequestCliParseError,
  parseRequestArgs,
  runRequestCli,
} from '../../memory/request-cli.ts';
import { writeDoneMarker } from '../../memory/request.ts';
import {
  AnalyzerParseError,
  DEFAULT_ANALYZE_OPTIONS,
  parseAnalyzeArgs,
} from '../../memory/heapanalyze.ts';
import {
  type CapturedProcessResult,
  spawnSyncWithFileCapture,
} from './sync-process.ts';

describe('parseRequestArgs — recognized options', () => {
  it('defaults to a nonblocking sample request', () => {
    expect(parseRequestArgs([])).toEqual({
      kind: 'sample',
      dir: undefined,
      wait: false,
    });
  });

  it('parses --heap as a snapshot request', () => {
    expect(parseRequestArgs(['--heap'])).toEqual({
      kind: 'snapshot',
      dir: undefined,
      wait: false,
    });
  });

  it('parses --dir with a value', () => {
    expect(parseRequestArgs(['--dir', '/runs/run-1'])).toEqual({
      kind: 'sample',
      dir: '/runs/run-1',
      wait: false,
    });
  });

  it('parses heap, directory, and durable completion waiting together', () => {
    expect(
      parseRequestArgs(['--heap', '--dir', 'C:\\runs\\run-2', '--wait']),
    ).toEqual({
      kind: 'snapshot',
      dir: 'C:\\runs\\run-2',
      wait: true,
    });
  });
});

describe('parseRequestArgs — fail fast', () => {
  it('rejects an unknown option', () => {
    expect(() => parseRequestArgs(['--verbose'])).toThrow(RequestCliParseError);
    expect(() => parseRequestArgs(['--verbose'])).toThrow(
      /unknown option: --verbose/,
    );
  });

  it('rejects a positional argument', () => {
    expect(() => parseRequestArgs(['extra'])).toThrow(/unknown option/);
  });

  it('rejects a missing --dir value', () => {
    expect(() => parseRequestArgs(['--dir'])).toThrow(
      /missing value for --dir/,
    );
  });

  it('rejects a flag-shaped --dir value', () => {
    expect(() => parseRequestArgs(['--dir', '--heap'])).toThrow(
      /invalid value for --dir/,
    );
  });

  it('rejects -- (nothing to pass through)', () => {
    expect(() => parseRequestArgs(['--', 'x'])).toThrow(
      /no positional arguments/,
    );
  });
});

describe('parseAnalyzeArgs — recognized options', () => {
  it('parses a bare file with defaults', () => {
    const options = parseAnalyzeArgs(['snap.heapsnapshot']);
    expect(options.file).toBe('snap.heapsnapshot');
    expect(options.top).toBe(DEFAULT_ANALYZE_OPTIONS.top);
    expect(options.minBytes).toBe(0.5 * 1024 * 1024);
  });

  it('parses --top and --min-mb', () => {
    const options = parseAnalyzeArgs([
      'snap.heapsnapshot',
      '--top',
      '5',
      '--min-mb',
      '2',
    ]);
    expect(options.file).toBe('snap.heapsnapshot');
    expect(options.top).toBe(5);
    expect(options.minBytes).toBe(2 * 1024 * 1024);
  });

  it('accepts a fractional --min-mb', () => {
    const options = parseAnalyzeArgs(['s.heapsnapshot', '--min-mb', '0.25']);
    expect(options.minBytes).toBe(0.25 * 1024 * 1024);
  });
});

describe('parseAnalyzeArgs — fail fast', () => {
  it('rejects a missing file argument', () => {
    expect(() => parseAnalyzeArgs([])).toThrow(AnalyzerParseError);
    expect(() => parseAnalyzeArgs([])).toThrow(/missing snapshot file/);
  });

  it('rejects two positional file arguments', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', 'b.heapsnapshot']),
    ).toThrow(/unexpected extra argument/);
  });

  it('rejects an unknown option', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--depth', '4'])).toThrow(
      /unknown option: --depth/,
    );
  });

  it('rejects a missing --top value', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top'])).toThrow(
      /missing value for --top/,
    );
  });

  it('rejects a flag-shaped --top value', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--top', '--min-mb']),
    ).toThrow(/invalid value for --top/);
  });

  it('rejects a nonpositive --top', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top', '0'])).toThrow(
      /invalid value for --top/,
    );
  });

  it('rejects a nonfinite --top', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--top', 'Infinity']),
    ).toThrow(/invalid value for --top/);
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top', 'NaN'])).toThrow(
      /invalid value for --top/,
    );
  });

  it('rejects a non-integer --top', () => {
    expect(() => parseAnalyzeArgs(['a.heapsnapshot', '--top', '2.5'])).toThrow(
      /invalid value for --top/,
    );
  });

  it('rejects a nonpositive --min-mb', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--min-mb', '-1']),
    ).toThrow(/invalid value for --min-mb/);
  });

  it('rejects a non-numeric --min-mb', () => {
    expect(() =>
      parseAnalyzeArgs(['a.heapsnapshot', '--min-mb', 'large']),
    ).toThrow(/invalid value for --min-mb/);
  });
});

interface UtilityFixture {
  readonly root: string;
  readonly sourceRoot: string;
  readonly installedDataRoot: string;
  readonly sourceRequest: string;
  readonly sourceReport: string;
  readonly sourceAnalyze: string;
  readonly installedRequest: string;
  readonly installedReport: string;
  readonly installedAnalyze: string;
}

const parserTestFile = fileURLToPath(import.meta.url);
const parserRepoRoot = resolve(parserTestFile, '..', '..', '..', '..');

async function buildUtilityEntry(
  entrypoint: string,
  outdir: string,
  naming: string,
): Promise<string> {
  mkdirSync(outdir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    naming,
    target: 'bun',
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join('\n'));
  }
  return join(outdir, naming);
}

function utilityEnvironment(dataRoot: string): NodeJS.ProcessEnv {
  const { DEV: _dev, NODE_OPTIONS: _nodeOptions, ...environment } = process.env;
  return { ...environment, LLXPRT_DATA_HOME: dataRoot };
}

function prepareRun(memprofileRoot: string, name: string, pid: number): string {
  const runDir = join(memprofileRoot, name);
  mkdirSync(join(runDir, 'requests'), { recursive: true });
  writeFileSync(
    join(runDir, 'probe.lease'),
    JSON.stringify({ owner: 'test-owner', pid, heartbeatAt: Date.now() }),
  );
  mkdirSync(memprofileRoot, { recursive: true });
  writeFileSync(join(memprofileRoot, 'latest'), runDir);
  return runDir;
}

function writeSamples(runDir: string, pid: number): void {
  const sample = (tag: string, timestamp: string, heapSize: number): string =>
    JSON.stringify({
      t: timestamp,
      tag,
      pid,
      rss: heapSize * 2,
      heapSize,
      heapCapacity: heapSize,
      extraMemorySize: 0,
      objectCount: heapSize,
      protectedObjectCount: 0,
      types: [['Object', heapSize]],
    });
  writeFileSync(
    join(runDir, 'samples.jsonl'),
    `${sample('startup', '2026-08-27T10:00:00.000Z', 100)}\n${sample(
      'exit',
      '2026-08-27T10:01:00.000Z',
      200,
    )}\n`,
  );
}

describe('request completion waiting', () => {
  it('reports durable processing without claiming the requested action succeeded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-request-wait-'));
    const runDir = prepareRun(root, 'run', process.pid);
    const output: string[] = [];
    const stdoutWrite = spyOn(process.stdout, 'write').mockImplementation(
      (chunk) => {
        output.push(String(chunk));
        return true;
      },
    );
    const completionPoll = setInterval(() => {
      for (const name of readdirSync(join(runDir, 'requests'))) {
        if (name.endsWith('.json')) {
          writeDoneMarker(runDir, name.slice(0, -'.json'.length), process.pid);
        }
      }
    }, 5);

    try {
      await runRequestCli({
        usage: 'test usage',
        memprofileRoot: root,
        argv: ['--dir', runDir, '--wait'],
        waitTimeoutMs: 1_000,
        waitPollMs: 5,
      });
      expect(readdirSync(join(runDir, 'requests', 'done'))).toHaveLength(1);
      expect(output.join('\n')).toContain('Probe processed request');
      expect(output.join('\n')).toContain('probe.log');
      expect(output.join('\n')).not.toContain('Probe completed');
    } finally {
      clearInterval(completionPoll);
      stdoutWrite.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails after the bounded wait when no completion marker arrives', async () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-request-timeout-'));
    const runDir = prepareRun(root, 'run', process.pid);

    try {
      await expect(
        runRequestCli({
          usage: 'test usage',
          memprofileRoot: root,
          argv: ['--dir', runDir, '--wait'],
          waitTimeoutMs: 20,
          waitPollMs: 5,
        }),
      ).rejects.toThrow('timed out waiting for probe completion of request');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function runUtility(
  entry: string,
  argv: readonly string[],
  dataRoot: string,
): CapturedProcessResult {
  const entryDirectory = resolve(entry, '..');
  return spawnSyncWithFileCapture(
    entryDirectory,
    process.execPath,
    [entry, ...argv],
    {
      cwd: entryDirectory,
      env: utilityEnvironment(dataRoot),
    },
  );
}

describe('source and installed memprofile utility entries', () => {
  let fixture: UtilityFixture | undefined;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'memprofile-utilities-'));
    const sourceOut = join(root, 'scripts', 'memory');
    const installedOut = join(root, 'bundle');
    const sourceRequest = await buildUtilityEntry(
      join(parserRepoRoot, 'scripts/memory/request-cli.ts'),
      sourceOut,
      'request-cli.js',
    );
    const sourceReport = await buildUtilityEntry(
      join(parserRepoRoot, 'scripts/memory/report.ts'),
      sourceOut,
      'report.js',
    );
    const sourceAnalyze = await buildUtilityEntry(
      join(parserRepoRoot, 'scripts/memory/heapanalyze.ts'),
      sourceOut,
      'heapanalyze.js',
    );
    const installedRequest = await buildUtilityEntry(
      join(parserRepoRoot, 'scripts/memory/installed-request.ts'),
      installedOut,
      'memprofile-request.js',
    );
    const installedReport = await buildUtilityEntry(
      join(parserRepoRoot, 'scripts/memory/installed-report.ts'),
      installedOut,
      'memprofile-report.js',
    );
    const installedAnalyze = await buildUtilityEntry(
      join(parserRepoRoot, 'scripts/memory/installed-analyze.ts'),
      installedOut,
      'memprofile-analyze.js',
    );
    fixture = {
      root,
      sourceRoot: join(root, '.memprofile'),
      installedDataRoot: join(root, 'user-data'),
      sourceRequest,
      sourceReport,
      sourceAnalyze,
      installedRequest,
      installedReport,
      installedAnalyze,
    };
  });

  beforeEach(() => {
    if (fixture !== undefined) {
      rmSync(fixture.sourceRoot, { recursive: true, force: true });
      rmSync(fixture.installedDataRoot, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fixture !== undefined) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  function getFixture(): UtilityFixture {
    if (fixture === undefined) {
      throw new Error('Utility fixture was not initialized');
    }
    return fixture;
  }

  it('queues requests under the repository root for source and the user data root for installed', () => {
    const current = getFixture();
    const sourceRun = prepareRun(current.sourceRoot, 'source-run', 111);
    const installedRoot = join(current.installedDataRoot, 'memprofile');
    const installedRun = prepareRun(installedRoot, 'installed-run', 222);

    const source = runUtility(
      current.sourceRequest,
      [],
      current.installedDataRoot,
    );
    const installed = runUtility(
      current.installedRequest,
      [],
      current.installedDataRoot,
    );

    expect(source.status, source.stderr).toBe(0);
    expect(installed.status, installed.stderr).toBe(0);
    expect(
      readdirSync(join(sourceRun, 'requests')).filter((name) =>
        name.endsWith('.json'),
      ),
    ).toHaveLength(1);
    expect(
      readdirSync(join(installedRun, 'requests')).filter((name) =>
        name.endsWith('.json'),
      ),
    ).toHaveLength(1);
    expect(source.stdout).toContain(current.sourceRoot);
    expect(installed.stdout).toContain(installedRoot);
  });

  it('renders the source latest run separately from the installed latest run', () => {
    const current = getFixture();
    const sourceRun = prepareRun(current.sourceRoot, 'source-report', 111);
    const installedRoot = join(current.installedDataRoot, 'memprofile');
    const installedRun = prepareRun(installedRoot, 'installed-report', 222);
    writeSamples(sourceRun, 111);
    writeSamples(installedRun, 222);

    const source = runUtility(
      current.sourceReport,
      [],
      current.installedDataRoot,
    );
    const installed = runUtility(
      current.installedReport,
      [],
      current.installedDataRoot,
    );

    expect(source.status, source.stderr).toBe(0);
    expect(source.stdout).toContain('pid 111');
    expect(source.stdout).not.toContain('pid 222');
    expect(installed.status, installed.stderr).toBe(0);
    expect(installed.stdout).toContain('pid 222');
    expect(installed.stdout).not.toContain('pid 111');
  });

  it('keeps explicit request directories ahead of the installed default root', () => {
    const current = getFixture();
    const installedRoot = join(current.installedDataRoot, 'memprofile');
    const defaultRun = prepareRun(installedRoot, 'default-run', 222);
    const explicitRun = prepareRun(
      join(current.root, 'explicit-root'),
      'explicit-run',
      333,
    );

    const result = runUtility(
      current.installedRequest,
      ['--dir', explicitRun],
      current.installedDataRoot,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(
      readdirSync(join(explicitRun, 'requests')).filter((name) =>
        name.endsWith('.json'),
      ),
    ).toHaveLength(1);
    expect(
      readdirSync(join(defaultRun, 'requests')).filter((name) =>
        name.endsWith('.json'),
      ),
    ).toHaveLength(0);
  });

  it('uses source and installed start commands when no latest run exists', () => {
    const current = getFixture();
    const sourceRequest = runUtility(
      current.sourceRequest,
      [],
      current.installedDataRoot,
    );
    const sourceReport = runUtility(
      current.sourceReport,
      [],
      current.installedDataRoot,
    );
    const installedRequest = runUtility(
      current.installedRequest,
      [],
      current.installedDataRoot,
    );
    const installedReport = runUtility(
      current.installedReport,
      [],
      current.installedDataRoot,
    );

    expect(sourceRequest.status).toBe(1);
    expect(sourceReport.status).toBe(1);
    expect(sourceRequest.stderr).toContain('npm run mem:profile');
    expect(sourceReport.stderr).toContain('npm run mem:profile');
    expect(installedRequest.status).toBe(1);
    expect(installedReport.status).toBe(1);
    expect(installedRequest.stderr).toContain(
      'Start one with: llxprt --memprofile',
    );
    expect(installedReport.stderr).toContain(
      'Start one with: llxprt --memprofile',
    );
    expect(installedRequest.stderr + installedReport.stderr).not.toContain(
      'npm run mem:profile',
    );
  });

  it('uses the installed start command when an explicit run is inactive', () => {
    const current = getFixture();
    const inactiveRun = join(current.root, 'inactive-installed-run');
    mkdirSync(inactiveRun, { recursive: true });

    const installed = runUtility(
      current.installedRequest,
      ['--dir', inactiveRun],
      current.installedDataRoot,
    );

    expect(installed.status).toBe(1);
    expect(installed.stderr).toContain('not active');
    expect(installed.stderr).toContain('Start one with: llxprt --memprofile');
    expect(installed.stderr).not.toContain('npm run mem:profile');
  });

  it('uses installed utility command labels while retaining source labels', () => {
    const current = getFixture();
    const sourceRequest = runUtility(
      current.sourceRequest,
      ['--unknown'],
      current.installedDataRoot,
    );
    const installedRequest = runUtility(
      current.installedRequest,
      ['--unknown'],
      current.installedDataRoot,
    );
    const sourceAnalyze = runUtility(
      current.sourceAnalyze,
      [],
      current.installedDataRoot,
    );
    const installedAnalyze = runUtility(
      current.installedAnalyze,
      [],
      current.installedDataRoot,
    );

    expect(sourceRequest.status).toBe(2);
    expect(sourceRequest.stderr).toContain('Usage: npm run mem:request');
    expect(installedRequest.status).toBe(2);
    expect(installedRequest.stderr).toContain(
      'Usage: llxprt memprofile request',
    );
    expect(sourceAnalyze.status).toBe(2);
    expect(sourceAnalyze.stderr).toContain('Usage: mem:analyze --');
    expect(installedAnalyze.status).toBe(2);
    expect(installedAnalyze.stderr).toContain(
      'Usage: llxprt memprofile analyze',
    );
  }, 15_000);
});
