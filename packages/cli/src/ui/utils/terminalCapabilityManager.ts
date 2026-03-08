/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import {
  enableKittyKeyboardProtocol,
  disableKittyKeyboardProtocol,
  enableModifyOtherKeys,
  disableModifyOtherKeys,
  enableBracketedPasteMode,
  disableBracketedPasteMode,
} from '@vybestack/llxprt-code-core';

export type TerminalBackgroundColor = string | undefined;

export class TerminalCapabilityManager {
  private static instance: TerminalCapabilityManager | undefined;

  private static readonly KITTY_QUERY = '\x1b[?u';
  private static readonly OSC_11_QUERY = '\x1b]11;?\x1b\\';
  private static readonly TERMINAL_NAME_QUERY = '\x1b[>q';
  private static readonly DEVICE_ATTRIBUTES_QUERY = '\x1b[c';

  // Kitty keyboard flags: CSI ? flags u
  // eslint-disable-next-line no-control-regex
  private static readonly KITTY_REGEX = /\x1b\[\?(\d+)u/;
  // Terminal Name/Version response: DCS > | text ST (or BEL)
  // eslint-disable-next-line no-control-regex
  private static readonly TERMINAL_NAME_REGEX = /\x1bP>\|(.+?)(\x1b\\|\x07)/;
  // Primary Device Attributes: CSI ? ID ; ... c
  // eslint-disable-next-line no-control-regex
  private static readonly DEVICE_ATTRIBUTES_REGEX = /\x1b\[\?(\d+)(;\d+)*c/;
  // ModifyOtherKeys query and response
  private static readonly MODIFY_OTHER_KEYS_QUERY = '\x1b[>4;?m';
  // eslint-disable-next-line no-control-regex
  private static readonly MODIFY_OTHER_KEYS_REGEX = /\x1b\[>4;(\d+)m/;
  // Bracketed paste mode query (DECRQM) and response (DECRPM)
  private static readonly BRACKETED_PASTE_QUERY = '\x1b[?2004$p';
  // eslint-disable-next-line no-control-regex
  private static readonly BRACKETED_PASTE_REGEX = /\x1b\[\?2004;([1-4])\$y/;
  // OSC 11 response: OSC 11 ; rgb:rrrr/gggg/bbbb ST (or BEL)
  private static readonly OSC_11_REGEX =
    // eslint-disable-next-line no-control-regex
    /\x1b\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})(\x1b\\|\x07)?/;

  private terminalBackgroundColor: TerminalBackgroundColor;
  private kittySupported = false;
  private kittyEnabled = false;
  private modifyOtherKeysSupported = false;
  private modifyOtherKeysEnabled = false;
  private bracketedPasteSupported = false;
  private bracketedPasteEnabled = false;
  private detectionComplete = false;
  private terminalName: string | undefined;

  private constructor() {}

  static getInstance(): TerminalCapabilityManager {
    if (!this.instance) {
      this.instance = new TerminalCapabilityManager();
    }
    return this.instance;
  }

  static resetInstanceForTesting(): void {
    this.instance = undefined;
  }

  /**
   * Detects terminal capabilities (Kitty protocol support, terminal name,
   * background color).
   * This should be called once at app startup.
   */
  async detectCapabilities(): Promise<void> {
    if (this.detectionComplete) return;

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.detectionComplete = true;
      return;
    }

    return new Promise((resolve) => {
      const cleanupOnExit = () => {
        disableKittyKeyboardProtocol();
        disableModifyOtherKeys();
        disableBracketedPasteMode();
      };
      process.on('exit', cleanupOnExit);
      process.on('SIGTERM', cleanupOnExit);
      process.on('SIGINT', cleanupOnExit);

      const originalRawMode = process.stdin.isRaw;
      if (!originalRawMode) {
        process.stdin.setRawMode(true);
      }

      let buffer = '';
      let kittyKeyboardReceived = false;
      let terminalNameReceived = false;
      let deviceAttributesReceived = false;
      let bgReceived = false;
      // eslint-disable-next-line prefer-const
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        process.stdin.removeListener('data', onData);
        if (!originalRawMode) {
          process.stdin.setRawMode(false);
        }
        this.detectionComplete = true;

        // Auto-enable supported modes
        this.enableSupportedModes();

        resolve();
      };

      const onTimeout = () => {
        cleanup();
      };

      // A somewhat long timeout is acceptable as all terminals should respond
      // to the device attributes query used as a sentinel.
      timeoutId = setTimeout(onTimeout, 1000);

      const onData = (data: Buffer) => {
        buffer += data.toString();

        // Check OSC 11
        if (!bgReceived) {
          const match = buffer.match(TerminalCapabilityManager.OSC_11_REGEX);
          if (match) {
            bgReceived = true;
            this.terminalBackgroundColor = this.parseColor(
              match[1],
              match[2],
              match[3],
            );
          }
        }

        if (
          !kittyKeyboardReceived &&
          TerminalCapabilityManager.KITTY_REGEX.test(buffer)
        ) {
          kittyKeyboardReceived = true;
          this.kittySupported = true;
        }

        // Check for Terminal Name/Version response.
        if (!terminalNameReceived) {
          const match = buffer.match(
            TerminalCapabilityManager.TERMINAL_NAME_REGEX,
          );
          if (match) {
            terminalNameReceived = true;
            this.terminalName = match[1];
          }
        }

        // Check for ModifyOtherKeys support
        const modifyOtherKeysMatch = buffer.match(
          TerminalCapabilityManager.MODIFY_OTHER_KEYS_REGEX,
        );
        if (modifyOtherKeysMatch) {
          const level = parseInt(modifyOtherKeysMatch[1], 10);
          if (level >= 2) {
            this.modifyOtherKeysSupported = true;
          }
        }

        // Check for Bracketed Paste Mode support (DECRPM response)
        const bracketedPasteMatch = buffer.match(
          TerminalCapabilityManager.BRACKETED_PASTE_REGEX,
        );
        if (bracketedPasteMatch) {
          const mode = parseInt(bracketedPasteMatch[1], 10);
          // mode 1 = set, mode 2 = reset (both mean supported)
          if (mode === 1 || mode === 2) {
            this.bracketedPasteSupported = true;
          }
        }

        // We use the Primary Device Attributes response as a sentinel to know
        // that the terminal has processed all our queries. Since we send it
        // last, receiving it means we can stop waiting.
        if (!deviceAttributesReceived) {
          const match = buffer.match(
            TerminalCapabilityManager.DEVICE_ATTRIBUTES_REGEX,
          );
          if (match) {
            deviceAttributesReceived = true;
            cleanup();
          }
        }
      };

      process.stdin.on('data', onData);

      try {
        fs.writeSync(
          process.stdout.fd,
          TerminalCapabilityManager.KITTY_QUERY +
            TerminalCapabilityManager.OSC_11_QUERY +
            TerminalCapabilityManager.TERMINAL_NAME_QUERY +
            TerminalCapabilityManager.MODIFY_OTHER_KEYS_QUERY +
            TerminalCapabilityManager.BRACKETED_PASTE_QUERY +
            TerminalCapabilityManager.DEVICE_ATTRIBUTES_QUERY,
        );
      } catch (_e) {
        cleanup();
      }
    });
  }

