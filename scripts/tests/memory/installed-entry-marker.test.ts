/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSyncWithFileCapture } from './sync-process.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entries = [
  ['launcher', 'launcher'],
  ['request', 'request-cli'],
  ['report', 'report'],
  ['analyze', 'heapanalyze'],
];

let root = '';

function compile(
  name: string,
  destination: string,
  external: readonly string[] = [],
): void {
  const result = spawnSyncWithFileCapture(
    root,
    process.execPath,
    [
      'build',
      join(repoRoot, 'scripts', 'memory', `${name}.ts`),
      '--target',
      'node',
      '--outfile',
      destination,
      ...external.flatMap((path) => ['--external', path]),
    ],
    { cwd: repoRoot, timeout: 30_000 },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

beforeAll(() => {
  root = mkdtempSync(join(repoRoot, 'tmp', 'memory-bootstrap-'));
  for (const [installed, source] of entries) {
    compile(
      `installed-${installed}-entry`,
      join(root, `installed-${installed}-entry.mjs`),
    );
    for (const name of [`installed-${installed}`, source]) {
      compile(
        name.startsWith('installed-') ? name : `${name}-entry`,
        join(root, `${name}.mjs`),
      );
    }
  }
  const rejected = join(root, 'rejected');
  mkdirSync(rejected);
  const shim = readFileSync(
    join(repoRoot, 'scripts/memory/installed-report.ts'),
    'utf8',
  );
  const transpiler = new Bun.Transpiler({ target: 'node', loader: 'ts' });
  writeFileSync(
    join(rejected, 'installed-report.mjs'),
    `delete import.meta.main;\n${transpiler.transformSync(shim).replaceAll('.ts', '.mjs')}`,
  );
  compile('entrypoint', join(rejected, 'entrypoint.mjs'));
  compile('runtime-paths', join(rejected, 'runtime-paths.mjs'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function execute(
  command: string,
  args: readonly string[],
): ReturnType<typeof spawnSyncWithFileCapture> {
  return spawnSyncWithFileCapture(root, command, args, {
    cwd: root,
    env: {
      ...process.env,
      CLI_VERSION: 'bootstrap-test',
      LLXPRT_DATA_HOME: join(root, 'data'),
    },
    timeout: 30_000,
  });
}

interface ExecutionObservation {
  readonly status: number | null;
  readonly outputCount: number | undefined;
  readonly requestFiles: number | undefined;
  readonly unexpectedOutput: string;
}

function observeSingleExecution(
  command: string,
  path: string,
  request: boolean,
  analyze: boolean,
): ExecutionObservation {
  if (!request) {
    const result = execute(command, [path, '--help']);
    return {
      status: result.status,
      outputCount: analyze
        ? result.stderr.match(/unknown option: --help\. Usage:/g)?.length
        : result.stdout.match(/Usage:/g)?.length,
      requestFiles: undefined,
      unexpectedOutput: analyze ? result.stdout : result.stderr,
    };
  }
  const run = mkdtempSync(join(root, 'run-'));
  mkdirSync(join(run, 'requests'));
  writeFileSync(
    join(run, 'probe.lease'),
    JSON.stringify({
      owner: 'bootstrap',
      pid: process.pid,
      heartbeatAt: Date.now(),
    }),
  );
  const result = execute(command, [path, '--dir', run]);
  return {
    status: result.status,
    outputCount: result.stdout.match(/Queued sample request/g)?.length,
    requestFiles: readdirSync(join(run, 'requests')).length,
    unexpectedOutput: result.stderr,
  };
}

describe('compiled memory bootstrap contracts', () => {
  for (const command of ['node', process.execPath]) {
    for (const [installed, source] of entries) {
      const installedName = `installed-${installed}.mjs`;

      it(`${command} imports ${installedName} without executing it`, () => {
        const quietPath = join(root, `quiet-${installedName}`);
        writeFileSync(
          quietPath,
          `delete import.meta.main;\n${readFileSync(join(root, installedName), 'utf8')}`,
        );
        const result = execute(command, [
          '--input-type=module',
          '-e',
          `process.argv = [process.execPath, ${JSON.stringify(quietPath)}, '--help']; await import(${JSON.stringify(pathToFileURL(quietPath).href)}); await import(${JSON.stringify(pathToFileURL(quietPath).href)}); console.log('imported');`,
        ]);
        expect(result).toEqual({ status: 0, stdout: 'imported\n', stderr: '' });
      });

      it(`${command} runs ${installedName} exactly once`, () => {
        const observed = observeSingleExecution(
          command,
          join(root, `installed-${installed}-entry.mjs`),
          installed === 'request',
          installed === 'analyze',
        );
        expect(observed).toEqual({
          status: installed === 'analyze' ? 2 : 0,
          outputCount: 1,
          requestFiles: installed === 'request' ? 1 : undefined,
          unexpectedOutput: '',
        });
      });

      it(`${command} imports ${source} with matching argv without starting it`, () => {
        const path = join(root, `${source}.mjs`);
        const result = execute(command, [
          '--input-type=module',
          '-e',
          `process.argv = [process.execPath, ${JSON.stringify(path)}, '--help']; await import(${JSON.stringify(pathToFileURL(path).href)}); console.log('imported');`,
        ]);
        expect(result).toEqual({ status: 0, stdout: 'imported\n', stderr: '' });
      });

      it(`${command} runs the source ${source} through a symlink exactly once`, () => {
        const link = join(
          root,
          `${installed}-${command === 'node' ? 'node' : 'bun'}-link.mjs`,
        );
        symlinkSync(join(root, `${source}.mjs`), link);
        const observed = observeSingleExecution(
          command,
          link,
          installed === 'request',
          installed === 'analyze',
        );
        expect(observed).toEqual({
          status: installed === 'analyze' ? 2 : 0,
          outputCount: 1,
          requestFiles: installed === 'request' ? 1 : undefined,
          unexpectedOutput: '',
        });
      });
    }

    for (const [installed] of command === 'node' ? entries : []) {
      for (const metadata of ['absent', 'undefined']) {
        it(`${command} explicitly launches ${installed} with ${metadata} ImportMeta.main`, () => {
          const path = join(root, `installed-${installed}-entry.mjs`);
          const compiled = readFileSync(path, 'utf8');
          const controlled = join(
            root,
            `controlled-${installed}-${metadata}.mjs`,
          );
          const setup =
            metadata === 'absent'
              ? "delete import.meta.main; if ('main' in import.meta) throw new Error('main metadata remained');"
              : "Object.defineProperty(import.meta, 'main', { value: undefined }); if (import.meta.main !== undefined) throw new Error('main metadata remained');";
          writeFileSync(controlled, `${setup}\n${compiled}`);
          const observed = observeSingleExecution(
            command,
            controlled,
            installed === 'request',
            installed === 'analyze',
          );
          expect(observed).toEqual({
            status: installed === 'analyze' ? 2 : 0,
            outputCount: 1,
            requestFiles: installed === 'request' ? 1 : undefined,
            unexpectedOutput: '',
          });
        });
      }
    }

    it(`${command} leaves no entry-loading state after a rejected module import`, () => {
      mkdirSync(join(root, 'rejected'), { recursive: true });
      const url = pathToFileURL(
        join(root, 'rejected', 'installed-report.mjs'),
      ).href;
      const result = execute(command, [
        '--input-type=module',
        '-e',
        `try { const entry = await import(${JSON.stringify(url)}); await entry.main(); throw new Error('load unexpectedly succeeded'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'MODULE_NOT_FOUND') throw error; } console.log(Reflect.has(globalThis, Symbol.for('llxprt.memprofile.installed-entry-loading')));`,
      ]);
      expect(result).toEqual({ status: 0, stdout: 'false\n', stderr: '' });
    });
  }
});
