/**
 * Minimal tmux-based interactive UI harness for the legacy Ink UI.
 *
 * Why tmux:
 * - Keeps stdin as a TTY (so LLxprt stays in interactive mode).
 * - Lets us inject keystrokes and capture the rendered screen + scrollback.
 *
 * Usage:
 *   node scripts/oldui-tmux-harness.js
 *
 * Scripted mode:
 *   node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.example.json
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
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

  if (args.length > 0) {
    throw new Error(`Unknown args: ${args.join(' ')}`);
  }

  if (
    opts.cols !== undefined &&
    (!Number.isFinite(opts.cols) || opts.cols <= 0)
  ) {
    throw new Error(`Invalid --cols: ${opts.cols}`);
  }
  if (
    opts.rows !== undefined &&
    (!Number.isFinite(opts.rows) || opts.rows <= 0)
  ) {
    throw new Error(`Invalid --rows: ${opts.rows}`);
  }
  if (
    opts.scenario !== undefined &&
    !['haiku', 'scrollback'].includes(opts.scenario)
  ) {
    throw new Error(`Invalid --scenario: ${opts.scenario}`);
  }
  if (
    opts.initialWaitMs !== undefined &&
    (!Number.isFinite(opts.initialWaitMs) || opts.initialWaitMs < 0)
  ) {
    throw new Error(`Invalid --initial-wait-ms: ${opts.initialWaitMs}`);
  }
  if (
    opts.historyLimit !== undefined &&
    (!Number.isFinite(opts.historyLimit) || opts.historyLimit <= 0)
  ) {
    throw new Error(`Invalid --history-limit: ${opts.historyLimit}`);
  }
  if (
    opts.scrollbackLines !== undefined &&
    (!Number.isFinite(opts.scrollbackLines) || opts.scrollbackLines <= 0)
  ) {
    throw new Error(`Invalid --scrollback-lines: ${opts.scrollbackLines}`);
  }

  return opts;
}

function runTmux(args, options = {}) {
  const result = spawnSync('tmux', args, {
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString().trim();
    const message = stderr.length > 0 ? stderr : 'tmux command failed';
    const err = new Error(`${message}: tmux ${args.join(' ')}`);
    err.code = result.status;
    throw err;
  }

  return (result.stdout ?? '').toString();
}

function tryTmux(args) {
  try {
    return runTmux(args);
  } catch {
    return null;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isPrimaryPaneDead(sessionName) {
  try {
    const out = runTmux([
      'list-panes',
      '-t',
      `${sessionName}:0`,
      '-F',
      '#{pane_dead}',
    ]).trim();
    const first = out.split('\n')[0]?.trim();
    return first === '1';
  } catch {
    return false;
  }
}

async function waitForPaneDead(sessionName, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPrimaryPaneDead(sessionName)) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

function getHistorySize(sessionName) {
  const out = runTmux([
    'display-message',
    '-p',
    '-t',
    `${sessionName}:0.0`,
    '#{history_size}',
  ]).trim();
  const n = Number(out);
  return Number.isFinite(n) ? n : 0;
}

function captureScreen(sessionName) {
  return runTmux(['capture-pane', '-p', '-t', sessionName]);
}

function captureScrollback(sessionName, scrollbackLines) {
  return runTmux([
    'capture-pane',
    '-p',
    '-t',
    sessionName,
    '-S',
    `-${scrollbackLines}`,
  ]);
}

function compileMatcher(step) {
  if (typeof step.contains === 'string') {
    return { kind: 'contains', value: step.contains };
  }
  if (typeof step.regex === 'string') {
    const flags = typeof step.regexFlags === 'string' ? step.regexFlags : '';
    return { kind: 'regex', value: new RegExp(step.regex, flags) };
  }
  throw new Error(
    `Matcher requires "contains" or "regex": ${JSON.stringify(step)}`,
  );
}

function matchText(text, matcher) {
  if (matcher.kind === 'contains') {
    return text.includes(matcher.value);
  }
  return matcher.value.test(text);
}

function formatMatcher(matcher) {
  if (matcher.kind === 'contains') {
    return `contains "${matcher.value}"`;
  }
  return `regex /${matcher.value.source}/${matcher.value.flags}`;
}

function countMatches(text, matcher) {
  if (matcher.kind === 'contains') {
    let count = 0;
    let idx = 0;
    while (true) {
      idx = text.indexOf(matcher.value, idx);
      if (idx === -1) break;
      count += 1;
      idx += matcher.value.length;
    }
    return count;
  }

  const flags = matcher.value.flags.includes('g')
    ? matcher.value.flags
    : `${matcher.value.flags}g`;
  const re = new RegExp(matcher.value.source, flags);
  return Array.from(text.matchAll(re)).length;
}

function sanitizeLabel(label) {
  return label.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '');
}

async function captureArtifacts({
  sessionName,
  outDir,
  label,
  scrollbackLines,
}) {
  const safe = sanitizeLabel(label);
  const screen = captureScreen(sessionName);
  const scrollback = captureScrollback(sessionName, scrollbackLines);
  await fs.writeFile(path.join(outDir, `${safe}-screen.txt`), screen, 'utf8');
  await fs.writeFile(
    path.join(outDir, `${safe}-scrollback.txt`),
    scrollback,
    'utf8',
  );
}

async function waitFor({
  sessionName,
  scope,
  matcher,
  timeoutMs,
  pollMs,
  scrollbackLines,
  description,
}) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const text =
      scope === 'scrollback'
        ? captureScrollback(sessionName, scrollbackLines)
        : captureScreen(sessionName);
    if (matchText(text, matcher)) {
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for ${description ?? formatMatcher(matcher)} in ${scope} after ${timeoutMs}ms`,
  );
}

function isShellModeActive(sessionName) {
  const screen = captureScreen(sessionName);
  return screen.includes('shell mode enabled');
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
      switch (step.type) {
        case 'wait': {
          const ms = Number(step.ms ?? 0);
          if (!Number.isFinite(ms) || ms < 0) {
            throw new Error(`Invalid wait.ms`);
          }
          await sleep(ms);
          break;
        }
        case 'line': {
          if (typeof step.text !== 'string') {
            throw new Error(`Invalid line.text`);
          }
          const postTypeMs = Number(step.postTypeMs ?? defaults.postTypeMs);

          const submitKeys = (() => {
            if (Array.isArray(step.submitKeys)) return step.submitKeys;
            const treatAsShell =
              step.text.startsWith('!') || isShellModeActive(sessionName);
            return treatAsShell
              ? defaults.shellSubmitKeys
              : defaults.submitKeys;
          })();

          runTmux(['send-keys', '-t', sessionName, '-l', step.text]);
          await sleep(postTypeMs);
          await sendKeys(submitKeys);
          break;
        }
        case 'key': {
          if (typeof step.key !== 'string') {
            throw new Error(`Invalid key.key`);
          }
          await sendKeys([step.key]);
          break;
        }
        case 'keys': {
          if (
            !Array.isArray(step.keys) ||
            step.keys.some((k) => typeof k !== 'string')
          ) {
            throw new Error(`Invalid keys.keys`);
          }
          await sendKeys(step.keys);
          break;
        }
        case 'copyMode': {
          if (step.enter) {
            runTmux(['copy-mode', '-t', `${sessionName}:0.0`]);
          }
          if (step.exit) {
            runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'cancel']);
          }

          const repeatAction = async (action, count) => {
            const n = Number(count);
            if (!Number.isFinite(n) || n <= 0) {
              throw new Error(`Invalid copyMode count`);
            }
            for (let idx = 0; idx < n; idx += 1) {
              runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', action]);
              await sleep(80);
            }
          };

          if (step.pageUp) await repeatAction('page-up', step.pageUp);
          if (step.pageDown) await repeatAction('page-down', step.pageDown);
          if (step.up) await repeatAction('cursor-up', step.up);
          if (step.down) await repeatAction('cursor-down', step.down);
          break;
        }
        case 'capture': {
          const label =
            typeof step.label === 'string' ? step.label : `capture_${i}`;
          const scrollbackLines = Number(
            step.scrollbackLines ?? defaults.scrollbackLines,
          );
          const safe = sanitizeLabel(`${String(i).padStart(3, '0')}-${label}`);

          if (step.scope === 'screen') {
            const screen = captureScreen(sessionName);
            await fs.writeFile(
              path.join(outDir, `${safe}-screen.txt`),
              screen,
              'utf8',
            );
          } else if (step.scope === 'scrollback') {
            const scrollback = captureScrollback(sessionName, scrollbackLines);
            await fs.writeFile(
              path.join(outDir, `${safe}-scrollback.txt`),
              scrollback,
              'utf8',
            );
          } else {
            await captureArtifacts({
              sessionName,
              outDir,
              label: safe,
              scrollbackLines,
            });
          }
          break;
        }
        case 'waitFor': {
          const matcher = compileMatcher(step);
          const timeoutMs = Number(step.timeoutMs ?? defaults.timeoutMs);
          const pollMs = Number(step.pollMs ?? defaults.pollMs);
          const scope = step.scope === 'scrollback' ? 'scrollback' : 'screen';
          const scrollbackLines = Number(
            step.scrollbackLines ?? defaults.scrollbackLines,
          );
          await waitFor({
            sessionName,
            scope,
            matcher,
            timeoutMs,
            pollMs,
            scrollbackLines,
            description: `step ${i} (${formatMatcher(matcher)})`,
          });
          break;
        }
        case 'expect': {
          const matcher = compileMatcher(step);
          const scope = step.scope === 'scrollback' ? 'scrollback' : 'screen';
          const scrollbackLines = Number(
            step.scrollbackLines ?? defaults.scrollbackLines,
          );
          const text =
            scope === 'scrollback'
              ? captureScrollback(sessionName, scrollbackLines)
              : captureScreen(sessionName);

          if (step.lineNumber !== undefined) {
            const n = Number(step.lineNumber);
            if (!Number.isFinite(n) || n <= 0) {
              throw new Error(`Invalid expect.lineNumber`);
            }
            const lines = text.split('\n');
            const line = lines[n - 1] ?? '';
            if (!matchText(line, matcher)) {
              throw new Error(
                `Expected ${formatMatcher(matcher)} on ${scope} line ${n}`,
              );
            }
          } else if (!matchText(text, matcher)) {
            throw new Error(`Expected ${formatMatcher(matcher)} in ${scope}`);
          }
          break;
        }
        case 'expectCount': {
          const matcher = compileMatcher(step);
          const scope = step.scope === 'scrollback' ? 'scrollback' : 'screen';
          const scrollbackLines = Number(
            step.scrollbackLines ?? defaults.scrollbackLines,
          );
          const text =
            scope === 'scrollback'
              ? captureScrollback(sessionName, scrollbackLines)
              : captureScreen(sessionName);
          const count = countMatches(text, matcher);

          if (step.equals !== undefined && count !== Number(step.equals)) {
            throw new Error(
              `Expected count == ${step.equals} but got ${count}`,
            );
          }
          if (step.atLeast !== undefined && count < Number(step.atLeast)) {
            throw new Error(
              `Expected count >= ${step.atLeast} but got ${count}`,
            );
          }
          if (step.atMost !== undefined && count > Number(step.atMost)) {
            throw new Error(
              `Expected count <= ${step.atMost} but got ${count}`,
            );
          }
          break;
        }
        case 'approveShell': {
          const timeoutMs = Number(step.timeoutMs ?? defaults.timeoutMs);
          await waitFor({
            sessionName,
            scope: 'screen',
            matcher: { kind: 'contains', value: 'Shell Command Execution' },
            timeoutMs,
            pollMs: 200,
            scrollbackLines: defaults.scrollbackLines,
            description: `step ${i} (shell confirmation dialog)`,
          });

          const choice = step.choice ?? 'once';
          if (choice === 'once') {
            await sendKeys(['Enter']);
          } else if (choice === 'always') {
            await sendKeys(['Down', 'Enter']);
          } else if (choice === 'no') {
            await sendKeys(['Down', 'Down', 'Enter']);
          } else {
            throw new Error(`Invalid approveShell.choice`);
          }
          break;
        }
        case 'approveTool': {
          const timeoutMs = Number(step.timeoutMs ?? defaults.timeoutMs);
          const confirmMatcher = step.confirmation
            ? compileMatcher(step.confirmation)
            : { kind: 'contains', value: 'Yes, allow once' };

          await waitFor({
            sessionName,
            scope: 'screen',
            matcher: confirmMatcher,
            timeoutMs,
            pollMs: 200,
            scrollbackLines: defaults.scrollbackLines,
            description: `step ${i} (tool confirmation)`,
          });

          const choice = step.choice ?? 'once';
          if (choice === 'once') {
            await sendKeys(['Enter']);
          } else if (choice === 'always') {
            const screen = captureScreen(sessionName);
            if (!screen.includes('Yes, allow always')) {
              throw new Error(
                `Requested choice "always" but no "Yes, allow always" option is visible`,
              );
            }
            await sendKeys(['Down', 'Enter']);
          } else if (choice === 'no') {
            await sendKeys(['Down', 'Down', 'Enter']);
          } else {
            throw new Error(`Invalid approveTool.choice`);
          }
          break;
        }
        case 'historySample': {
          scriptState.historySamples.push({
            tMs: Date.now(),
            historySize: getHistorySize(sessionName),
            label: typeof step.label === 'string' ? step.label : `sample_${i}`,
          });
          break;
        }
        case 'waitForExit': {
          const timeoutMs = Number(step.timeoutMs ?? 15000);
          const exited = await waitForPaneDead(sessionName, timeoutMs);
          if (!exited) {
            throw new Error(`Timed out waiting for exit`);
          }
          break;
        }
        default:
          throw new Error(`Unknown step.type: ${step.type}`);
      }
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

  const sentinel = 'SCROLLTEST LINE 0001';

  // Produce incremental output for ~15s so the UI updates repeatedly while the
  // output grows beyond a small terminal height.
  const cmd =
    '!node -e \'let i=0; const total=60; const ms=250; const t=setInterval(() => { i++; console.log("SCROLLTEST LINE " + String(i).padStart(4, "0")); if (i>=total) { clearInterval(t); } }, ms);\'';
  await typeLineAndSubmit(cmd, { enterRepeats: 1, escapeBeforeEnter: false });

  // If the shell command triggers a confirmation dialog (non-YOLO mode), accept
  // the default selection ("Yes, allow once") so the scenario can proceed.
  await sleep(600);
  const maybeDialog = runTmux(['capture-pane', '-p', '-t', sessionName]);
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

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  await fs.writeFile(
    path.join(outDir, 'history-samples.json'),
    JSON.stringify(historySamples, null, 2),
    'utf8',
  );

  return { kind: 'scrollback', sentinel, historySamples };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionName = `llxprt_oldui_${Date.now().toString(16)}`;
  const outDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : path.join(os.tmpdir(), `llxprt-oldui-tmux-harness-${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const script = options.scriptPath
    ? JSON.parse(
        await fs.readFile(
          path.resolve(process.cwd(), options.scriptPath),
          'utf8',
        ),
      )
    : null;

  const tmuxCols = options.cols ?? script?.tmux?.cols ?? 120;
  const tmuxRows = options.rows ?? script?.tmux?.rows ?? 40;
  const initialWaitMs =
    options.initialWaitMs ?? script?.tmux?.initialWaitMs ?? 6000;
  const historyLimit =
    options.historyLimit ?? script?.tmux?.historyLimit ?? 50000;

  // Ensure no stale session with the same name (unlikely, but safe).
  tryTmux(['kill-session', '-t', sessionName]);

  // Start LLxprt in interactive mode (no piped stdin).
  const startArgs = Array.isArray(script?.startCommand)
    ? script.startCommand
    : ['node', 'scripts/start.js'];
  const shouldYolo = Boolean(options.yolo || script?.yolo);
  if (shouldYolo && !startArgs.includes('--yolo')) {
    startArgs.push('--yolo');
  }
  runTmux([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-x',
    String(tmuxCols),
    '-y',
    String(tmuxRows),
    ...startArgs,
  ]);
  // Keep the session around after the command exits so we can capture the final
  // screen and scrollback even if /quit exits quickly.
  runTmux(['set-option', '-t', `${sessionName}:0`, 'remain-on-exit', 'on']);
  runTmux([
    'set-option',
    '-t',
    `${sessionName}:0`,
    'history-limit',
    String(historyLimit),
  ]);

  // Let Ink render the initial UI.
  await sleep(initialWaitMs);

  const typeLineAndSubmit = async (
    line,
    { postTypeMs = 600, enterRepeats = 1, escapeBeforeEnter = true } = {},
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

  let scenarioResult;
  const scenario = options.scenario ?? 'haiku';
  try {
    if (script?.steps) {
      await runScriptSteps({
        sessionName,
        outDir,
        steps: script.steps,
        defaults: {
          postTypeMs: 600,
          submitKeys: ['Escape', 'Enter'],
          shellSubmitKeys: ['Enter', 'Enter'],
          timeoutMs: 15000,
          pollMs: 250,
          scrollbackLines:
            options.scrollbackLines ?? script?.tmux?.scrollbackLines ?? 2000,
        },
      });
      scenarioResult = { kind: 'script' };
    } else if (scenario === 'haiku') {
      scenarioResult = await runScenarioHaiku({
        sessionName,
        typeLineAndSubmit,
      });
    } else if (scenario === 'scrollback') {
      scenarioResult = await runScenarioScrollback({
        sessionName,
        typeLineAndSubmit,
        outDir,
      });
    } else {
      throw new Error(`Unhandled scenario: ${scenario}`);
    }
  } catch (error) {
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
    throw error;
  }

  // Give the process time to exit cleanly (pane should become "dead").
  const exited = await waitForPaneDead(sessionName, 15000);

  // Capture both visible screen and some scrollback for inspection.
  const screen = captureScreen(sessionName);
  const scrollbackLines =
    scenario === 'scrollback'
      ? 20000
      : (options.scrollbackLines ?? script?.tmux?.scrollbackLines ?? 2000);
  const scrollback = captureScrollback(sessionName, scrollbackLines);
  await fs.writeFile(path.join(outDir, 'screen.txt'), screen, 'utf8');
  await fs.writeFile(path.join(outDir, 'scrollback.txt'), scrollback, 'utf8');

  if (scenarioResult?.kind === 'scrollback') {
    const sentinelCount =
      scrollback.match(new RegExp(scenarioResult.sentinel, 'g'))?.length ?? 0;
    const tipsCount =
      scrollback.match(/Tips for getting started:/g)?.length ?? 0;

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
            cols: tmuxCols,
            rows: tmuxRows,
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
        },
        null,
        2,
      ),
      'utf8',
    );
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
