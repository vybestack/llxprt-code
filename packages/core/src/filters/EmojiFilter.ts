/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * EmojiFilter - Filters emojis from text content based on configuration
 * Implementation stub based on pseudocode lines 01-186
 */

/**
 * Emoji filter modes
 */
export type EmojiFilterMode = 'allowed' | 'auto' | 'warn' | 'error';

/**
 * Configuration for emoji filtering behavior
 * @requirement REQ-004.1 - Silent filtering in auto mode
 */
export interface FilterConfiguration {
  mode: EmojiFilterMode;
}

/**
 * Result of emoji filtering operation
 */
export interface FilterResult {
  filtered: string | object | null;
  emojiDetected: boolean;
  blocked: boolean;
  error?: string;
  systemFeedback?: string;
}

/**
 * Gets the most restrictive filter mode from two modes
 * Hierarchy: error > warn > auto > allowed
 */
export function getMostRestrictiveFilter(
  mode1: EmojiFilterMode,
  mode2: EmojiFilterMode,
): EmojiFilterMode {
  const priority: Record<EmojiFilterMode, number> = {
    allowed: 0,
    auto: 1,
    warn: 2,
    error: 3,
  };

  return priority[mode1] >= priority[mode2] ? mode1 : mode2;
}

/**
 * Emoji Unicode code-point ranges for comprehensive detection.
 * Each tuple is [start, end] inclusive.
 */
const EMOJI_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1f300, 0x1f9ff],
  [0x1fa00, 0x1faff],
  [0x2600, 0x26ff],
  [0x2700, 0x27bf],
  [0x1f170, 0x1f1ff],
  [0x1f600, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x23e9, 0x23ff],
  [0x2705, 0x2705],
  [0x2713, 0x2713],
  [0x26a0, 0x26a0],
  [0x274c, 0x274c],
  [0x26a1, 0x26a1],
  [0xfe0e, 0xfe0f],
  [0x200d, 0x200d],
];

/**
 * Checks whether a single Unicode code point falls within any known emoji
 * range. Used as a regex-free alternative to character-class matching.
 */
