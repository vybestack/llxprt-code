/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight bootstrap utilities for CLI startup.
 * These functions are designed to run BEFORE any heavy initialization
 * (settings loading, provider configuration, MCP servers, etc.)
 * to determine if the process needs to be relaunched.
 */

import v8 from 'node:v8';
import os from 'node:os';

/**
 * Exit code used to signal that the child process wants a relaunch.
 * The parent process should check for this code and respawn if needed.
 */
export const RELAUNCH_EXIT_CODE = 75;

/**
 * Check if debug mode is enabled via environment variables.
 * This is a lightweight check that doesn't require loading any configuration.
 */
export function isDebugMode(): boolean {
  return [process.env.DEBUG, process.env.DEBUG_MODE].some(
    (v) => v === 'true' || v === '1',
  );
}

/**
 * Determine if the process should be relaunched with higher memory limits.
 * This check is performed BEFORE loading any configuration to avoid
 * wasting time on initialization that would be discarded during relaunch.
 *
 * @param debugMode - Whether to log debug information
 * @returns Array of Node.js arguments for relaunch, or empty array if no relaunch needed
 */
export function shouldRelaunchForMemory(debugMode: boolean): string[] {
  const totalMemoryMB = os.totalmem() / (1024 * 1024);
  const heapStats = v8.getHeapStatistics();
  const currentMaxOldSpaceSizeMb = Math.floor(
    heapStats.heap_size_limit / 1024 / 1024,
  );

  // Set target to 50% of total memory
  const targetMaxOldSpaceSizeInMB = Math.floor(totalMemoryMB * 0.5);

  if (debugMode) {
    console.debug(
      `Current heap size ${currentMaxOldSpaceSizeMb.toFixed(2)} MB`,
    );
  }

  // Guard against infinite relaunch loops
  if (process.env.LLXPRT_CODE_NO_RELAUNCH) {
    return [];
  }

  if (targetMaxOldSpaceSizeInMB > currentMaxOldSpaceSizeMb) {
    if (debugMode) {
      console.debug(
        `Need to relaunch with more memory: ${targetMaxOldSpaceSizeInMB.toFixed(2)} MB`,
      );
    }
    return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
  }

  return [];
}

/**
 * Parse a Docker/Podman memory format string into megabytes.
 * Docker format: plain number = bytes, k = kilobytes, m = megabytes, g = gigabytes.
 *
 * @param memoryStr - Memory string in Docker format (e.g. "6g", "4096m", "1073741824")
 * @returns Memory in MB, or undefined if unparseable
 */
export function parseDockerMemoryToMB(memoryStr: string): number | undefined {
  if (!memoryStr) {
    return undefined;
  }

  const match = memoryStr.match(/^(\d+(?:\.\d+)?)\s*([bkmg])?$/i);
  if (!match) {
    return undefined;
  }

  const value = parseFloat(match[1]);
  const suffix = (match[2] ?? '').toLowerCase();

  switch (suffix) {
    case 'g':
      return value * 1024;
    case 'm':
      return value;
    case 'k':
      return value / 1024;
    case 'b':
    default:
      // Plain number or 'b' suffix is bytes
      return value / (1024 * 1024);
  }
}

/**
 * Compute --max-old-space-size for a NEW sandbox process.
 * Unlike shouldRelaunchForMemory(), this ALWAYS returns memory args
 * because the sandbox process starts fresh with Node.js defaults (~950MB).
 *
 * @param debugMode - Whether to log debug information
 * @param containerMemoryMB - Container memory limit in MB, or undefined to use host memory
 * @returns Array containing a single --max-old-space-size argument
 */
export function computeSandboxMemoryArgs(
  debugMode: boolean,
  containerMemoryMB?: number,
): string[] {
  const totalMemoryMB = containerMemoryMB ?? os.totalmem() / (1024 * 1024);
  const targetMaxOldSpaceSizeInMB = Math.max(
    128,
    Math.floor(totalMemoryMB * 0.5),
  );

  if (debugMode) {
    console.debug(
      `Sandbox memory: total=${totalMemoryMB.toFixed(2)} MB, target heap=${targetMaxOldSpaceSizeInMB} MB`,
    );
  }

  return [`--max-old-space-size=${targetMaxOldSpaceSizeInMB}`];
}
