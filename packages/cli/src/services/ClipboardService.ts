/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Service for interacting with the clipboard
 */
export class ClipboardService {
  /**
   * Copy text to clipboard
   * @param text The text to copy
   */
  static async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      // Fallback for environments where navigator.clipboard is not available
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand('copy');
      } catch (_err) {
        throw new Error('Failed to copy text to clipboard');
      }

      document.body.removeChild(textArea);
    }
  }
}
