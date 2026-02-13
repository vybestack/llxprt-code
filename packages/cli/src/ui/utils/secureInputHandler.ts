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
    const trimmed = text.trim();
    // Check for /key, /keyfile, or /toolkey command
    // @plan PLAN-20260206-TOOLKEY.P11
    // @requirement REQ-006.1
    return (
      trimmed.startsWith('/key ') ||
      trimmed === '/key' ||
      trimmed.startsWith('/keyfile ') ||
      trimmed === '/keyfile' ||
      trimmed.startsWith('/toolkey ') ||
      trimmed === '/toolkey'
    );
  }

  /**
   * Processes input text and returns masked version if in secure mode
   */
  processInput(text: string): string {
    // Always update the actual value
    this.secureState.actualValue = text;

    // Check if we should be in secure mode based on current text
    const shouldBeSecure = this.shouldUseSecureMode(text);

    if (shouldBeSecure) {
      // Debug logging
      if (process.env.DEBUG_SECURE_INPUT) {
        console.log('[SecureHandler] Input:', JSON.stringify(text));
      }

      // @plan PLAN-20260206-TOOLKEY.P11
      // @requirement REQ-006.1
      // @pseudocode lines 424-445
      // Handle /toolkey BEFORE /key (because /toolkey starts with /key)
      const toolkeyMatch = text.match(/^\/toolkey\s+\S+\s+([\s\S]*)/);
      if (toolkeyMatch && toolkeyMatch[1]) {
        const patContent = toolkeyMatch[1];
        const prefixEnd = text.indexOf(patContent);
        const prefix = text.substring(0, prefixEnd);

        const lineBreakMatch = patContent.match(/[\r\n]/);
        if (lineBreakMatch) {
          const keyToMask = patContent.substring(0, lineBreakMatch.index!);
          const afterLineBreak = patContent.substring(lineBreakMatch.index!);
          return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
        } else {
          return `${prefix}${this.maskValue(patContent)}`;
        }
      }

      // @plan PLAN-20260211-SECURESTORE.P15
      // @requirement R20.1
      // /key save <name> <value> — mask only the value, leave subcommand and name visible
      const keySaveMatch = text.match(/^(\/key\s+save\s+\S+\s+)([\s\S]+)/);
      if (keySaveMatch && keySaveMatch[2]) {
        const prefix = keySaveMatch[1];
        const valueContent = keySaveMatch[2];
        const lineBreakMatch = valueContent.match(/[\r\n]/);
        if (lineBreakMatch) {
          const keyToMask = valueContent.substring(0, lineBreakMatch.index!);
          const afterLineBreak = valueContent.substring(lineBreakMatch.index!);
          return `${prefix}${this.maskValue(keyToMask)}${afterLineBreak}`;
        }
        return `${prefix}${this.maskValue(valueContent)}`;
      }

      // /key <subcommand> (non-save) — don't mask arguments for load/show/list/delete
      const keySubcmdMatch = text.match(
        /^\/key\s+(save|load|show|list|delete)(\s|$)/,
      );
      if (keySubcmdMatch) {
        // Known subcommand without value to mask (save is handled above)
        return text;
      }

      // Check if text starts with /key or /keyfile followed by space and content
      // @requirement R20.2 — legacy /key <raw-key> masking preserved
      const keyMatch = text.match(/^\/key\s+([\s\S]*)/);
      const keyfileMatch = text.match(/^\/keyfile\s+([\s\S]*)/);

      if (keyMatch && keyMatch[1]) {
        // We have content after "/key "
        const keyContent = keyMatch[1];

        // Check if the key contains newlines or carriage returns
        const lineBreakMatch = keyContent.match(/[\r\n]/);
        if (lineBreakMatch) {
          const lineBreakIndex = lineBreakMatch.index!;
          // Mask only up to the line break, preserve everything after
          const keyToMask = keyContent.substring(0, lineBreakIndex);
          const afterLineBreak = keyContent.substring(lineBreakIndex);
          const maskedKey = this.maskValue(keyToMask);
          const result = `/key ${maskedKey}${afterLineBreak}`;

          if (process.env.DEBUG_SECURE_INPUT) {
            console.log('[SecureHandler] Output:', JSON.stringify(result));
            console.log(
              '[SecureHandler] Key to mask:',
              JSON.stringify(keyToMask),
            );
            console.log(
              '[SecureHandler] After line break:',
              JSON.stringify(afterLineBreak),
            );
          }

          return result;
        } else {
          // No line break, mask the entire key portion
          const maskedKey = this.maskValue(keyContent);
          return `/key ${maskedKey}`;
        }
      } else if (keyfileMatch && keyfileMatch[1]) {
        // We have content after "/keyfile "
        // For /keyfile, we don't mask the file path (it's not sensitive)
        return text;
      } else {
        // Just "/key", "/keyfile" or with space but no content yet
        return text;
      }
    }

    // Not in secure mode
    return text;
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
    // We're in secure mode if the current actual value matches /key pattern
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

    // Show first and last 2 characters for long keys, mask everything for short keys
    if (value.length > 8) {
      const firstTwo = value.substring(0, 2);
      const lastTwo = value.substring(value.length - 2);
      const maskLength = value.length - 4; // This should be exactly the number of characters between first 2 and last 2
      return `${firstTwo}${'*'.repeat(maskLength)}${lastTwo}`;
    }

    return '*'.repeat(value.length);
  }

  /**
   * Sanitizes command for history storage
   */
  sanitizeForHistory(command: string): string {
    if (this.shouldUseSecureMode(command)) {
      // @plan PLAN-20260206-TOOLKEY.P11
      // @requirement REQ-006.2
      // @pseudocode lines 450-462
      // /toolkey MUST be checked BEFORE /key (because /toolkey starts with /key)
      const toolkeyCommandMatch = command.match(/^(\/toolkey\s+\S+\s+)(.+)$/);
      if (toolkeyCommandMatch) {
        const prefix = toolkeyCommandMatch[1];
        const keyValue = toolkeyCommandMatch[2];
        return `${prefix}${this.maskValue(keyValue)}`;
      }

      // @plan PLAN-20260211-SECURESTORE.P15
      // @requirement R20.1 — /key save <name> <value>: mask only the value
      const keySaveMatch = command.match(/^(\/key\s+save\s+\S+\s+)(.+)$/);
      if (keySaveMatch) {
        return `${keySaveMatch[1]}${this.maskValue(keySaveMatch[2])}`;
      }

      // /key <subcommand> (non-save) — don't mask arguments
      const subcommandMatch = command.match(
        /^\/key\s+(save|load|show|list|delete)(\s|$)/,
      );
      if (subcommandMatch) {
        return command;
      }

      // @requirement R20.2 — legacy /key <raw-key> masking
      const keyCommandMatch = command.match(/^(\/key\s+)(.+)$/);
      if (keyCommandMatch) {
        const prefix = keyCommandMatch[1];
        const keyValue = keyCommandMatch[2];
        return `${prefix}${this.maskValue(keyValue)}`;
      }
      // For /keyfile and /toolkeyfile, we don't mask the file path (it's not sensitive)
      // Just return the command as-is
    }
    return command;
  }
}

// Singleton instance
export const secureInputHandler = new SecureInputHandler();
