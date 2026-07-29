/**
 * Minimal tmux-based interactive UI harness for the Ink UI.
 *
 * Why tmux:
 * - Keeps stdin as a TTY (so LLxprt stays in interactive mode).
 * - Lets us inject keystrokes and capture the rendered screen + scrollback.
 *
 * Usage:
 *   bun scripts/tmux-harness.ts
 *
 * Scripted mode:
 *   bun scripts/tmux-harness.ts --script scripts/tmux-script.example.json
 */

import { accessSync, constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quote } from 'shell-quote';
import { execFileSync } from 'node:child_process';
import {
  compileMatcher,
  matchText,
  formatMatcher,
  countMatches,
  sanitizeLabel,
  deepCloneJson,
  applyMacroArgs,
  expandScriptMacros,
  parseToolConfirmationOptions,
} from './tmux-harness-helpers.ts';
import {
  runTmux,
  tryTmux,
  TMUX_ENV_KEYS,
  getTmuxSocketPath,
  cleanupTmuxSocketDir,
  buildTmuxSocketArgs,
  sleep,
  isPrimaryPaneDead,
  waitForPaneDead,
  getHistorySize,
  captureScreen,
  captureScrollback,
  readPaneOutputFallback,
  captureScreenWithFallback,
  resolveCapturedText,
  captureArtifacts,
  waitFor,
  waitForNot,
  isShellModeActive,
  resolveScopeAndScrollback,
} from './tmux-harness-io.ts';
import { executeStepDispatch } from './tmux-harness-steps.ts';
import {
  runScenarioHaiku,
  runScenarioScrollback,
  runScriptSteps,
  handleScenarioError,
  captureFinalArtifacts,
  assertScrollbackResults,
  type ScenarioResult,
  type TypeLineAndSubmitFn,
  type TypeLineSubmitOptions,
} from './tmux-harness-scenarios.ts';

// Re-export the pure helpers and extracted modules so this module preserves
// its public API.
export {
  compileMatcher,
  matchText,
  formatMatcher,
  countMatches,
  sanitizeLabel,
  deepCloneJson,
  applyMacroArgs,
  expandScriptMacros,
  parseToolConfirmationOptions,
};
export {
  runTmux,
  tryTmux,
  TMUX_ENV_KEYS,
  getTmuxSocketPath,
  cleanupTmuxSocketDir,
  buildTmuxSocketArgs,
  sleep,
  isPrimaryPaneDead,
  waitForPaneDead,
  getHistorySize,
  captureScreen,
  captureScrollback,
  readPaneOutputFallback,
  captureScreenWithFallback,
  resolveCapturedText,
  captureArtifacts,
  waitFor,
  waitForNot,
  isShellModeActive,
  resolveScopeAndScrollback,
  executeStepDispatch,
};

interface HarnessOptions {
  scenario: string | undefined;
  scriptPath: string | undefined;
  outDir: string | undefined;
  cols: number | undefined;
  rows: number | undefined;
  initialWaitMs: number | undefined;
  historyLimit: number | undefined;
  scrollbackLines: number | undefined;
  yolo: boolean;
  keepSession: boolean;
  assert: boolean;
}

export function parseArgs(argv: string[]): HarnessOptions {
  const args = [...argv];
  const opts: HarnessOptions = {
    scenario: undefined,
    scriptPath: undefined,
    outDir: undefined,
    cols: undefined,
    rows: undefined,
    initialWaitMs: undefined,
    historyLimit: undefined,
    scrollbackLines: undefined,
    yolo: false,
    keepSession: false,
    assert: false,
  };

  const takeValue = (flag: string) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const value = args[idx + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`Missing value for ${flag}`);
    }
    args.splice(idx, 2);
    return value;
  };

  const hasFlag = (flag: string) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    args.splice(idx, 1);
    return true;
  };

  const scenario = takeValue('--scenario');
  if (scenario) opts.scenario = scenario;

  const scriptPath = takeValue('--script');
  if (scriptPath) opts.scriptPath = scriptPath;

  const outDir = takeValue('--out-dir');
  if (outDir) opts.outDir = outDir;

  const cols = takeValue('--cols');
  if (cols) opts.cols = Number(cols);
  const rows = takeValue('--rows');
  if (rows) opts.rows = Number(rows);

  const initialWaitMs = takeValue('--initial-wait-ms');
  if (initialWaitMs) opts.initialWaitMs = Number(initialWaitMs);

  const historyLimit = takeValue('--history-limit');
  if (historyLimit) opts.historyLimit = Number(historyLimit);

  const scrollbackLines = takeValue('--scrollback-lines');
  if (scrollbackLines) opts.scrollbackLines = Number(scrollbackLines);

  opts.yolo = hasFlag('--yolo');
  opts.keepSession = hasFlag('--keep-session');
  opts.assert = hasFlag('--assert');

  if (args.length > 0) {
    throw new Error(`Unknown args: ${args.join(' ')}`);
  }

  validatePositiveFinite(opts.cols, '--cols');
  validatePositiveFinite(opts.rows, '--rows');
  validateNonNegativeFinite(opts.initialWaitMs, '--initial-wait-ms');
  validatePositiveFinite(opts.historyLimit, '--history-limit');
  validatePositiveFinite(opts.scrollbackLines, '--scrollback-lines');
  if (
    opts.scenario !== undefined &&
    !['haiku', 'scrollback'].includes(opts.scenario)
  ) {
    throw new Error(`Invalid --scenario: ${opts.scenario}`);
  }

  return opts;
}

