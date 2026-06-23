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

const SECURE_COMMAND_PREFIXES = ['/key', '/keyfile', '/toolkey'];
const KEY_SUBCOMMANDS = ['save', 'load', 'show', 'list', 'delete'];

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function isSecureCommand(trimmed: string): boolean {
  return SECURE_COMMAND_PREFIXES.some(
    (prefix) =>
      trimmed === prefix ||
      (trimmed.startsWith(prefix) && isWhitespace(trimmed[prefix.length])),
  );
}

function findCommandStart(text: string, command: string): number | null {
  let commandStart = 0;
  while (commandStart < text.length && isWhitespace(text[commandStart])) {
    commandStart += 1;
  }
  if (
    !text.startsWith(command, commandStart) ||
    !isWhitespace(text[commandStart + command.length])
  ) {
    return null;
  }
  return commandStart;
}

interface MaskSegment {
  keyToMask: string;
  afterLineBreak: string;
}

function splitAtLineBreak(content: string): MaskSegment {
  const carriageReturnIndex = content.indexOf('\r');
  const lineFeedIndex = content.indexOf('\n');
  let lineBreakIndex = Math.min(carriageReturnIndex, lineFeedIndex);
  if (carriageReturnIndex === -1) {
    lineBreakIndex = lineFeedIndex;
  } else if (lineFeedIndex === -1) {
    lineBreakIndex = carriageReturnIndex;
  }
  if (lineBreakIndex !== -1) {
    return {
      keyToMask: content.substring(0, lineBreakIndex),
      afterLineBreak: content.substring(lineBreakIndex),
    };
  }
  return { keyToMask: content, afterLineBreak: '' };
}

function splitAfterTokens(
  text: string,
  command: string,
  tokenCount: number,
): { prefix: string; value: string } | null {
  const commandStart = findCommandStart(text, command);
  if (commandStart === null) {
    return null;
  }

  let index = commandStart + command.length;
  for (let token = 0; token < tokenCount; token++) {
    if (!isWhitespace(text[index])) {
      return null;
    }
    while (isWhitespace(text[index])) {
      index += 1;
    }
    const tokenStart = index;
    while (index < text.length && !isWhitespace(text[index])) {
      index += 1;
    }
    if (index === tokenStart) {
      return null;
    }
  }

  if (!isWhitespace(text[index])) {
    return null;
  }
  while (isWhitespace(text[index])) {
    index += 1;
  }
  if (index >= text.length) {
    return null;
  }
  return { prefix: text.substring(0, index), value: text.substring(index) };
}

function splitKeySaveInput(
  text: string,
): { prefix: string; value: string } | null {
  const command = '/key';
  const commandStart = findCommandStart(text, command);
  if (commandStart === null) {
    return null;
  }

  let index = commandStart + command.length;
  while (isWhitespace(text[index])) {
    index += 1;
  }
  const saveEnd = index + 'save'.length;
  if (!text.startsWith('save', index) || !isWhitespace(text[saveEnd])) {
    return null;
  }

  index = saveEnd;
  while (isWhitespace(text[index])) {
    index += 1;
  }
  const nameStart = index;
  while (index < text.length && !isWhitespace(text[index])) {
    index += 1;
  }
  if (index === nameStart || !isWhitespace(text[index])) {
    return null;
  }
  while (isWhitespace(text[index])) {
    index += 1;
  }
  if (index >= text.length) {
    return null;
  }
  return { prefix: text.substring(0, index), value: text.substring(index) };
}

function splitKeyInput(text: string): { prefix: string; value: string } | null {
  const command = '/key';
  const commandStart = findCommandStart(text, command);
  if (commandStart === null) {
    return null;
  }
  let index = commandStart + command.length;
  while (isWhitespace(text[index])) {
    index += 1;
  }
  if (index >= text.length) {
    return null;
  }
  return { prefix: text.substring(0, index), value: text.substring(index) };
}

function isKeySubcommand(text: string): boolean {
  const prefix = '/key';
  const commandStart = findCommandStart(text, prefix);
  if (commandStart === null) {
    return false;
  }
  let index = commandStart + prefix.length;
  while (isWhitespace(text[index])) {
    index += 1;
  }
  const subcommandStart = index;
  while (index < text.length && !isWhitespace(text[index])) {
    index += 1;
  }
  return KEY_SUBCOMMANDS.includes(text.substring(subcommandStart, index));
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

    if (isKeySubcommand(text)) {
      return text;
    }

    const keyResult = this.maskKeyInput(text);
    if (keyResult !== null) {
      return keyResult;
    }

    if (text === '/keyfile' || text.startsWith('/keyfile ')) {
      return text;
    }

    return text;
  }

  private maskToolKeyInput(text: string): string | null {
    const toolkeyMatch = splitAfterTokens(text, '/toolkey', 1);
    if (toolkeyMatch === null) {
      return null;
    }
    const { prefix, value: valueContent } = toolkeyMatch;
    const { keyToMask, afterLineBreak } = splitAtLineBreak(valueContent);
    if (afterLineBreak !== '') {
      return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
    }
    return `${prefix}${this.maskValue(valueContent)}`;
  }

  private maskKeySaveInput(text: string): string | null {
    const keySaveMatch = splitKeySaveInput(text);
    if (keySaveMatch === null) {
      return null;
    }
    const { prefix, value: valueContent } = keySaveMatch;
    const { keyToMask, afterLineBreak } = splitAtLineBreak(valueContent);
    if (afterLineBreak !== '') {
      return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
    }
    return `${prefix}${this.maskValue(valueContent)}`;
  }

  private maskKeyInput(text: string): string | null {
    const keyMatch = splitKeyInput(text);
    if (keyMatch === null) {
      return null;
    }
    const { prefix, value: keyContent } = keyMatch;
    const { keyToMask, afterLineBreak } = splitAtLineBreak(keyContent);
    const maskedKey = this.maskValue(keyToMask);
    if (afterLineBreak !== '') {
      const result = `${prefix}${maskedKey}${afterLineBreak}`;
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
    return `${prefix}${maskedKey}`;
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

    const toolkeyCommandMatch = splitAfterTokens(command, '/toolkey', 1);
    if (toolkeyCommandMatch !== null) {
      return `${toolkeyCommandMatch.prefix}${this.maskValue(toolkeyCommandMatch.value)}`;
    }

    const keySaveMatch = splitKeySaveInput(command);
    if (keySaveMatch !== null) {
      return `${keySaveMatch.prefix}${this.maskValue(keySaveMatch.value)}`;
    }

    if (isKeySubcommand(command)) {
      return command;
    }

    const keyMatch = splitKeyInput(command);
    if (keyMatch !== null) {
      return `${keyMatch.prefix}${this.maskValue(keyMatch.value)}`;
    }

    return command;
  }
}

// Singleton instance
export const secureInputHandler = new SecureInputHandler();
