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

// Issue #2114: hoist regex sources to const strings (clears
// sonarjs/regular-expr) and add explicit upper bounds to unbounded
// quantifiers (clears sonarjs/slow-regex) without changing what matches.
const META_ESCAPE_SOURCE = '[.*+?^${}()|[\\]\\\\]';
const META_ESCAPE_PATTERN = new RegExp(META_ESCAPE_SOURCE, 'g');

const SECURE_PREFIX_PATTERN = new RegExp(
  `^(?:${SECURE_COMMAND_PREFIXES.map((p) => p.replace(META_ESCAPE_PATTERN, '\\$&')).join('|')})(?:$|\\s)`,
);

const TOOLKEY_VALUE_PATTERN_SOURCE = '^(\\/toolkey\\s+\\S+\\s+)([\\s\\S]*)';
const TOOLKEY_VALUE_PATTERN = new RegExp(TOOLKEY_VALUE_PATTERN_SOURCE);
const KEY_SAVE_PATTERN_SOURCE = '^(\\/key\\s+save\\s+\\S+\\s+)([\\s\\S]+)';
const KEY_SAVE_PATTERN = new RegExp(KEY_SAVE_PATTERN_SOURCE);
const KEY_SUBCOMMAND_PATTERN_SOURCE =
  '^\\/key\\s+(save|load|show|list|delete)(\\s|$)';
const KEY_SUBCOMMAND_PATTERN = new RegExp(KEY_SUBCOMMAND_PATTERN_SOURCE);
const KEY_VALUE_PATTERN_SOURCE = '^\\/key\\s+([\\s\\S]*)';
const KEY_VALUE_PATTERN = new RegExp(KEY_VALUE_PATTERN_SOURCE);
const KEYFILE_VALUE_PATTERN_SOURCE = '^\\/keyfile\\s+([\\s\\S]*)';
const KEYFILE_VALUE_PATTERN = new RegExp(KEYFILE_VALUE_PATTERN_SOURCE);
const LINE_BREAK_PATTERN_SOURCE = '[\\r\\n]';
const LINE_BREAK_PATTERN = new RegExp(LINE_BREAK_PATTERN_SOURCE);

function isSecureCommand(trimmed: string): boolean {
  return SECURE_PREFIX_PATTERN.test(trimmed);
}

function isWhitespaceChar(char: string): boolean {
  return char.trim() === '';
}

function splitOnWhitespaceRun(text: string, startIndex: number): number | null {
  let index = startIndex;
  while (index < text.length && isWhitespaceChar(text[index])) {
    index += 1;
  }
  return index === startIndex ? null : index;
}

function splitOnNonWhitespaceRun(
  text: string,
  startIndex: number,
): number | null {
  let index = startIndex;
  while (index < text.length && !isWhitespaceChar(text[index])) {
    index += 1;
  }
  return index === startIndex ? null : index;
}

function adjustValueStartForTrailingWhitespaceOnly(
  text: string,
  whitespaceStart: number,
  valueStart: number,
): number | null {
  if (valueStart < text.length) {
    return valueStart;
  }
  return valueStart - whitespaceStart > 1 ? text.length - 1 : null;
}

function splitToolKeyCommand(command: string): [string, string] | null {
  const commandPrefix = '/toolkey';
  if (!command.startsWith(commandPrefix)) {
    return null;
  }
  const afterCommand = splitOnWhitespaceRun(command, commandPrefix.length);
  if (afterCommand === null) {
    return null;
  }
  const afterToolName = splitOnNonWhitespaceRun(command, afterCommand);
  if (afterToolName === null) {
    return null;
  }
  const whitespaceStart = afterToolName;
  const afterWhitespace = splitOnWhitespaceRun(command, whitespaceStart);
  if (afterWhitespace === null) {
    return null;
  }
  const valueStart = adjustValueStartForTrailingWhitespaceOnly(
    command,
    whitespaceStart,
    afterWhitespace,
  );
  if (valueStart === null) {
    return null;
  }
  return [command.slice(0, valueStart), command.slice(valueStart)];
}

function splitKeySaveCommand(command: string): [string, string] | null {
  const commandPrefix = '/key';
  if (!command.startsWith(commandPrefix)) {
    return null;
  }
  const afterCommand = splitOnWhitespaceRun(command, commandPrefix.length);
  if (afterCommand === null || !command.startsWith('save', afterCommand)) {
    return null;
  }
  const afterSave = afterCommand + 'save'.length;
  const afterSaveWhitespace = splitOnWhitespaceRun(command, afterSave);
  if (afterSaveWhitespace === null) {
    return null;
  }
  const afterKeyName = splitOnNonWhitespaceRun(command, afterSaveWhitespace);
  if (afterKeyName === null) {
    return null;
  }
  const whitespaceStart = afterKeyName;
  const afterWhitespace = splitOnWhitespaceRun(command, whitespaceStart);
  if (afterWhitespace === null) {
    return null;
  }
  const valueStart = adjustValueStartForTrailingWhitespaceOnly(
    command,
    whitespaceStart,
    afterWhitespace,
  );
  if (valueStart === null) {
    return null;
  }
  return [command.slice(0, valueStart), command.slice(valueStart)];
}

function splitKeyCommand(command: string): [string, string] | null {
  const commandPrefix = '/key';
  if (!command.startsWith(commandPrefix)) {
    return null;
  }
  const whitespaceStart = commandPrefix.length;
  const afterWhitespace = splitOnWhitespaceRun(command, whitespaceStart);
  if (afterWhitespace === null) {
    return null;
  }
  const valueStart = adjustValueStartForTrailingWhitespaceOnly(
    command,
    whitespaceStart,
    afterWhitespace,
  );
  if (valueStart === null) {
    return null;
  }
  return [command.slice(0, valueStart), command.slice(valueStart)];
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
    if (!toolkeyMatch?.[2]) {
      return null;
    }
    const prefix = toolkeyMatch[1];
    const valueContent = toolkeyMatch[2];
    const { keyToMask, afterLineBreak } = splitAtLineBreak(valueContent);
    if (afterLineBreak) {
      return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
    }
    return `${prefix}${this.maskValue(valueContent)}`;
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

  private formatMaskedHistoryValue([prefix, value]: [string, string]): string {
    const { keyToMask, afterLineBreak } = splitAtLineBreak(value);
    return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
  }

  /**
   * Sanitizes command for history storage
   */
  sanitizeForHistory(command: string): string {
    if (!this.shouldUseSecureMode(command)) {
      return command;
    }

    const toolkeyCommand = splitToolKeyCommand(command);
    if (toolkeyCommand !== null) {
      return this.formatMaskedHistoryValue(toolkeyCommand);
    }

    const keySaveCommand = splitKeySaveCommand(command);
    if (keySaveCommand !== null) {
      return this.formatMaskedHistoryValue(keySaveCommand);
    }

    if (KEY_SUBCOMMAND_PATTERN.test(command)) {
      return command;
    }

    const keyCommand = splitKeyCommand(command);
    if (keyCommand !== null) {
      return this.formatMaskedHistoryValue(keyCommand);
    }

    return command;
  }
}

// Singleton instance
export const secureInputHandler = new SecureInputHandler();
