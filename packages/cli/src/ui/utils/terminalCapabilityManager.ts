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
  DebugLogger,
} from '@vybestack/llxprt-code-core';

const debugLogger = new DebugLogger('llxprt:terminal-capability');

export type TerminalBackgroundColor = string | undefined;

export class TerminalCapabilityManager {
  private static instance: TerminalCapabilityManager | undefined;

  private static readonly KITTY_QUERY = '\x1b[?u';
  private static readonly OSC_11_QUERY = '\x1b]11;?\x1b\\';
  private static readonly TERMINAL_NAME_QUERY = '\x1b[>q';
  private static readonly DEVICE_ATTRIBUTES_QUERY = '\x1b[c';
  private static readonly MODIFY_OTHER_KEYS_QUERY = '\x1b[>4;?m';

  private static readonly ESC = '\x1b';
  private static readonly BEL = '\x07';

  private detectionComplete = false;
  private terminalBackgroundColor: TerminalBackgroundColor;
  private kittySupported = false;
  private kittyEnabled = false;
  private modifyOtherKeysSupported?: boolean;
  private modifyOtherKeysEnabled = false;
  private bracketedPasteEnabled = false;
  private terminalName: string | undefined;
  private deviceAttributesSupported = false;
  private cleanupOnExitHandler?: () => void;
  private disableKittyProtocolOnExitHandler?: () => void;

  private constructor() {}

  static getInstance(): TerminalCapabilityManager {
    this.instance ??= new TerminalCapabilityManager();
    return this.instance;
  }

  static resetInstanceForTesting(): void {
    this.instance?.resetForTesting();
    this.instance = undefined;
  }

  /**
   * Detects terminal capabilities (Kitty protocol support, terminal name,
   * background color).
   * This should be called once at app startup.
   */
  async detectCapabilities(): Promise<void> {
    if (this.detectionComplete) return undefined;

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.detectionComplete = true;
      return undefined;
    }

