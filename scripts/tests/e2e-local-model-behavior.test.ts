/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { asOptionalRecord, asString } from './typed-test-helpers.ts';
import {
  nextFixtureId,
  root,
  runBackendVerifier,
  runLiveLinuxProcVerifier,
  step,
  writeExecutable,
} from './e2e-local-model-fixture.ts';
import type { BackendVerifierResult } from './e2e-local-model-fixture.ts';

describe('workflow CPU variant selection behavior', () => {
  const runSelection = (
    intel: boolean,
    variants: string[],
    cpuinfoName = 'cpuinfo',
  ): string[] => {
    const fixture = resolve(
      root,
      `tmp/verify3764/selection-${nextFixtureId()}`,
    );
    const temp = resolve(fixture, 'temp');
    const libdir = resolve(temp, 'ollama/lib/ollama');
    mkdirSync(libdir, { recursive: true });
    mkdirSync(temp, { recursive: true });
    for (const variant of variants)
      writeFileSync(resolve(libdir, variant), 'variant');
    const cpuinfo = resolve(fixture, cpuinfoName);
    writeFileSync(
      cpuinfo,
      intel ? 'vendor_id : GenuineIntel\n' : 'vendor_id : AuthenticAMD\n',
    );
    const script = asString(step('Select CPU backend on Intel').run).replaceAll(
      '/proc/cpuinfo',
      '"$LLXPRT_TEST_CPUINFO"',
    );
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: temp, LLXPRT_TEST_CPUINFO: cpuinfo },
    });
    if (result.status !== 0)
      throw new Error(`${result.stdout}\n${result.stderr}`);
    const selected = Bun.spawnSync([
      'find',
      libdir,
      '-maxdepth',
      '1',
      '-type',
      'f',
      '-name',
      'libggml-cpu-*.so',
    ]);
    const files = selected.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((path) => path.slice(libdir.length + 1))
      .sort();
    rmSync(fixture, { recursive: true, force: true });
    return files;
  };

  it('forces haswell in each Intel matrix leg and leaves AMD variants unchanged', () => {
    const variants = [
      'libggml-cpu-haswell.so',
      'libggml-cpu-avx512.so',
      'libggml-cpu-amx.so',
    ];
    for (const _matrixLeg of ['sandbox:none', 'sandbox:docker']) {
      expect(runSelection(true, variants)).toEqual(['libggml-cpu-haswell.so']);
    }
    expect(runSelection(false, variants)).toEqual(variants.sort());
  });

  it('selects Intel and AMD variants with shell syntax in the CPU fixture path', () => {
    const variants = ['libggml-cpu-haswell.so', 'libggml-cpu-avx512.so'];
    const cpuinfoName = "cpu info '$(printf injected)'";
    expect(runSelection(true, variants, cpuinfoName)).toEqual([
      'libggml-cpu-haswell.so',
    ]);
    expect(runSelection(false, variants, cpuinfoName)).toEqual([
      'libggml-cpu-avx512.so',
      'libggml-cpu-haswell.so',
    ]);
  });
});

