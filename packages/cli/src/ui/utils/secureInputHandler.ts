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
    // Check for /key command with a space (indicating an argument is being typed or about to be typed)
    return trimmed.startsWith('/key ') || trimmed === '/key';
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

      // Check if text starts with /key followed by space and content
      const match = text.match(/^\/key\s+([\s\S]*)/);
      if (match && match[1]) {
        // We have content after "/key "
        const keyContent = match[1];

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
      } else {
        // Just "/key" or "/key " with no content yet
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
      const keyCommandMatch = command.match(/^(\/key\s+)(.+)$/);
      if (keyCommandMatch) {
        const prefix = keyCommandMatch[1];
        const keyValue = keyCommandMatch[2];
        return `${prefix}${this.maskValue(keyValue)}`;
      }
    }
    return command;
  }
}

// Singleton instance
export const secureInputHandler = new SecureInputHandler();
