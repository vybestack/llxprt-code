/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';

let detectionComplete = false;

let kittySupported = false;
let sgrMouseSupported = false;

let kittyEnabled = false;
let sgrMouseEnabled = false;

/**
 * Detects Kitty keyboard protocol support.
 * Definitive document about this protocol lives at https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 * This function should be called once at app startup.
 */
export async function detectAndEnableKittyProtocol(): Promise<void> {
  if (detectionComplete) {
    return;
  }

  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      detectionComplete = true;
      resolve();
      return;
    }

    const originalRawMode = process.stdin.isRaw;
    if (!originalRawMode) {
      // Issue #1020: Wrap setRawMode with try-catch for error safety
      try {
        process.stdin.setRawMode(true);
      } catch (_err) {
        // If setRawMode fails, protocol detection cannot proceed
        detectionComplete = true;
        resolve();
        return;
      }
    }

    let responseBuffer = '';
    let progressiveEnhancementReceived = false;
    let timeoutId: NodeJS.Timeout | undefined;

    const finish = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      process.stdin.removeListener('data', handleData);
      process.stdin.removeListener('error', handleDetectionError);
      if (!originalRawMode) {
        try {
          process.stdin.setRawMode(false);
        } catch (_err) {
          // Ignore restore failures
        }
      }

      if (kittySupported || sgrMouseSupported) {
        enableSupportedProtocol();
        process.on('exit', disableAllProtocols);
      }

      detectionComplete = true;
      resolve();
    };

    const handleData = (data: Buffer) => {
      responseBuffer += data.toString();

      // Check for progressive enhancement response (CSI ? <flags> u)
      if (responseBuffer.includes('\x1b[?') && responseBuffer.includes('u')) {
        progressiveEnhancementReceived = true;
        // Give more time to get the full set of kitty responses if we have an
        // indication the terminal probably supports kitty and we just need to
        // wait a bit longer for a response.
        clearTimeout(timeoutId);
        timeoutId = setTimeout(finish, 1000);
      }

      // Check for device attributes response (CSI ? <attrs> c)
      if (responseBuffer.includes('\x1b[?') && responseBuffer.includes('c')) {
        if (progressiveEnhancementReceived) {
          kittySupported = true;
        }

        // Broaden mouse support by enabling SGR mode if we get any device
        // attribute response, which is a strong signal of a modern terminal.
        sgrMouseSupported = true;

        finish();
      }
    };

    // Issue #1020: Add a minimal error handler for the protocol detection window
    const handleDetectionError = (_err: Error) => {
      finish();
    };

    process.stdin.on('data', handleData);
    process.stdin.on('error', handleDetectionError);

    // Send queries (synchronous to avoid interleaving with async output)
    fs.writeSync(process.stdout.fd, '\x1b[?u\x1b[c');

    // Timeout after 200ms
    // When an iterm2 terminal does not have focus this can take over 90ms on a
    // fast macbook so we need a somewhat longer threshold than would be ideal.
    timeoutId = setTimeout(finish, 200);
  });
}

export function isKittyProtocolEnabled(): boolean {
  return kittyEnabled;
}

function disableAllProtocols() {
  try {
    if (kittyEnabled) {
      fs.writeSync(process.stdout.fd, '\x1b[<u');
      kittyEnabled = false;
    }
    if (sgrMouseEnabled) {
      fs.writeSync(process.stdout.fd, '\x1b[?1006l');
      sgrMouseEnabled = false;
    }
  } catch (_err) {
    // Ignore errors during disable (terminal may already be closed)
  }
}

/**
 * This is exported so we can reenable this after exiting an editor which might
 * change the mode.
 */
export function enableSupportedProtocol(): void {
  try {
    if (kittySupported) {
      fs.writeSync(process.stdout.fd, '\x1b[>1u');
      kittyEnabled = true;
    }
    if (sgrMouseSupported) {
      fs.writeSync(process.stdout.fd, '\x1b[?1006h');
      sgrMouseEnabled = true;
    }
  } catch (_err) {
    // Ignore errors during enable (terminal may not support these modes)
  }
}
