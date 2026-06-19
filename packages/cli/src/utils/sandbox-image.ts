/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { debugLogger } from '@vybestack/llxprt-code-core';

const LOCAL_DEV_SANDBOX_IMAGE_NAME = 'llxprt-code-sandbox';

async function imageExists(sandbox: string, image: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['images', '-q', image];
    const checkProcess = spawn(sandbox, args);

    let stdoutData = '';
    checkProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    checkProcess.on('error', (err) => {
      debugLogger.warn(
        `Failed to start '${sandbox}' command for image check: ${err.message}`,
      );
      resolve(false);
    });

    checkProcess.on('close', () => {
      // Non-zero code might indicate docker daemon not running, etc.
      // The primary success indicator is non-empty stdoutData.
      resolve(stdoutData.trim() !== '');
    });
  });
}

async function pullImage(sandbox: string, image: string): Promise<boolean> {
  debugLogger.log(`Attempting to pull image ${image} using ${sandbox}...`);
  return new Promise((resolve) => {
    const args = ['pull', image];
    const pullProcess = spawn(sandbox, args, { stdio: 'pipe' });

    let stderrData = '';

    const onStdoutData = (data: Buffer) => {
      debugLogger.log(data.toString().trim()); // Show pull progress
    };

    const onStderrData = (data: Buffer) => {
      stderrData += data.toString();
      debugLogger.error(data.toString().trim()); // Show pull errors/info from the command itself
    };

    const onError = (err: Error) => {
      debugLogger.warn(
        `Failed to start '${sandbox} pull ${image}' command: ${err.message}`,
      );
      cleanup();
      resolve(false);
    };

    const onClose = (code: number | null) => {
      if (code === 0) {
        debugLogger.log(`Successfully pulled image ${image}.`);
        cleanup();
        resolve(true);
      } else {
        debugLogger.warn(
          `Failed to pull image ${image}. '${sandbox} pull ${image}' exited with code ${code}.`,
        );
        if (stderrData.trim() !== '') {
          // Details already printed by the stderr listener above
        }
        cleanup();
        resolve(false);
      }
    };

    const cleanup = () => {
      pullProcess.stdout.removeListener('data', onStdoutData);
      pullProcess.stderr.removeListener('data', onStderrData);
      pullProcess.removeListener('error', onError);
      pullProcess.removeListener('close', onClose);
      if (pullProcess.connected) {
        pullProcess.disconnect();
      }
    };

    pullProcess.stdout.on('data', onStdoutData);
    pullProcess.stderr.on('data', onStderrData);
    pullProcess.on('error', onError);
    pullProcess.on('close', onClose);
  });
}

export async function ensureSandboxImageIsPresent(
  sandbox: string,
  image: string,
): Promise<boolean> {
  debugLogger.log(`Checking for sandbox image: ${image}`);
  if (await imageExists(sandbox, image)) {
    debugLogger.log(`Sandbox image ${image} found locally.`);
    return true;
  }

  debugLogger.log(`Sandbox image ${image} not found locally.`);
  if (image === LOCAL_DEV_SANDBOX_IMAGE_NAME) {
    // user needs to build the image themselves
    return false;
  }

  if (await pullImage(sandbox, image)) {
    // After attempting to pull, check again to be certain
    if (await imageExists(sandbox, image)) {
      debugLogger.log(`Sandbox image ${image} is now available after pulling.`);
      return true;
    }
    debugLogger.warn(
      `Sandbox image ${image} still not found after a pull attempt. This might indicate an issue with the image name or registry, or the pull command reported success but failed to make the image available.`,
    );
    return false;
  }

  debugLogger.error(
    `Failed to obtain sandbox image ${image} after check and pull attempt.`,
  );
  return false; // Pull command failed or image still not present
}
