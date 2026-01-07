/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

let detectionComplete = false;
let protocolSupported = false;
let protocolEnabled = false;

function enableProtocolSequence() {
  process.stdout.write('\x1b[>1u');
  protocolEnabled = true;
}

/**
 * Detects Kitty keyboard protocol support.
 * Definitive document about this protocol lives at https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 * This function should be called once at app startup.
 */
export async function detectAndEnableKittyProtocol(): Promise<boolean> {
  if (detectionComplete) {
    return protocolSupported;
  }

  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      detectionComplete = true;
      resolve(false);
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
        resolve(false);
        return;
      }
    }

    let responseBuffer = '';
    let progressiveEnhancementReceived = false;
    let checkFinished = false;

    const handleData = (data: Buffer) => {
      responseBuffer += data.toString();

      // Check for progressive enhancement response (CSI ? <flags> u)
      if (responseBuffer.includes('\x1b[?') && responseBuffer.includes('u')) {
        progressiveEnhancementReceived = true;
      }

      // Check for device attributes response (CSI ? <attrs> c)
      if (responseBuffer.includes('\x1b[?') && responseBuffer.includes('c')) {
        if (!checkFinished) {
          checkFinished = true;
          process.stdin.removeListener('data', handleData);

          if (!originalRawMode) {
            try {
              process.stdin.setRawMode(false);
            } catch (_err) {
              // Restore failed, but protocol detection is complete
              // Log only in debug mode (if we had access to config)
            }
          }

          if (progressiveEnhancementReceived) {
            protocolSupported = true;
            enableProtocolSequence();

            // Set up cleanup on exit
            process.on('exit', disableProtocol);
            process.on('SIGTERM', disableProtocol);
          }

          detectionComplete = true;
          resolve(protocolSupported);
        }
      }
    };

    // Issue #1020: Add a minimal error handler for the protocol detection window
    // Since we're only temporarily switching to raw mode, we just need to prevent crashes
    const handleDetectionError = (_err: Error) => {
      // Don't crash the process during protocol detection
      // Just log and continue
      if (!checkFinished) {
        checkFinished = true;
        process.stdin.removeListener('data', handleData);
        process.stdin.removeListener('error', handleDetectionError);

        if (!originalRawMode) {
          try {
            process.stdin.setRawMode(false);
          } catch {
            // Ignore restore failures
          }
        }
        detectionComplete = true;
        resolve(false);
      }
    };

    process.stdin.on('data', handleData);
    process.stdin.on('error', handleDetectionError);

    // Send queries
    process.stdout.write('\x1b[?u'); // Query progressive enhancement
    process.stdout.write('\x1b[c'); // Query device attributes

    // Timeout after 50ms
    setTimeout(() => {
      if (!checkFinished) {
        process.stdin.removeListener('data', handleData);
        process.stdin.removeListener('error', handleDetectionError);
        if (!originalRawMode) {
          try {
            process.stdin.setRawMode(false);
          } catch (_err) {
            // Ignore restore failures
          }
        }
        detectionComplete = true;
        resolve(false);
      }
    }, 50);
  });
}

function disableProtocol() {
  if (protocolEnabled) {
    process.stdout.write('\x1b[<u');
    protocolEnabled = false;
  }
}

export function enableSupportedProtocol(): void {
  if (!protocolSupported) {
    return;
  }
  enableProtocolSequence();
}

export function isKittyProtocolEnabled(): boolean {
  return protocolEnabled;
}

export function isKittyProtocolSupported(): boolean {
  return protocolSupported;
}