    return this.runDetection();
  }

  private runDetection(): Promise<void> {
    return new Promise((resolve) => {
      this.removeProcessListeners();

      const cleanupOnExit = () => {
        disableKittyKeyboardProtocol();
        disableModifyOtherKeys();
        this.disableBracketedPasteMode();
      };
      this.cleanupOnExitHandler = cleanupOnExit;
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
      let modifyOtherKeysReceived = false;
      // eslint-disable-next-line prefer-const
      let timeoutId: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        process.stdin.removeListener('data', onData);
        if (!originalRawMode) {
          process.stdin.setRawMode(false);
        }
        this.detectionComplete = true;

        this.enableSupportedModes();
        if (this.kittyEnabled && !this.disableKittyProtocolOnExitHandler) {
          this.disableKittyProtocolOnExitHandler = () =>
            this.disableKittyProtocolOnExit();
          process.once('exit', this.disableKittyProtocolOnExitHandler);
        }

        resolve();
      };

      const onTimeout = () => {
        cleanup();
      };

      timeoutId = setTimeout(onTimeout, 1000);

      const onData = (data: Buffer) => {
        buffer += data.toString();

        bgReceived = this.parseBgColor(buffer, bgReceived);
        kittyKeyboardReceived = this.parseKittyKeyboard(
          buffer,
          kittyKeyboardReceived,
        );
        modifyOtherKeysReceived = this.parseModifyOtherKeys(
          buffer,
          modifyOtherKeysReceived,
        );
        terminalNameReceived = this.parseTerminalName(
          buffer,
          terminalNameReceived,
        );
        deviceAttributesReceived = this.parseDeviceAttributes(
          buffer,
          deviceAttributesReceived,
          cleanup,
        );
      };

      process.stdin.on('data', onData);

      try {
        fs.writeSync(
          process.stdout.fd,
          TerminalCapabilityManager.KITTY_QUERY +
            TerminalCapabilityManager.OSC_11_QUERY +
            TerminalCapabilityManager.TERMINAL_NAME_QUERY +
            TerminalCapabilityManager.MODIFY_OTHER_KEYS_QUERY +
            TerminalCapabilityManager.DEVICE_ATTRIBUTES_QUERY,
        );
      } catch {
        cleanup();
      }
    });
  }

  private parseBgColor(buffer: string, alreadyReceived: boolean): boolean {
    if (alreadyReceived) return true;
    const color = this.readOsc11Color(buffer);
    if (color !== null) {
      this.terminalBackgroundColor = this.parseColor(color.r, color.g, color.b);
      return true;
    }
    return false;
  }

  private parseKittyKeyboard(
    buffer: string,
    alreadyReceived: boolean,
  ): boolean {
    if (alreadyReceived) return true;
    if (this.readKittyKeyboardFlags(buffer) !== null) {
      this.kittySupported = true;
      return true;
    }
    return false;
  }

  private parseModifyOtherKeys(
    buffer: string,
    alreadyReceived: boolean,
  ): boolean {
    if (alreadyReceived) return true;
    const level = this.readModifyOtherKeysLevel(buffer);
    if (level !== null) {
      this.modifyOtherKeysSupported = level >= 2;
      debugLogger.log(
        `Detected modifyOtherKeys support: ${this.modifyOtherKeysSupported} (level ${level})`,
      );
      return true;
    }
    return false;
  }

  private parseTerminalName(buffer: string, alreadyReceived: boolean): boolean {
    if (alreadyReceived) return true;
    const terminalName = this.readTerminalName(buffer);
    if (terminalName !== null) {
      this.terminalName = terminalName;
      return true;
    }
    return false;
  }

  private parseDeviceAttributes(
    buffer: string,
    alreadyReceived: boolean,
    onDone: () => void,
  ): boolean {
    if (alreadyReceived) return true;
    if (this.readDeviceAttributes(buffer) !== null) {
      this.deviceAttributesSupported = true;
      onDone();
      return true;
    }
    return false;
  }

  enableSupportedModes() {
    try {
      if (this.kittySupported) {
        enableKittyKeyboardProtocol();
        this.kittyEnabled = true;
      } else if (
        this.modifyOtherKeysSupported === true ||
        // If device attributes were received it's safe to try enabling
        // anyways, since it will be ignored if unsupported
        (this.modifyOtherKeysSupported === undefined &&
          this.deviceAttributesSupported)
      ) {
        enableModifyOtherKeys();
      }
      // Always enable bracketed paste since it'll be ignored if unsupported.
      this.enableBracketedPasteMode();
    } catch (e) {
      debugLogger.warn('Failed to enable keyboard protocols:', e);
    }
  }

  enableBracketedPasteMode(): void {
    enableBracketedPasteMode();
    this.bracketedPasteEnabled = true;
  }

  disableBracketedPasteMode(): void {
    disableBracketedPasteMode();
    this.bracketedPasteEnabled = false;
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

  isBracketedPasteEnabled(): boolean {
    return this.bracketedPasteEnabled;
  }

  isModifyOtherKeysEnabled(): boolean {
    return this.modifyOtherKeysEnabled;
  }

  enableKittyProtocol(): void {
    try {
      if (this.kittySupported) {
        enableKittyKeyboardProtocol();
        this.kittyEnabled = true;
      }
    } catch {
      // Ignore errors during enable (terminal may not support these modes)
    }
  }

  disableKittyProtocol(): void {
    try {
      if (this.kittyEnabled) {
        disableKittyKeyboardProtocol();
        this.kittyEnabled = false;
      }
    } catch {
      // Ignore errors during disable (terminal may already be closed)
    }
  }

  disableKittyProtocolOnExit(): void {
    try {
      if (this.kittyEnabled) {
        if (process.stdout.isTTY && typeof process.stdout.fd === 'number') {
          // Kitty progressive enhancement flags are managed per screen buffer.
          // We may have enabled in main screen but be cleaning up while still in
          // alternate screen, so we deliberately send the `<u` sequence twice:
          // once for the alternate-screen context and once for the main-screen context.
          // Synchronous write is required for process.on('exit') reliability.
          fs.writeSync(process.stdout.fd, '\x1b[<u');
          fs.writeSync(process.stdout.fd, '\x1b[?1049l');
          fs.writeSync(process.stdout.fd, '\x1b[<u');
          // Explicitly reset all progressive enhancement flags (mode 1) to cover
          // terminals that implement flag-setting but not stack pop semantics.
          fs.writeSync(process.stdout.fd, '\x1b[=0;1u');
          fs.writeSync(process.stdout.fd, '\x1b[?1006l');
        }
        this.kittyEnabled = false;
      }
    } catch {
      // Ignore errors during disable (terminal may already be closed)
    }
  }

  private removeProcessListeners(): void {
    if (this.cleanupOnExitHandler) {
      process.removeListener('exit', this.cleanupOnExitHandler);
      process.removeListener('SIGTERM', this.cleanupOnExitHandler);
      process.removeListener('SIGINT', this.cleanupOnExitHandler);
      this.cleanupOnExitHandler = undefined;
    }

    if (this.disableKittyProtocolOnExitHandler) {
      process.removeListener('exit', this.disableKittyProtocolOnExitHandler);
      this.disableKittyProtocolOnExitHandler = undefined;
    }
  }

  private resetForTesting(): void {
    this.removeProcessListeners();
    try {
      if (this.kittyEnabled) {
        disableKittyKeyboardProtocol();
        this.kittyEnabled = false;
      }
      disableModifyOtherKeys();
      this.disableBracketedPasteMode();
    } catch {
      // Ignore teardown failures in tests.
    }
    this.modifyOtherKeysEnabled = false;
  }

  private readKittyKeyboardFlags(buffer: string): number | null {
    const prefix = TerminalCapabilityManager.ESC + '[?';
    let start = buffer.indexOf(prefix);
    while (start !== -1) {
      const digitsStart = start + prefix.length;
      const digitsEnd = this.readDigitsEnd(buffer, digitsStart);
      if (digitsEnd !== digitsStart && buffer[digitsEnd] === 'u') {
        return Number(buffer.slice(digitsStart, digitsEnd));
      }
      start = buffer.indexOf(prefix, start + prefix.length);
    }
    return null;
  }

  private readTerminalName(buffer: string): string | null {
    const prefix = TerminalCapabilityManager.ESC + 'P>|';
    const start = buffer.indexOf(prefix);
    if (start === -1) return null;
    const nameStart = start + prefix.length;
    const stEnd = buffer.indexOf(
      TerminalCapabilityManager.ESC + '\\',
      nameStart,
    );
    const belEnd = buffer.indexOf(TerminalCapabilityManager.BEL, nameStart);
    const nameEnd = this.firstTerminatorIndex(stEnd, belEnd);
    if (nameEnd === -1) return null;
    return buffer.slice(nameStart, nameEnd);
  }

  private readDeviceAttributes(buffer: string): number | null {
    const prefix = TerminalCapabilityManager.ESC + '[?';
    let start = buffer.indexOf(prefix);
    while (start !== -1) {
      const value = this.readDeviceAttributesAt(buffer, start, prefix.length);
      if (value !== null) return value;
      start = buffer.indexOf(prefix, start + prefix.length);
    }
    return null;
  }

  private readDeviceAttributesAt(
    buffer: string,
    start: number,
    prefixLength: number,
  ): number | null {
    const digitsStart = start + prefixLength;
    const digitsEnd = this.readDigitsEnd(buffer, digitsStart);
    if (digitsEnd === digitsStart) return null;
    const end = this.readSemicolonSeparatedDigitsEnd(buffer, digitsEnd);
    if (buffer[end] !== 'c') return null;
    return Number(buffer.slice(digitsStart, digitsEnd));
  }

  private readSemicolonSeparatedDigitsEnd(
    buffer: string,
    start: number,
  ): number {
    let index = start;
    while (buffer[index] === ';') {
      index += 1;
      const nextDigitsEnd = this.readDigitsEnd(buffer, index);
      if (nextDigitsEnd === index) return index;
      index = nextDigitsEnd;
    }
    return index;
  }

  private readModifyOtherKeysLevel(buffer: string): number | null {
    const prefix = TerminalCapabilityManager.ESC + '[>4;';
    const start = buffer.indexOf(prefix);
    if (start === -1) return null;
    const digitsStart = start + prefix.length;
    const digitsEnd = this.readDigitsEnd(buffer, digitsStart);
    if (digitsEnd === digitsStart || buffer[digitsEnd] !== 'm') return null;
    return Number(buffer.slice(digitsStart, digitsEnd));
  }

  private readOsc11Color(
    buffer: string,
  ): { r: string; g: string; b: string } | null {
    const prefix = TerminalCapabilityManager.ESC + ']11;rgb:';
    const start = buffer.indexOf(prefix);
    if (start === -1) return null;

    const firstSlash = buffer.indexOf('/', start + prefix.length);
    if (firstSlash === -1) return null;
    const secondSlash = buffer.indexOf('/', firstSlash + 1);
    if (secondSlash === -1) return null;

    const r = buffer.slice(start + prefix.length, firstSlash);
    const g = buffer.slice(firstSlash + 1, secondSlash);
    const bEnd = this.readHexEnd(buffer, secondSlash + 1);
    const b = buffer.slice(secondSlash + 1, bEnd);
    const hasTerminator =
      buffer[bEnd] === TerminalCapabilityManager.BEL ||
      buffer.startsWith(TerminalCapabilityManager.ESC + '\\', bEnd);
    if (
      !this.isRgbComponent(r) ||
      !this.isRgbComponent(g) ||
      !this.isRgbComponent(b) ||
      !hasTerminator
    ) {
      return null;
    }
    return { r, g, b };
  }

  private readDigitsEnd(buffer: string, start: number): number {
    let index = start;
    while (index < buffer.length) {
      const code = buffer.charCodeAt(index);
      if (code < 48 || code > 57) break;
      index += 1;
    }
    return index;
  }

  private readHexEnd(buffer: string, start: number): number {
    let index = start;
    while (index < buffer.length) {
      const code = buffer.charCodeAt(index);
      const isDigit = code >= 48 && code <= 57;
      const isUpperHex = code >= 65 && code <= 70;
      const isLowerHex = code >= 97 && code <= 102;
      if (!isDigit && !isUpperHex && !isLowerHex) break;
      index += 1;
    }
    return index;
  }

  private isRgbComponent(value: string): boolean {
    return (
      value.length >= 1 &&
      value.length <= 4 &&
      this.readHexEnd(value, 0) === value.length
    );
  }

  private firstTerminatorIndex(first: number, second: number): number {
    if (first === -1) return second;
    if (second === -1) return first;
    return Math.min(first, second);
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
