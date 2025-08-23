/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P06
 * @requirement REQ-001.1, REQ-001.2, REQ-001.3
 * @pseudocode lines 29-37
 */
export class ClipboardService {
  /**
   * Copy text to clipboard using platform-specific utilities
   * @plan PLAN-20250822-GEMINIFALLBACK.P06
   * @requirement REQ-001.1
   * @pseudocode lines 29-30
   */
  async copyToClipboard(text: string): Promise<void> {
    const run = (cmd: string, args: string[]): Promise<void> =>
      new Promise<void>((resolveInner, rejectInner) => {
        const child = spawn(cmd, args);
        let stderr = '';
        child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
        child.on('error', rejectInner);
        child.on('close', (code) => {
          if (code === 0) return resolveInner();
          const errorMsg = stderr.trim();
          rejectInner(
            new Error(
              `'${cmd}' exited with code ${code}${errorMsg ? `: ${errorMsg}` : ''}`,
            ),
          );
        });
        child.stdin.on('error', rejectInner);
        child.stdin.write(text);
        child.stdin.end();
      });

    return new Promise((resolve, reject) => {
      /**
       * @plan PLAN-20250822-GEMINIFALLBACK.P06
       * @requirement REQ-001.2
       * @pseudocode lines 31-36
       */
      switch (process.platform) {
        case 'win32':
          // Windows: clip
          run('clip', []).then(resolve).catch(reject);
          break;
        case 'darwin':
          // macOS: pbcopy
          run('pbcopy', []).then(resolve).catch(reject);
          break;
        case 'linux':
          // Linux: try xclip first, then wl-copy (Wayland) as fallback
          run('xclip', ['-selection', 'clipboard'])
            .then(resolve)
            .catch(() => {
              // Try wl-copy as fallback for Wayland
              run('wl-copy', []).then(resolve).catch(reject);
            });
          break;
        default:
          reject(new Error(`Unsupported platform: ${process.platform}`));
          break;
      }
    });
  }
}
