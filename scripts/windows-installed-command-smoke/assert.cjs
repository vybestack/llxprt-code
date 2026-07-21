'use strict';

/**
 * Assertion and step-runner helpers for the Windows installed-command smoke.
 * Shared across all check modules so failures are collected and reported in a
 * single summary rather than aborting on the first error.
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

function runStep(label, fn) {
  process.stdout.write(`[${label}] starting...\n`);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      // Async step: return the promise so the caller can await it. On success
      // print OK; on rejection, accumulate the failure (do not re-throw so
      // parallel steps do not unhandled-reject).
      return result.then(
        () => {
          process.stdout.write(`[${label}] OK\n`);
        },
        (err) => {
          fail(`${label}: ${err.message}`);
        },
      );
    }
    process.stdout.write(`[${label}] OK\n`);
    return undefined;
  } catch (err) {
    fail(`${label}: ${err.message}`);
    return undefined;
  }
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
  resetState,
  getState,
};