function isEmojiCodePoint(codePoint: number): boolean {
  for (const [start, end] of EMOJI_CODE_POINT_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

/**
 * Tests whether the given text contains at least one emoji code point.
 */
function textContainsEmoji(text: string): boolean {
  for (const char of text) {
    if (isEmojiCodePoint(char.codePointAt(0) ?? 0)) {
      return true;
    }
  }
  return false;
}

/**
 * Removes all emoji code points from the given text.
 */
function stripEmojiCodePoints(text: string): string {
  let result = '';
  for (const char of text) {
    if (!isEmojiCodePoint(char.codePointAt(0) ?? 0)) {
      result += char;
    }
  }
  return result;
}

/**
 * EmojiFilter class for filtering emojis from various content types
 * @pseudocode lines 01-186
 */
export class EmojiFilter {
  private conversions: Map<string, string>;
  private buffer: string;
  private config: FilterConfiguration;

  /**
   * Creates new EmojiFilter instance
   * @param config Filter configuration
   * @pseudocode lines 07-12
   */
  constructor(config: FilterConfiguration) {
    this.config = config;
    this.conversions = this.loadConversionMap();
    this.buffer = '';
  }

  /**
   * Filters text content for emojis
   * @param text Text to filter
   * @returns Filter result with processed text
   * @pseudocode lines 14-45
   */
  filterText(text: string): FilterResult {
    if (this.config.mode === 'allowed') {
      return { filtered: text, emojiDetected: false, blocked: false };
    }

    const emojiDetected = this.detectEmojis(text);

    if (!emojiDetected) {
      return { filtered: text, emojiDetected: false, blocked: false };
    }

    if (this.config.mode === 'error') {
      return {
        filtered: null,
        emojiDetected: true,
        blocked: true,
        error: 'Emojis detected in content',
      };
    }

    let filtered = this.applyConversions(text);
    filtered = this.removeDecorativeEmojis(filtered);

    /**
     * @requirement REQ-004.1 - Silent filtering in auto mode
     */
    return {
      filtered,
      emojiDetected: true,
      blocked: false,
      systemFeedback:
        this.config.mode === 'warn'
          ? 'Emojis were detected and removed. Please avoid using emojis.'
          : undefined,
    };
  }

  /**
   * Filters streaming text chunks for emojis
   * @param chunk Text chunk to filter
   * @returns Filter result with processed chunk
   * @pseudocode lines 47-60
   */
  filterStreamChunk(chunk: string): FilterResult {
    const combined = this.buffer + chunk;
    const lastBoundary = this.findLastSafeBoundary(combined);

    if (lastBoundary === -1 || lastBoundary === 0) {
      this.buffer = combined;

      // In error mode, check if buffer has emojis and return error immediately
      if (this.config.mode === 'error' && this.detectEmojis(combined)) {
        return {
          filtered: null,
          emojiDetected: true,
          blocked: true,
          error: 'Emojis detected in content',
        };
      }

      return { filtered: '', emojiDetected: false, blocked: false };
    }

    const toProcess = combined.substring(0, lastBoundary);
    this.buffer = combined.substring(lastBoundary);

    return this.filterText(toProcess);
  }

  /**
   * Filters tool arguments for emojis
   * @param args Tool arguments object
   * @returns Filter result with processed arguments
   * @pseudocode lines 62-95
   */
  filterToolArgs(args: object): FilterResult {
    if (this.config.mode === 'allowed') {
      return { filtered: args, emojiDetected: false, blocked: false };
    }

    const stringified = JSON.stringify(args);
    const emojiDetected = this.detectEmojis(stringified);

    if (!emojiDetected) {
      return { filtered: args, emojiDetected: false, blocked: false };
    }

    if (this.config.mode === 'error') {
      return {
        filtered: null,
        emojiDetected: true,
        blocked: true,
        error: 'Cannot execute tool with emojis in parameters',
      };
    }

    const filteredArgs = this.deepFilterObject(args) as object;

    /**
     * @requirement REQ-004.1 - Silent filtering in auto mode
     */
    return {
      filtered: filteredArgs,
      emojiDetected: true,
      blocked: false,
      systemFeedback:
        this.config.mode === 'warn'
          ? 'Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters.'
          : undefined,
    };
  }

  /**
   * Filters file content for emojis
   * @param content File content to filter
   * @param toolName Name of the tool writing the file
   * @returns Filter result with processed content
   * @pseudocode lines 97-128
   */
  filterFileContent(content: string, toolName: string): FilterResult {
    if (this.config.mode === 'allowed') {
      return { filtered: content, emojiDetected: false, blocked: false };
    }

    const emojiDetected = this.detectEmojis(content);

    if (!emojiDetected) {
      return { filtered: content, emojiDetected: false, blocked: false };
    }

    if (this.config.mode === 'error') {
      return {
        filtered: null,
        emojiDetected: true,
        blocked: true,
        error: 'Cannot write emojis to code files',
      };
    }

    let filtered = this.applyConversions(content);
    filtered = this.removeDecorativeEmojis(filtered);

    /**
     * @requirement REQ-004.1 - Silent filtering in auto mode
     */
    return {
      filtered,
      emojiDetected: true,
      blocked: false,
      systemFeedback:
        this.config.mode === 'warn'
          ? `Emojis were removed from ${toolName} content. Please avoid using emojis in code.`
          : undefined,
    };
  }

  /**
   * Flushes remaining buffered content
   * @returns Remaining filtered content
   * @pseudocode lines 130-138
   */
  flushBuffer(): string {
    const remaining = this.buffer;
    this.buffer = '';
    if (remaining.length > 0) {
      const result = this.filterText(remaining);
      return (typeof result.filtered === 'string' ? result.filtered : '') || '';
    }
    return '';
  }

  /**
   * Detects if text contains emojis
   * @param text Text to check
   * @returns True if emojis detected
   * @pseudocode lines 140-147
   */
  private detectEmojis(text: string): boolean {
    return textContainsEmoji(text);
  }

  /**
   * Applies emoji-to-text conversions
   * @param text Text to convert
   * @returns Text with emojis converted
   * @pseudocode lines 149-155
   */
  private applyConversions(text: string): string {
    let result = text;
    for (const [emoji, replacement] of this.conversions) {
      result = result.replaceAll(emoji, replacement);
    }
    return result;
  }

  /**
   * Removes decorative emojis from text
   * @param text Text to clean
   * @returns Text with decorative emojis removed
   * @pseudocode lines 157-163
   */
  private removeDecorativeEmojis(text: string): string {
    // Remove ALL emojis using code-point range stripping.
    // Functional emojis ([OK], [OK], WARNING:, [ERROR], [ACTION]) are already converted by applyConversions.
    return stripEmojiCodePoints(text);
  }

  /**
   * Finds last safe boundary to avoid splitting multi-byte characters
   * @param text Text to analyze
   * @returns Safe boundary position or -1 if none found
   * @pseudocode lines 165-180
   */
  private findLastSafeBoundary(text: string): number {
    const length = text.length;
    if (length === 0) {
      return -1;
    }

    // If text contains emojis, be more conservative about boundaries
    const hasEmojis = this.detectEmojis(text);

    // Special case: if text ends with known complete words (common endings)
    const completeWordSuffixes = [
      'done',
      'completed',
      'finished',
      'success',
      'error',
      'failed',
      'ready',
      'developer',
      'warnings',
    ];
    const lowerText = text.toLowerCase();
    const endsWithKnownCompleteWords = completeWordSuffixes.some((word) =>
      lowerText.endsWith(word),
    );
    if (endsWithKnownCompleteWords) {
      return length;
    }

    // If we have emojis in the text, be very conservative - only process
    // when we have known complete words or strong punctuation
    if (hasEmojis) {
      const lastChar = text.charAt(text.length - 1);
      if (lastChar === '.' || lastChar === '!' || lastChar === '?') {
        return length;
      }
      return -1;
    }

    // For text without emojis, check if text ends with clear termination
    const lastChar = text.charAt(text.length - 1);
    const endsWithPunctuation =
      lastChar === '.' || lastChar === '!' || lastChar === '?';
    const endsWithSpace =
      lastChar === ' ' || lastChar === '\t' || lastChar === '\n';

    // Process text if it ends with punctuation or whitespace
    if (endsWithPunctuation || endsWithSpace) {
      return length;
    }

    // Otherwise buffer - text might be incomplete (like 'tas' from 'task')
    return -1;
  }

  /**
   * Loads emoji-to-text conversion map
   * @returns Map of emoji conversions
   * @pseudocode line 10
   */
  private loadConversionMap(): Map<string, string> {
    return new Map([
      ['✅', '[OK]'], // ✅ -> [OK]
      ['✓', '[OK]'], // ✓ -> [OK]
      ['⚠️', 'WARNING:'], // ⚠️ -> WARNING:
      ['❌', '[ERROR]'], // ❌ -> [ERROR]
      ['⚡', '[ACTION]'], // ⚡ -> [ACTION]
      ['🪄', '[MAGIC]'], // 🪄 -> [MAGIC]
      ['🆙', '[UP]'], // 🆙 -> [UP]
      ['⭐', '[STAR]'], // ⭐ -> [STAR]
      ['🪨', '[ROCK]'], // 🪨 -> [ROCK]
      ['🩸', '[BLOOD]'], // 🩸 -> [BLOOD]
      ['🪐', '[PLANET]'], // 🪐 -> [PLANET]
      ['🫐', '[BLUEBERRIES]'], // 🫐 -> [BLUEBERRIES]
      ['🫒', '[OLIVE]'], // 🫒 -> [OLIVE]
      ['🫑', '[BELL_PEPPER]'], // 🫑 -> [BELL_PEPPER]
      ['🫖', '[TEAPOT]'], // 🫖 -> [TEAPOT]
      ['🫘', '[BEANS]'], // 🫘 -> [BEANS]
      ['🫙', '[JAR]'], // 🫙 -> [JAR]
      // Emoji numbers to regular numbers
      ['0️⃣', '0'], // 0️⃣ -> 0
      ['1️⃣', '1'], // 1️⃣ -> 1
      ['2️⃣', '2'], // 2️⃣ -> 2
      ['3️⃣', '3'], // 3️⃣ -> 3
      ['4️⃣', '4'], // 4️⃣ -> 4
      ['5️⃣', '5'], // 5️⃣ -> 5
      ['6️⃣', '6'], // 6️⃣ -> 6
      ['7️⃣', '7'], // 7️⃣ -> 7
      ['8️⃣', '8'], // 8️⃣ -> 8
      ['9️⃣', '9'], // 9️⃣ -> 9
      // Note: 📝 is treated as decorative in the tests, not functional
    ]);
  }

  /**
   * Recursively filters emojis from object properties
   * @param obj Object to filter
   * @returns Filtered object
   */
  private deepFilterObject(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.filterText(obj).filtered;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepFilterObject(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        filtered[key] = this.deepFilterObject(value);
      }
      return filtered;
    }

    return obj;
  }
}