  getTerminalBackgroundColor(): TerminalBackgroundColor {
    return this.terminalBackgroundColor;
  }

  getTerminalName(): string | undefined {
    return this.terminalName;
  }

  isKittyProtocolEnabled(): boolean {
    return this.kittyEnabled;
  }

  enableKittyProtocol(): void {
    try {
      if (this.kittySupported) {
        enableKittyKeyboardProtocol();
        this.kittyEnabled = true;
      }
    } catch (_e) {
      // Ignore errors during enable (terminal may not support these modes)
    }
  }

  disableKittyProtocol(): void {
    try {
      if (this.kittyEnabled) {
        disableKittyKeyboardProtocol();
        this.kittyEnabled = false;
      }
    } catch (_e) {
      // Ignore errors during disable (terminal may already be closed)
    }
  }

  enableSupportedModes(): void {
    try {
      if (this.kittySupported) {
        enableKittyKeyboardProtocol();
        this.kittyEnabled = true;
      } else if (this.modifyOtherKeysSupported) {
        enableModifyOtherKeys();
        this.modifyOtherKeysEnabled = true;
      }
      if (this.bracketedPasteSupported) {
        enableBracketedPasteMode();
        this.bracketedPasteEnabled = true;
      }
    } catch (_e) {
      // Ignore errors during enable
    }
  }

  isBracketedPasteSupported(): boolean {
    return this.bracketedPasteSupported;
  }

  isBracketedPasteEnabled(): boolean {
    return this.bracketedPasteEnabled;
  }

  isModifyOtherKeysEnabled(): boolean {
    return this.modifyOtherKeysEnabled;
  }

  private parseColor(rHex: string, gHex: string, bHex: string): string {
    const parseComponent = (hex: string) => {
      const val = parseInt(hex, 16);
      if (hex.length === 1) return (val / 15) * 255;
      if (hex.length === 2) return val;
      if (hex.length === 3) return (val / 4095) * 255;
      if (hex.length === 4) return (val / 65535) * 255;
      return val;
    };

    const r = parseComponent(rHex);
    const g = parseComponent(gHex);
    const b = parseComponent(bHex);

    const toHex = (c: number) => Math.round(c).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
}

export const terminalCapabilityManager =
  TerminalCapabilityManager.getInstance();