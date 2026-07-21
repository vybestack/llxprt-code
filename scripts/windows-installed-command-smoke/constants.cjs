'use strict';

/**
 * Shared constants for the Windows installed-command smoke harness.
 */

const CONSTRAINED_PATH =
  'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem';
const OWNERSHIP_SENTINEL =
  'LLXPRT_NATIVE_LAUNCHER owned by @vybestack/llxprt-code';
const VERSION_RE = /^\d+\.\d+\.\d+/;
const LAUNCH_ERROR_EXIT = 43;

module.exports = {
  CONSTRAINED_PATH,
  OWNERSHIP_SENTINEL,
  VERSION_RE,
  LAUNCH_ERROR_EXIT,
};