describe('workflow backend verification behavior', () => {
  it('reports the mapped native backend on AMD without imposing the Intel Haswell pin', () => {
    const result = runBackendVerifier(
      '7f000000-7f100000 r-xp 00000000 08:01 42 /runner-temp/ollama/lib/ollama/libggml-cpu-avx2.so\n',
      true,
      { vendor: 'AuthenticAMD' },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Host CPU vendor: AuthenticAMD');
    expect(result.stdout).toContain('libggml-cpu-avx2.so');
  });

  const haswell = '/runner-temp/ollama/lib/ollama/libggml-cpu-haswell.so';
  const mapping = (path: string): string =>
    `7f000000-7f100000 r-xp 00000000 08:01 42 ${path}\n`;

  it.skipIf(process.platform !== 'linux')(
    'accepts the sole haswell mapping from a live stat-zero Linux proc maps file',
    () => {
      const result = runLiveLinuxProcVerifier();
      expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('Loaded CPU backends:');
      expect(result.stdout).toContain('llama-server cmdline:');
      expect(result.stdout).toContain('llama-server PPid:');
    },
    15_000,
  );

  it('accepts the exact sole haswell mapping when the incident log omits AVX512 and AMX fields', () => {
    const result = runBackendVerifier(mapping(haswell));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Loaded CPU backends:');
    expect(result.stdout).toContain('llama-server cmdline:');
    expect(result.stdout).toContain(
      'llama-server PPid: 4200; parent cmdline: ollama serve',
    );
  });

  it('fails when the live process is absent even though the log reports AVX2', () => {
    const result = runBackendVerifier(mapping(haswell), false);
    expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain('Live llama-server process not found');
  });

  it('fails explicitly when the PID vanishes after pgrep returns it', () => {
    const result = runBackendVerifier(mapping(haswell), true, {
      mapsDisappearAfterPgrep: true,
    });
    expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain('Live llama-server maps are unavailable');
  });

  it('fails specifically when readable live-process maps contain no CPU backend despite an AVX2 log', () => {
    const result = runBackendVerifier(mapping('/usr/lib/libc.so.6'));
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain('No mapped llama-server CPU backend');
    expect(result.stderr).not.toContain('maps are unavailable or empty');
  });

  it('rejects additional and alternative mapped CPU library variants', () => {
    for (const maps of [
      `${mapping(haswell)}${mapping('/other/libggml-cpu-avx512.so')}`,
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-skylake.so'),
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-avx512-vnni.so'),
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-amx.so'),
      mapping('/runner-temp/ollama/lib/ollama/libggml-cpu-sapphirerapids.so'),
      mapping(`${haswell} (deleted)`),
    ]) {
      const result = runBackendVerifier(maps);
      expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
      expect(result.stderr).toContain(
        'Unexpected mapped llama-server CPU library',
      );
    }
  }, 15_000);

  it('reads nonempty maps from a zero-size-reported FIFO', () => {
    const result = runBackendVerifier(mapping(haswell), true, {
      mapsFifo: true,
    });
    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Loaded CPU backends:');
  }, 15_000);

  it('rejects a process whose cmdline does not match the expected server', () => {
    const result = runBackendVerifier(mapping(haswell), true, {
      cmdline: 'spoofed\\0--model\\0gemma\\0',
    });
    expect(result.status, `${result.stdout}\\n${result.stderr}`).not.toBe(0);
    expect(result.stderr).toContain(
      'Matched PID is not the expected llama-server process',
    );
  });
});

describe('workflow CPU inference warm-up behavior', () => {
  function runInference(
    generated: { done: boolean; error: string | null; response: string },
    vram: number,
  ): { result: BackendVerifierResult; request: unknown; diagnostic: string } {
    const fixture = resolve(
      root,
      `tmp/verify3764/inference-${nextFixtureId()}`,
    );
    const bin = resolve(fixture, 'bin');
    mkdirSync(bin, { recursive: true });
    const generation = JSON.stringify(generated);
    const ps = JSON.stringify({
      models: [{ name: 'gemma4:e2b-it-qat', size_vram: vram }],
    });
    writeExecutable(
      bin,
      'curl',
      `while (( $# )); do
  case "$1" in
    */api/generate) endpoint=generate ;;
    */api/ps) endpoint=ps ;;
    -d) printf '%s' "$2" >"$RUNNER_TEMP/request.json"; shift ;;
    -o) output="$2"; shift ;;
  esac
  shift
done
if [[ "$endpoint" == generate ]]; then
  if [[ -n "\${output:-}" ]]; then
    printf '%s\\n' '${generation}' >"$output"
  else
    printf '%s\\n' '${generation}'
  fi
else
  printf '%s\\n' '${ps}'
fi`,
    );
    const script = asString(step('Verify CPU-only model inference').run);
    const executed = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: fixture,
        OLLAMA_HOST: '127.0.0.1:12644',
      },
    });
    const request = JSON.parse(
      readFileSync(resolve(fixture, 'request.json'), 'utf8'),
    );
    const diagnostic = readFileSync(
      resolve(fixture, 'ollama-inference.json'),
      'utf8',
    );
    rmSync(fixture, { recursive: true, force: true });
    return {
      result: {
        status: executed.status ?? 1,
        stdout: executed.stdout,
        stderr: executed.stderr,
      },
      request,
      diagnostic,
    };
  }

  it('disables thinking, requests sixteen tokens and retains the raw generation response on success', () => {
    const output = runInference(
      { done: true, error: null, response: 'Hello' },
      0,
    );
    expect(output.result.status, output.result.stderr).toBe(0);
    expect(output.request).toMatchObject({
      model: 'gemma4:e2b-it-qat',
      think: false,
      options: { num_predict: 16 },
    });
    expect(JSON.parse(output.diagnostic)).toEqual({
      done: true,
      error: null,
      response: 'Hello',
    });
  });

  it('reports raw JSON and rejects empty text or unsuccessful completion', () => {
    for (const generated of [
      { done: true, error: null, response: '' },
      { done: false, error: null, response: 'Hello' },
      { done: true, error: 'failure', response: 'Hello' },
    ]) {
      const output = runInference(generated, 0);
      expect(output.result.status).not.toBe(0);
      expect(output.result.stderr).toContain(JSON.stringify(generated));
      expect(output.diagnostic.trim()).toBe(JSON.stringify(generated));
    }
  });

  it('rejects nonzero VRAM despite successful generation', () => {
    const output = runInference(
      { done: true, error: null, response: 'Hello' },
      1,
    );
    expect(output.result.status).not.toBe(0);
  });

  it('uploads the raw inference JSON alongside the existing diagnostics', () => {
    const paths = asString(
      asOptionalRecord(step('Upload local model diagnostics').with)?.path,
    ).split('\n');
    expect(paths).toContain('${{ runner.temp }}/ollama-inference.json');
  });
});
