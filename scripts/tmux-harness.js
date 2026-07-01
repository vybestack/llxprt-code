/**
 * Minimal tmux-based interactive UI harness for the Ink UI.
 *
 * Why tmux:
 * - Keeps stdin as a TTY (so LLxprt stays in interactive mode).
 * - Lets us inject keystrokes and capture the rendered screen + scrollback.
 *
 * Usage:
 *   node scripts/tmux-harness.js
 *
 * Scripted mode:
 *   node scripts/tmux-harness.js --script scripts/tmux-script.example.json
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quote } from 'shell-quote';
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
} from './tmux-harness-helpers.mjs';
import {
  runTmux,
  tryTmux,
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
} from './tmux-harness-io.mjs';
import { executeStepDispatch } from './tmux-harness-steps.mjs';

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

export function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    scenario: undefined, // haiku | scrollback
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

  const takeValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const value = args[idx + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`Missing value for ${flag}`);
    }
    args.splice(idx, 2);
    return value;
  };

  const hasFlag = (flag) => {
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

function validatePositiveFinite(value, flag) {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
}

function validateNonNegativeFinite(value, flag) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
}

async function runScriptSteps({ sessionName, outDir, steps, defaults }) {
  const scriptState = {
    historySamples: [],
  };

  const sendKeys = async (keys) => {
    for (const key of keys) {
      runTmux(['send-keys', '-t', sessionName, key]);
      await sleep(120);
    }
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step !== 'object') {
      throw new Error(`Invalid step at index ${i}: ${JSON.stringify(step)}`);
    }

    try {
      await executeStepDispatch(step, i, {
        sessionName,
        outDir,
        sendKeys,
        scriptState,
        defaults,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stepLabel = sanitizeLabel(
        `${String(i).padStart(3, '0')}-error-${step.type ?? 'unknown'}`,
      );
      const scrollbackLines = Number(defaults.scrollbackLines);
      await captureArtifacts({
        sessionName,
        outDir,
        label: stepLabel,
        scrollbackLines,
      });
      await fs.writeFile(
        path.join(outDir, `${stepLabel}-step.json`),
        JSON.stringify({ index: i, step, error: message }, null, 2),
        'utf8',
      );
      throw error;
    }
  }

  if (scriptState.historySamples.length > 0) {
    await fs.writeFile(
      path.join(outDir, 'history-samples.json'),
      JSON.stringify(scriptState.historySamples, null, 2),
      'utf8',
    );
  }
}

async function runScenarioHaiku({ typeLineAndSubmit }) {
  await typeLineAndSubmit('/profile load synthetic');
  await sleep(2000);

  await typeLineAndSubmit('write me a haiku');
  await sleep(8000);

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  return { kind: 'haiku' };
}

async function runScenarioScrollback({
  sessionName,
  typeLineAndSubmit,
  outDir,
}) {
  await typeLineAndSubmit('/profile load synthetic');
  await sleep(2000);

  const sentinel = 'SCROLLTEST LINE';

  // Produce incremental output for ~15s so the UI updates repeatedly while the
  // output grows beyond a small terminal height.
  const cmd = '!node scripts/scrollback-load.js --total 60 --interval-ms 250';
  await typeLineAndSubmit(cmd, { enterRepeats: 1, escapeBeforeEnter: false });

  // If the shell command triggers a confirmation dialog (non-YOLO mode), accept
  // the default selection ("Yes, allow once") so the scenario can proceed.
  await sleep(600);
  const maybeDialog = captureScreen(sessionName);
  if (maybeDialog.includes('Shell Command Execution')) {
    runTmux(['send-keys', '-t', sessionName, 'Enter']);
  }

  // Disable output height constraints while the command is running (this is the
  // user-visible "show more lines" mode that can trigger redraw/scrollback
  // problems when output exceeds terminal height).
  await sleep(800);
  runTmux(['send-keys', '-t', sessionName, 'C-s']);

  // Wait until output is flowing, then enter tmux copy-mode (simulates user
  // scrolling up in their terminal) and sit there while the program continues.
  await sleep(2500);
  runTmux(['copy-mode', '-t', `${sessionName}:0.0`]);
  for (let i = 0; i < 3; i += 1) {
    runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'page-up']);
  }

  const sampleStart = Date.now();
  const historySamples = [];
  const sampleForMs = 20000;
  while (Date.now() - sampleStart <= sampleForMs) {
    historySamples.push({
      tMs: Date.now() - sampleStart,
      historySize: getHistorySize(sessionName),
    });
    await sleep(1000);
  }

  runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'cancel']);

  // Let the command finish and settle.
  await sleep(2000);

  // Capture before exit: alternate-buffer UIs may not leave output in terminal
  // scrollback after quitting, so we snapshot the screen while the output is
  // still visible.
  const preExitScreen = captureScreen(sessionName);
  const preExitScrollback = captureScrollback(sessionName, 20000);
  await fs.writeFile(
    path.join(outDir, 'during-run-screen.txt'),
    preExitScreen,
    'utf8',
  );
  await fs.writeFile(
    path.join(outDir, 'during-run-scrollback.txt'),
    preExitScrollback,
    'utf8',
  );

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  await fs.writeFile(
    path.join(outDir, 'history-samples.json'),
    JSON.stringify(historySamples, null, 2),
    'utf8',
  );

  return {
    kind: 'scrollback',
    sentinel,
    historySamples,
    captures: {
      screenFile: 'during-run-screen.txt',
      scrollbackFile: 'during-run-scrollback.txt',
    },
  };
}

async function loadScript(scriptPath) {
  if (!scriptPath) return null;
  const resolved = path.resolve(process.cwd(), scriptPath);
  try {
    return JSON.parse(await fs.readFile(resolved, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse script file ${resolved}: ${message}`);
  }
}

function resolveTmuxConfig(options, script) {
  return {
    cols: options.cols ?? script?.tmux?.cols ?? 120,
    rows: options.rows ?? script?.tmux?.rows ?? 40,
    initialWaitMs: options.initialWaitMs ?? script?.tmux?.initialWaitMs ?? 6000,
    historyLimit: options.historyLimit ?? script?.tmux?.historyLimit ?? 50000,
    scrollbackLines:
      options.scrollbackLines ?? script?.tmux?.scrollbackLines ?? 2000,
  };
}

export function resolveStartArgsForTmux(startArgs) {
  return startArgs.map((arg) =>
    arg === 'node'
      ? process.execPath
      : arg.replaceAll('${node}', process.execPath),
  );
}

export function buildTmuxStartCommand(startArgs, outDir) {
  const resolved = resolveStartArgsForTmux(startArgs);
  const artifactEnv = outDir
    ? `LLXPRT_TMUX_ARTIFACT_DIR=${quote([outDir])} `
    : '';
  return `${artifactEnv}${resolved.length === 1 ? resolved[0] : quote(resolved)}`;
}

function startTmuxSession(sessionName, startArgs, tmuxConfig, outDir) {
  // Ensure no stale session with the same name (unlikely, but safe).
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

export function buildStartArgs(script, shouldYolo) {
  const command = script?.startCommand;
  if (
    command !== undefined &&
    (!Array.isArray(command) ||
      command.length === 0 ||
      command.some((item) => typeof item !== 'string'))
  ) {
    throw new Error(
      'Invalid script.startCommand: expected non-empty array of strings',
    );
  }

  const startArgs = command ? [...command] : ['node', 'scripts/start.js'];
  if (shouldYolo && !startArgs.includes('--yolo')) {
    startArgs.push('--yolo');
  }
  return startArgs;
}

async function runScenario({
  scenario,
  script,
  sessionName,
  typeLineAndSubmit,
  outDir,
  tmuxConfig,
}) {
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

function makeTypeLineAndSubmit(sessionName) {
  return async (
    line,
    { postTypeMs = 600, enterRepeats = 1, escapeBeforeEnter = false } = {},
  ) => {
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

async function handleScenarioError({
  error,
  sessionName,
  outDir,
  options,
  script,
  scenario,
}) {
  const message = error instanceof Error ? error.message : String(error);
  const scrollbackLines =
    options.scrollbackLines ?? script?.tmux?.scrollbackLines ?? 2000;
  try {
    await captureArtifacts({
      sessionName,
      outDir,
      label: 'error-final',
      scrollbackLines,
    });
  } catch {
    // ignore
  }
  try {
    await fs.writeFile(
      path.join(outDir, 'error.json'),
      JSON.stringify({ message }, null, 2),
      'utf8',
    );
  } catch {
    // ignore
  }
  if (!options.keepSession) {
    tryTmux(['kill-session', '-t', sessionName]);
  }
  console.error(
    [
      `tmux session: ${sessionName}`,
      `artifacts: ${outDir}`,
      `scenario: ${script?.steps ? 'script' : scenario}`,
    ].join('\n'),
  );
}

async function captureFinalArtifacts({
  sessionName,
  outDir,
  scenario,
  tmuxConfig,
}) {
  const screen = captureScreen(sessionName);
  const scrollbackLines =
    scenario === 'scrollback' ? 20000 : tmuxConfig.scrollbackLines;
  const scrollback = captureScrollback(sessionName, scrollbackLines);
  await fs.writeFile(path.join(outDir, 'screen.txt'), screen, 'utf8');
  await fs.writeFile(path.join(outDir, 'scrollback.txt'), scrollback, 'utf8');
  return { screen, scrollback, scrollbackLines };
}

async function assertScrollbackResults({
  scenarioResult,
  baselineScrollback,
  options,
  outDir,
  tmuxConfig,
}) {
  const sentinelCount =
    baselineScrollback.match(new RegExp(scenarioResult.sentinel, 'g'))
      ?.length ?? 0;
  const tipsCount =
    baselineScrollback.match(/Tips for getting started:/g)?.length ?? 0;

  const historyDelta =
    scenarioResult.historySamples.length >= 2
      ? scenarioResult.historySamples.at(-1).historySize -
        scenarioResult.historySamples[0].historySize
      : 0;

  await fs.writeFile(
    path.join(outDir, 'metrics.json'),
    JSON.stringify(
      {
        scenario: 'scrollback',
        tmux: {
          cols: tmuxConfig.cols,
          rows: tmuxConfig.rows,
        },
        counts: {
          sentinel: scenarioResult.sentinel,
          sentinelCount,
          tipsCount,
        },
        history: {
          deltaDuringCopyMode: historyDelta,
          samplesFile: 'history-samples.json',
        },
        captures: scenarioResult.captures ?? null,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!options.assert) return null;

  if (sentinelCount < 1) {
    return new Error(
      `Scrollback output missing: expected sentinelCount >= 1 but got ${sentinelCount} (sentinel: "${scenarioResult.sentinel}")`,
    );
  }
  if (historyDelta !== 0) {
    return new Error(
      `Scrollback redraw detected: expected history delta == 0 but got ${historyDelta}`,
    );
  }
  if (tipsCount > 1) {
    return new Error(
      `Scrollback redraw detected: expected tipsCount <= 1 but got ${tipsCount}`,
    );
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionName = `llxprt_tmux_${Date.now().toString(16)}`;
  const outDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : path.join(os.tmpdir(), `llxprt-tmux-harness-${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const script = await loadScript(options.scriptPath);
  if (script?.steps) {
    script.steps = expandScriptMacros(script.steps, script.macros);
  }

  const tmuxConfig = resolveTmuxConfig(options, script);
  const shouldYolo = Boolean(options.yolo || script?.yolo);
  const startArgs = buildStartArgs(script, shouldYolo);
  startTmuxSession(sessionName, startArgs, tmuxConfig, outDir);

  // Let Ink render the initial UI.
  await sleep(tmuxConfig.initialWaitMs);

  const typeLineAndSubmit = makeTypeLineAndSubmit(sessionName);

  let scenarioResult;
  const scenario = options.scenario ?? 'haiku';
  try {
    scenarioResult = await runScenario({
      scenario,
      script,
      sessionName,
      typeLineAndSubmit,
      outDir,
      options,
      tmuxConfig,
    });
  } catch (error) {
    await handleScenarioError({
      error,
      sessionName,
      outDir,
      options,
      script,
      scenario,
    });
    throw error;
  }

  // Give the process time to exit cleanly (pane should become "dead").
  const exited = await waitForPaneDead(sessionName, 15000);

  const { scrollback } = await captureFinalArtifacts({
    sessionName,
    outDir,
    scenario,
    tmuxConfig,
  });

  let assertionError = null;
  if (scenarioResult?.kind === 'scrollback') {
    const baselineScrollback = scenarioResult.captures?.scrollbackFile
      ? await fs.readFile(
          path.join(outDir, scenarioResult.captures.scrollbackFile),
          'utf8',
        )
      : scrollback;

    assertionError = await assertScrollbackResults({
      scenarioResult,
      baselineScrollback,
      options,
      outDir,
      tmuxConfig,
    });
  }

  // Tear down so we don't leak sessions.
  if (!options.keepSession) {
    tryTmux(['kill-session', '-t', sessionName]);
  }

  const summary = [
    `tmux session: ${sessionName}`,
    `exited: ${exited ? 'yes' : 'no (killed session)'}`,
    `artifacts: ${outDir}`,
    `scenario: ${script?.steps ? 'script' : scenario}`,
  ].join('\n');
  console.log(summary);

  if (assertionError) {
    throw assertionError;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
