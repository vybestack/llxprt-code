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
    // Check for /key command with a space (indicating an argument is being typed)
    return trimmed.startsWith('/key ') && trimmed.length > 5;
  }

  /**
   * Processes input text and returns masked version if in secure mode
   */
  processInput(text: string): string {
    const shouldBeSecure = this.shouldUseSecureMode(text);

    if (shouldBeSecure && !this.secureState.isSecureMode) {
      // Entering secure mode
      this.enterSecureMode(text);
    } else if (!shouldBeSecure && this.secureState.isSecureMode) {
      // Exiting secure mode
      this.exitSecureMode();
    }

    if (this.secureState.isSecureMode) {
      // Update the actual value
      this.secureState.actualValue = text;
      
      // Extract the API key portion (everything after "/key ")
      const keyStartIndex = this.secureState.commandPrefix.length;
      const keyPortion = text.substring(keyStartIndex);
      
      // Check if the key contains newlines
      const newlineIndex = keyPortion.indexOf('\n');
      if (newlineIndex !== -1) {
        // Mask only up to the newline, preserve everything after
        const keyToMask = keyPortion.substring(0, newlineIndex);
        const afterNewline = keyPortion.substring(newlineIndex);
        const maskedKey = this.maskValue(keyToMask);
        this.secureState.maskedValue = this.secureState.commandPrefix + maskedKey + afterNewline;
      } else {
        // No newline, mask the entire key portion
        const maskedKey = this.maskValue(keyPortion);
        this.secureState.maskedValue = this.secureState.commandPrefix + maskedKey;
      }
      
      return this.secureState.maskedValue;
    }

    return text;
  }

  /**
   * Gets the actual (unmasked) value
   */
  getActualValue(): string {
    return this.secureState.isSecureMode 
      ? this.secureState.actualValue 
      : '';
  }

  /**
   * Checks if currently in secure mode
   */
  isInSecureMode(): boolean {
    return this.secureState.isSecureMode;
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
   * Enters secure mode
   */
  private enterSecureMode(text: string): void {
    // Find where the API key starts (after "/key ")
    const keyCommandMatch = text.match(/^(\/key\s+)/);
    if (keyCommandMatch) {
      this.secureState.commandPrefix = keyCommandMatch[1];
      this.secureState.isSecureMode = true;
      this.secureState.actualValue = text;
    }
  }

  /**
   * Exits secure mode
   */
  private exitSecureMode(): void {
    this.reset();
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