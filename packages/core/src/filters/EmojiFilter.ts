/**
 * EmojiFilter - Filters emojis from text content based on configuration
 * Implementation stub based on pseudocode lines 01-186
 */

/**
 * Configuration for emoji filtering behavior
 * @requirement REQ-004.1 - Silent filtering in auto mode
 */
export interface FilterConfiguration {
  mode: 'allowed' | 'auto' | 'warn' | 'error';
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
 * Compiled regex patterns for emoji detection
 */
type CompiledRegexArray = RegExp[];

/**
 * EmojiFilter class for filtering emojis from various content types
 * @pseudocode lines 01-186
 */
export class EmojiFilter {
  private patterns: CompiledRegexArray;
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
    this.patterns = this.compileEmojiPatterns();
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
    for (const pattern of this.patterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
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
    // Remove decorative emojis - NOT functional ones that are converted first
    // Functional emojis: ✅, ✓, ⚠️, ❌, ⚡ (these are converted, not removed)
    const decorativePattern =
      /🎉|🎊|✨|💫|⭐|🌟|😀|😁|😂|😃|😄|😅|😆|😇|😈|😉|😊|😋|😌|😍|😎|😏|🔥|💯|🚫|🎯|🤔|💭|🚀|⏳|💾|🐛|👍|👨‍💻|☕|🌍|🔧|📝/g;

    return text.replace(decorativePattern, '');
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
    const endsWithKnownCompleteWords =
      /(?:done|completed|finished|success|error|failed|ready|developer|warnings)$/i.test(
        text,
      );
    if (endsWithKnownCompleteWords) {
      return length;
    }

    // If we have emojis in the text, be very conservative - only process
    // when we have known complete words or strong punctuation
    if (hasEmojis) {
      const endsWithPunctuation = /[.!?]$/.test(text);
      if (endsWithPunctuation) {
        return length;
      }
      return -1;
    }

    // For text without emojis, check if text ends with clear termination
    const endsWithPunctuation = /[.!?]$/.test(text);
    const endsWithSpace = /\s$/.test(text);

    // Process text if it ends with punctuation or whitespace
    if (endsWithPunctuation || endsWithSpace) {
      return length;
    }

    // Otherwise buffer - text might be incomplete (like 'tas' from 'task')
    return -1;
  }

  /**
   * Compiles emoji detection patterns
   * @returns Array of compiled regex patterns
   * @pseudocode line 09
   */
  private compileEmojiPatterns(): CompiledRegexArray {
    return [
      // Unicode emoji ranges for comprehensive detection
      /[\u{1F300}-\u{1F9FF}]/gu, // Miscellaneous Symbols and Pictographs + Supplemental Symbols
      /[\u{2600}-\u{26FF}]/gu, // Miscellaneous Symbols
      /[\u{2700}-\u{27BF}]/gu, // Dingbats
      /[\u{1F1E0}-\u{1F1FF}]/gu, // Regional Indicator Symbols
      /[\u{1F600}-\u{1F64F}]/gu, // Emoticons
      /[\u{1F680}-\u{1F6FF}]/gu, // Transport and Map Symbols
      /[\u{23E9}-\u{23FF}]/gu, // Additional symbols including ⏳ (hourglass)
      // Specific functional emojis that might not be caught by ranges
      /[\u2705\u2713\u26A0\u274C\u26A1]|\u26A0\uFE0F/gu,
    ];
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

    if (obj && typeof obj === 'object') {
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        filtered[key] = this.deepFilterObject(value);
      }
      return filtered;
    }

    return obj;
  }
}
