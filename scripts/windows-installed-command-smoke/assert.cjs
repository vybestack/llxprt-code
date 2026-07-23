'use strict';

/**
 * Assertion and step-runner helpers for the Windows installed-command smoke.
 * Shared across all check modules so failures are collected and reported in a
 * single summary rather than aborting on the first error.
 *
 * Two kinds of steps are supported:
 *   - runStep: a behavioral CHECK. Failures are accumulated and reported in
 *     the summary; the harness continues to the next independent check so a
 *     single broken assertion does not hide others. This is the right tool
 *     for the 23 behavioral probe checks.
 *   - runRequiredStep: a setup PREREQUISITE. If it fails, the caller MUST
 *     abort subsequent dependent steps — continuing would produce a cascade of
 *     confusing downstream failures (e.g. a global-install timeout cascading
 *     into 30 "launcher not found" failures, as seen in CI run 29850614559).
 *     runRequiredStep logs then RETHROWS so the top-level orchestrator can
 *     record the single root cause once and stop.
 *
 * runStep "OK" semantics:
 *   A step is only "OK" when NO failure was recorded DURING that step. We
 *   snapshot the failure count before invoking fn; if it grew, the step
 *   triggered fail() (the non-throwing assert path) and must NOT print OK.
 *   This fixes the bug where checkCmdExitCodePreservation called assert() for
 *   each exit code, accumulated failures, and still printed "[step] OK".
 */

let failed = false;
const failures = [];

function fail(msg) {
  failed = true;
  failures.push(msg);
  console.error('FAIL: ' + msg);
}

function assert(condition, msg) {
  if (!condition) fail(msg);
  return condition;
}

/**
 * Prints "[label] OK" only when the failure count did NOT increase during fn.
 * Snapshots the count before/after so a non-throwing assert() (which calls
 * fail() without throwing) is correctly reflected as a non-OK step.
 */
function runStep(label, fn) {
  process.stdout.write(`[${label}] starting...\n`);
  const before = failures.length;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      // Async step: return the promise so the caller can await it. On success
      // print OK only if no failure was recorded during the async body.
      return result.then(
        () => {
          if (failures.length === before) {
            process.stdout.write(`[${label}] OK\n`);
          } else {
            process.stdout.write(`[${label}] FAIL\n`);
          }
        },
        (err) => {
          const msg =
            err && typeof err.message === 'string' ? err.message : String(err);
          fail(`${label}: ${msg}`);
          process.stdout.write(`[${label}] FAIL\n`);
        },
      );
    }
    if (failures.length === before) {
      process.stdout.write(`[${label}] OK\n`);
    } else {
      process.stdout.write(`[${label}] FAIL\n`);
    }
    return undefined;
  } catch (err) {
    const msg =
      err && typeof err.message === 'string' ? err.message : String(err);
    fail(`${label}: ${msg}`);
    process.stdout.write(`[${label}] FAIL
`);
    return undefined;
  }
}

/**
 * Runs a REQUIRED setup step. Logs the step, then — unlike runStep — RETHROWS
 * on any error so the top-level orchestrator's try/catch records the single
 * root cause once and aborts dependent work. This prevents a setup failure
 * (e.g. npm global install timeout) from cascading into dozens of misleading
 * downstream failures.
 *
 * A non-throwing fail() during a required step is also treated as fatal: we
 * throw an AssertionError summarizing any failures recorded since the
 * snapshot.
 */
function runRequiredStep(label, fn) {
  process.stdout.write(`[${label}] starting...\n`);
  const before = failures.length;
  let result;
  try {
    result = fn();
  } catch (err) {
    const msg =
      err && typeof err.message === 'string' ? err.message : String(err);
    fail(`${label}: ${msg}`);
    process.stdout.write(`[${label}] FAIL\n`);
    if (failures.length !== before) {
      const recent = failures.slice(before).join('; ');
      const assertionErr = new Error(
        `required step "${label}" recorded failure(s): ${recent}`,
      );
      assertionErr.name = 'AssertionError';
      throw Object.assign(assertionErr, { cause: err });
    }
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      (v) => {
        if (failures.length !== before) {
          const recent = failures.slice(before).join('; ');
          process.stdout.write(`[${label}] FAIL\n`);
          const err = new Error(
            `required step "${label}" recorded failure(s): ${recent}`,
          );
          err.name = 'AssertionError';
          throw err;
        }
        process.stdout.write(`[${label}] OK\n`);
        return v;
      },
      (err) => {
        const msg =
          err && typeof err.message === 'string' ? err.message : String(err);
        fail(`${label}: ${msg}`);
        process.stdout.write(`[${label}] FAIL\n`);
        throw err;
      },
    );
  }
  if (failures.length !== before) {
    const recent = failures.slice(before).join('; ');
    process.stdout.write(`[${label}] FAIL\n`);
    const err = new Error(
      `required step "${label}" recorded failure(s): ${recent}`,
    );
    err.name = 'AssertionError';
    throw err;
  }
  process.stdout.write(`[${label}] OK\n`);
  return result;
}

function resetState() {
  failed = false;
  failures.length = 0;
}

function getState() {
  return { failed, failures: [...failures] };
}

module.exports = {
  fail,
  assert,
  runStep,
  runRequiredStep,
  resetState,
  getState,
};
