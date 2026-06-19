import { debugLogger } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SecureInputState {
  isSecureMode: boolean;
  actualValue: string;
  maskedValue: string;
  commandPrefix: string;
}

const SECURE_COMMAND_PREFIXES = [
  '/key ',
  '/key',
  '/keyfile ',
  '/keyfile',
  '/toolkey ',
  '/toolkey',
];

const TOOLKEY_VALUE_PATTERN = /^\/toolkey\s+\S+\s+([\s\S]*)/;
const KEY_SAVE_PATTERN = /^(\/key\s+save\s+\S+\s+)([\s\S]+)/;
const KEY_SUBCOMMAND_PATTERN = /^\/key\s+(save|load|show|list|delete)(\s|$)/;
const KEY_VALUE_PATTERN = /^\/key\s+([\s\S]*)/;
const KEYFILE_VALUE_PATTERN = /^\/keyfile\s+([\s\S]*)/;
const TOOLKEY_COMMAND_PATTERN = /^(\/toolkey\s+\S+\s+)(.+)$/;
const KEY_SAVE_COMMAND_PATTERN = /^(\/key\s+save\s+\S+\s+)(.+)$/;
const KEY_COMMAND_PATTERN = /^(\/key\s+)(.+)$/;
const LINE_BREAK_PATTERN = /[\r\n]/;

function isSecureCommand(trimmed: string): boolean {
  return SECURE_COMMAND_PREFIXES.some((prefix) =>
    prefix.endsWith(' ') ? trimmed.startsWith(prefix) : trimmed === prefix,
  );
}

interface MaskSegment {
  keyToMask: string;
  afterLineBreak: string;
}

function splitAtLineBreak(content: string): MaskSegment {
  const lineBreakMatch = content.match(LINE_BREAK_PATTERN);
  if (lineBreakMatch?.index !== undefined) {
    return {
      keyToMask: content.substring(0, lineBreakMatch.index),
      afterLineBreak: content.substring(lineBreakMatch.index),
    };
  }
  return { keyToMask: content, afterLineBreak: '' };
}

/**
 * Handles secure input for sensitive data like API keys
 */
export class SecureInputHandler {
  private secureState: SecureInputState = {
    isSecureMode: false,
    actualValue: '',
    maskedValue: '',
    commandPrefix: '',
  };

  /**
   * Checks if the current input should be handled securely
   */
  shouldUseSecureMode(text: string): boolean {
    return isSecureCommand(text.trim());
  }

  /**
   * Processes input text and returns masked version if in secure mode
   */
  processInput(text: string): string {
    this.secureState.actualValue = text;

    if (!this.shouldUseSecureMode(text)) {
      return text;
    }

    if (process.env.DEBUG_SECURE_INPUT) {
      debugLogger.log('[SecureHandler] Input:', JSON.stringify(text));
    }

    const masked = this.maskProcessInput(text);
    if (masked !== null) {
      return masked;
    }
    return text;
  }

  private maskProcessInput(text: string): string | null {
    const toolkeyResult = this.maskToolKeyInput(text);
    if (toolkeyResult !== null) {
      return toolkeyResult;
    }

    const keySaveResult = this.maskKeySaveInput(text);
    if (keySaveResult !== null) {
      return keySaveResult;
    }

    if (KEY_SUBCOMMAND_PATTERN.test(text)) {
      return text;
    }

    const keyResult = this.maskKeyInput(text);
    if (keyResult !== null) {
      return keyResult;
    }

    if (KEYFILE_VALUE_PATTERN.test(text)) {
      return text;
    }

    return text;
  }

  private maskToolKeyInput(text: string): string | null {
    const toolkeyMatch = text.match(TOOLKEY_VALUE_PATTERN);
    if (!toolkeyMatch?.[1]) {
      return null;
    }
    const patContent = toolkeyMatch[1];
    const prefixEnd = text.indexOf(patContent);
    const prefix = text.substring(0, prefixEnd);
    const { keyToMask, afterLineBreak } = splitAtLineBreak(patContent);
    if (afterLineBreak) {
      return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
    }
    return `${prefix}${this.maskValue(patContent)}`;
  }

  private maskKeySaveInput(text: string): string | null {
    const keySaveMatch = text.match(KEY_SAVE_PATTERN);
    if (!keySaveMatch?.[2]) {
      return null;
    }
    const prefix = keySaveMatch[1];
    const valueContent = keySaveMatch[2];
    const { keyToMask, afterLineBreak } = splitAtLineBreak(valueContent);
    if (afterLineBreak) {
      return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
    }
    return `${prefix}${this.maskValue(valueContent)}`;
  }

  private maskKeyInput(text: string): string | null {
    const keyMatch = text.match(KEY_VALUE_PATTERN);
    if (!keyMatch?.[1]) {
      return null;
    }
    const keyContent = keyMatch[1];
    const { keyToMask, afterLineBreak } = splitAtLineBreak(keyContent);
    const maskedKey = this.maskValue(keyToMask);
    if (afterLineBreak) {
      const result = `/key ${maskedKey}${afterLineBreak}`;
      if (process.env.DEBUG_SECURE_INPUT) {
        debugLogger.log('[SecureHandler] Output:', JSON.stringify(result));
        debugLogger.log(
          '[SecureHandler] Key to mask:',
          JSON.stringify(keyToMask),
        );
        debugLogger.log(
          '[SecureHandler] After line break:',
          JSON.stringify(afterLineBreak),
        );
      }
      return result;
    }
    return `/key ${maskedKey}`;
  }

  /**
   * Gets the actual (unmasked) value
   */
  getActualValue(): string {
    return this.secureState.actualValue || '';
  }

  /**
   * Checks if currently in secure mode
   */
  isInSecureMode(): boolean {
    return this.shouldUseSecureMode(this.secureState.actualValue || '');
  }

  /**
   * Resets the secure input state
   */
  reset(): void {
    this.secureState = {
      isSecureMode: false,
      actualValue: '',
      maskedValue: '',
      commandPrefix: '',
    };
  }

  /**
   * Masks a value with asterisks
   */
  private maskValue(value: string): string {
    if (!value) return '';

    if (value.length > 8) {
      const firstTwo = value.substring(0, 2);
      const lastTwo = value.substring(value.length - 2);
      const maskLength = value.length - 4;
      return `${firstTwo}${'*'.repeat(maskLength)}${lastTwo}`;
    }

    return '*'.repeat(value.length);
  }

  /**
   * Sanitizes command for history storage
   */
  sanitizeForHistory(command: string): string {
    if (!this.shouldUseSecureMode(command)) {
      return command;
    }

    const toolkeyCommandMatch = command.match(TOOLKEY_COMMAND_PATTERN);
    if (toolkeyCommandMatch) {
      return `${toolkeyCommandMatch[1]}${this.maskValue(toolkeyCommandMatch[2])}`;
    }

    const keySaveMatch = command.match(KEY_SAVE_COMMAND_PATTERN);
    if (keySaveMatch) {
      return `${keySaveMatch[1]}${this.maskValue(keySaveMatch[2])}`;
    }

    if (KEY_SUBCOMMAND_PATTERN.test(command)) {
      return command;
    }

    const keyCommandMatch = command.match(KEY_COMMAND_PATTERN);
    if (keyCommandMatch) {
      return `${keyCommandMatch[1]}${this.maskValue(keyCommandMatch[2])}`;
    }

    return command;
  }
}

// Singleton instance
export const secureInputHandler = new SecureInputHandler();