function validatePositiveFinite(value: unknown, flag: string): void {
  if (
    value !== undefined &&
    (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
}

function validateNonNegativeFinite(value: unknown, flag: string): void {
  if (
    value !== undefined &&
    (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  ) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
}

interface TmuxScriptConfig {
  cols?: number;
  rows?: number;
  initialWaitMs?: number;
  historyLimit?: number;
  scrollbackLines?: number;
}

interface LoadedScript {
  steps?: unknown[];
  startCommand?: unknown;
  tmux?: TmuxScriptConfig;
  macros?: Record<string, unknown[]>;
  yolo?: boolean;
}

async function loadScript(
  scriptPath: string,
): Promise<LoadedScript | undefined> {
  if (!scriptPath) return undefined;
  const resolved = path.resolve(process.cwd(), scriptPath);
  try {
    return JSON.parse(await fs.readFile(resolved, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse script file ${resolved}: ${message}`);
  }
}

function resolveTmuxConfig(
  options: HarnessOptions,
  script: LoadedScript | undefined,
): {
  cols: number;
  rows: number;
  initialWaitMs: number;
  historyLimit: number;
  scrollbackLines: number;
} {
  return {
    cols: options.cols ?? script?.tmux?.cols ?? 120,
    rows: options.rows ?? script?.tmux?.rows ?? 40,
    initialWaitMs: options.initialWaitMs ?? script?.tmux?.initialWaitMs ?? 6000,
    historyLimit: options.historyLimit ?? script?.tmux?.historyLimit ?? 50000,
    scrollbackLines:
      options.scrollbackLines ?? script?.tmux?.scrollbackLines ?? 2000,
  };
}

function resolveExecutable(name: string, envVar: string, fallback: string) {
  const envValue = process.env[envVar]?.trim();
  if (envValue) {
    try {
      accessSync(envValue, fsConstants.X_OK);
      return envValue;
    } catch (error) {
      const details = error instanceof Error ? ` ${error.message}` : '';
      console.warn(
        `[tmux-harness] ${envVar}="${envValue}" is not executable; falling back to PATH lookup.${details}`,
      );
    }
  }
  try {
    const locator = process.platform === 'win32' ? 'where' : 'which';
    const located = execFileSync(locator, [name], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)[0];
    return located || fallback;
  } catch (error) {
    const details = error instanceof Error ? ` ${error.message}` : '';
    console.warn(
      `[tmux-harness] Could not resolve ${name} executable path; falling back to bare "${fallback}".${details}`,
    );
    return fallback;
  }
}

function resolveBunExecutable() {
  if (process.versions.bun) {
    const envValue = process.env.BUN_EXECUTABLE_PATH?.trim();
    if (envValue) {
      try {
        accessSync(envValue, fsConstants.X_OK);
        return envValue;
      } catch (error) {
        const details = error instanceof Error ? ` ${error.message}` : '';
        console.warn(
          `[tmux-harness] BUN_EXECUTABLE_PATH="${envValue}" is not executable; using current Bun runtime.${details}`,
        );
      }
    }
    return process.execPath;
  }
  return resolveExecutable('bun', 'BUN_EXECUTABLE_PATH', 'bun');
}

function resolveNodeExecutable() {
  return resolveExecutable('node', 'NODE_EXECUTABLE_PATH', 'node');
}

type ExecutableResolver = () => string;

function resolveStartArgForTmux(
  arg: string,
  getBunExecutable: ExecutableResolver,
  getNodeExecutable: ExecutableResolver,
): string {
  if (arg === 'node') {
    return getNodeExecutable();
  }
  if (arg === 'bun') {
    return getBunExecutable();
  }
  if (!arg.includes('${node}') && !arg.includes('${bun}')) {
    return arg;
  }
  return arg
    .replaceAll('${node}', getNodeExecutable())
    .replaceAll('${bun}', getBunExecutable());
}

export function resolveStartArgsForTmux(startArgs: string[]): string[] {
  let bunExecutable;
  let nodeExecutable;
  const getBunExecutable = () => (bunExecutable ??= resolveBunExecutable());
  const getNodeExecutable = () => (nodeExecutable ??= resolveNodeExecutable());
  return startArgs.map((arg) =>
    resolveStartArgForTmux(arg, getBunExecutable, getNodeExecutable),
  );
}

export function buildTmuxStartCommand(
  startArgs: string[],
  outDir: string,
): string {
  const resolved = resolveStartArgsForTmux(startArgs);
  const artifactEnv = outDir
    ? `LLXPRT_TMUX_ARTIFACT_DIR=${quote([outDir])} `
    : '';
  return `${artifactEnv}${resolved.length === 1 ? resolved[0] : quote(resolved)}`;
}

interface ResolvedTmuxConfig {
  cols: number;
  rows: number;
  initialWaitMs: number;
  historyLimit: number;
  scrollbackLines: number;
}

function startTmuxSession(
  sessionName: string,
  startArgs: string[],
  tmuxConfig: ResolvedTmuxConfig,
  outDir: string,
): void {
  tryTmux(['kill-session', '-t', sessionName]);

  runTmux([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    process.cwd(),
    '-x',
    String(tmuxConfig.cols),
    '-y',
    String(tmuxConfig.rows),
  ]);
  runTmux(['set-option', '-t', `${sessionName}:0`, 'remain-on-exit', 'on']);
  runTmux([
    'set-option',
    '-t',
    `${sessionName}:0`,
    'history-limit',
    String(tmuxConfig.historyLimit),
  ]);
  runTmux([
    'pipe-pane',
    '-o',
    '-t',
    sessionName,
    `cat > ${quote([path.join(outDir, 'pane-output.log')])}`,
  ]);
  runTmux([
    'respawn-pane',
    '-k',
    '-t',
    sessionName,
    `${buildTmuxStartCommand(startArgs, outDir)}; exit`,
  ]);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string')
  );
}

export function buildStartArgs(
  script: LoadedScript | undefined,
  shouldYolo: boolean,
): string[] {
  const command = script?.startCommand;
  if (command !== undefined && !isStringArray(command)) {
    throw new Error(
      'Invalid script.startCommand: expected non-empty array of strings',
    );
  }

  const startArgs = command ? [...command] : ['bun', 'scripts/start.ts'];
  if (shouldYolo && !startArgs.includes('--yolo')) {
    startArgs.push('--yolo');
  }
  return startArgs;
}

function makeTypeLineAndSubmit(
  sessionName: string,
): (line: string, opts?: TypeLineSubmitOptions) => Promise<void> {
  return async (
    line: string,
    { postTypeMs = 600, enterRepeats = 1, escapeBeforeEnter = false } = {},
  ): Promise<void> => {
    runTmux(['send-keys', '-t', sessionName, '-l', line]);
    await sleep(postTypeMs);
    if (escapeBeforeEnter) {
      runTmux(['send-keys', '-t', sessionName, 'Escape']);
      await sleep(150);
    }
    for (let i = 0; i < enterRepeats; i += 1) {
      runTmux(['send-keys', '-t', sessionName, 'Enter']);
      await sleep(150);
    }
  };
}

async function runScenario({
  scenario,
  script,
  sessionName,
  typeLineAndSubmit,
  outDir,
  tmuxConfig,
}: {
  scenario: string;
  script: LoadedScript | undefined;
  sessionName: string;
  typeLineAndSubmit: TypeLineAndSubmitFn;
  outDir: string;
  tmuxConfig: ResolvedTmuxConfig;
}): Promise<ScenarioResult> {
  if (script?.steps) {
    await runScriptSteps({
      sessionName,
      outDir,
      steps: script.steps,
      defaults: {
        postTypeMs: 600,
        submitKeys: ['Enter'],
        shellSubmitKeys: ['Enter'],
        timeoutMs: 15000,
        pollMs: 250,
        scrollbackLines: tmuxConfig.scrollbackLines,
      },
    });
    return { kind: 'script' };
  }

  if (scenario === 'haiku') {
    return await runScenarioHaiku({ sessionName, typeLineAndSubmit });
  }

  if (scenario === 'scrollback') {
    return await runScenarioScrollback({
      sessionName,
      typeLineAndSubmit,
      outDir,
    });
  }

  throw new Error(`Unhandled scenario: ${scenario}`);
}

async function runAssertionsAndTeardown(
  options: HarnessOptions,
  sessionName: string,
  scenarioResult: ScenarioResult | undefined,
  exited: boolean,
  scrollback: string,
  outDir: string,
  script: LoadedScript | undefined,
  scenario: string,
): Promise<void> {
  let assertionError: Error | null = null;
  if (
    scenarioResult?.kind === 'scrollback' &&
    scenarioResult.sentinel &&
    scenarioResult.historySamples
  ) {
    const baselineScrollback = scenarioResult.captures?.scrollbackFile
      ? await fs.readFile(
          path.join(outDir, scenarioResult.captures.scrollbackFile),
          'utf8',
        )
      : scrollback;

    assertionError = await assertScrollbackResults({
      scenarioResult: {
        sentinel: scenarioResult.sentinel,
        historySamples: scenarioResult.historySamples,
        captures: scenarioResult.captures,
      },
      baselineScrollback,
      assert: options.assert,
      outDir,
      tmuxConfig: resolveTmuxConfig(options, script),
    });
  }

  if (!options.keepSession) {
    tryTmux(['kill-session', '-t', sessionName]);
  }

  const summary = [
    `tmux session: ${sessionName}`,
    ...(options.keepSession ? [`tmux socket: ${getTmuxSocketPath()}`] : []),
    `exited: ${exited ? 'yes' : 'no (killed session)'}`,
    `artifacts: ${outDir}`,
    `scenario: ${script?.steps ? 'script' : scenario}`,
  ].join('\n');
  console.log(summary);

  if (assertionError) {
    throw assertionError;
  }
}

async function runMain(options: HarnessOptions): Promise<void> {
  const sessionName = `llxprt_tmux_${Date.now().toString(16)}`;
  const outDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : path.join(os.tmpdir(), `llxprt-tmux-harness-${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const script = await loadScript(options.scriptPath ?? '');
  if (script?.steps) {
    script.steps = expandScriptMacros(script.steps, script.macros);
  }

  const tmuxConfig = resolveTmuxConfig(options, script);
  const shouldYolo = Boolean(options.yolo || script?.yolo);
  const startArgs = buildStartArgs(script, shouldYolo);
  startTmuxSession(sessionName, startArgs, tmuxConfig, outDir);

  await sleep(tmuxConfig.initialWaitMs);

  const typeLineAndSubmit = makeTypeLineAndSubmit(sessionName);

  let scenarioResult: ScenarioResult | undefined;
  const scenario = options.scenario ?? 'haiku';
  try {
    scenarioResult = await runScenario({
      scenario,
      script,
      sessionName,
      typeLineAndSubmit,
      outDir,
      tmuxConfig,
    });
  } catch (error) {
    await handleScenarioError({
      error,
      sessionName,
      outDir,
      scrollbackLines: options.scrollbackLines ?? script?.tmux?.scrollbackLines,
      keepSession: options.keepSession,
      scriptSteps: script?.steps,
      scenario,
    });
    throw error;
  }

  const exited = await waitForPaneDead(sessionName, 15000);

  const { scrollback } = await captureFinalArtifacts({
    sessionName,
    outDir,
    scenario,
    scrollbackLines: resolveTmuxConfig(options, script).scrollbackLines,
  });

  await runAssertionsAndTeardown(
    options,
    sessionName,
    scenarioResult,
    exited,
    scrollback,
    outDir,
    script,
    scenario,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    await runMain(options);
  } finally {
    if (!options.keepSession) {
      cleanupTmuxSocketDir();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
