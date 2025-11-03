export interface ComplexityAnalysisResult {
  /** Complexity score from 0 to 1 */
  complexityScore: number;
  /** Whether the request is considered complex (score > threshold) */
  isComplex: boolean;
  /** List of detected tasks */
  detectedTasks: string[];
  /** Sequential indicators found (then, after, next, etc.) */
  sequentialIndicators: string[];
  /** Number of questions detected */
  questionCount: number;
  /** Whether to suggest using todos */
  shouldSuggestTodos: boolean;
  /** The suggestion reminder text if applicable */
  suggestionReminder?: string;
}

export interface ComplexityAnalyzerOptions {
  /** Threshold for considering a task complex (default: 0.5) */
  complexityThreshold?: number;
  /** Minimum number of tasks to suggest todos (default: 3) */
  minTasksForSuggestion?: number;
}

export interface AnalysisStats {
  /** Total number of analyses performed */
  totalAnalyses: number;
  /** Number of complex requests detected */
  complexRequestCount: number;
  /** Number of todo suggestions generated */
  suggestionsGenerated: number;
  /** Average complexity score across all analyses */
  averageComplexityScore: number;
}

/**
 * Service that analyzes user messages to detect multi-step tasks
 * and determine when todo lists should be suggested.
 * @requirement REQ-005.1
 */
export class ComplexityAnalyzer {
  private readonly complexityThreshold: number;
  private readonly minTasksForSuggestion: number;
  private analysisHistory: ComplexityAnalysisResult[] = [];

  // Sequential keywords that indicate multi-step processes
  private readonly sequentialKeywords = [
    'first',
    'second',
    'third',
    'then',
    'next',
    'after',
    'after that',
    'finally',
    'lastly',
    'subsequently',
    'following',
    'before',
    'afterward',
    'afterwards',
    'once',
    'when',
  ];

  // Task separator patterns for comma-separated lists
  private readonly taskSeparatorPattern = /(?:,\s*(?:and\s+)?|;\s*|\band\s+)/;
  // NOTE: File reference pattern no longer used to reduce false positives
  // private readonly fileReferencePattern = /(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9]+/g;

  constructor(options: ComplexityAnalyzerOptions = {}) {
    this.complexityThreshold = options.complexityThreshold ?? 0.6;
    this.minTasksForSuggestion = options.minTasksForSuggestion ?? 3;
  }

  /**
   * Analyzes a user message to determine its complexity and whether
   * it would benefit from using a todo list.
   * @requirement REQ-005.2
   */
  analyzeComplexity(message: string): ComplexityAnalysisResult {
    if (!message || message.trim().length === 0) {
      return this.createEmptyResult();
    }

    // Extract various complexity indicators
    const detectedTasks = this.extractTasks(message);
    const sequentialIndicators = this.findSequentialIndicators(message);
    const questionCount = this.countQuestions(message);

    // File references are no longer counted toward task detection
    // This was causing too many false positives for todo suggestions
    // const fileReferences = this.extractFileReferences(message);
    // for (const reference of fileReferences) {
    //   if (!detectedTasks.includes(reference)) {
    //     detectedTasks.push(reference);
    //   }
    // }

    // Calculate complexity score based on multiple factors
    const complexityScore = this.calculateComplexityScore({
      taskCount: detectedTasks.length,
      hasSequentialIndicators: sequentialIndicators.length > 0,
      sequentialIndicatorCount: sequentialIndicators.length,
      questionCount,
      messageLength: message.length,
    });

    const narrativeComplexity = this.isNarrativeComplex(
      message,
      detectedTasks.length,
    );

    const isComplex =
      complexityScore >= this.complexityThreshold || narrativeComplexity;
    const shouldSuggestTodos =
      isComplex &&
      (detectedTasks.length >= this.minTasksForSuggestion ||
        narrativeComplexity);

    const result: ComplexityAnalysisResult = {
      complexityScore,
      isComplex,
      detectedTasks,
      sequentialIndicators,
      questionCount,
      shouldSuggestTodos,
    };

    // Generate suggestion reminder if needed
    if (shouldSuggestTodos) {
      result.suggestionReminder =
        this.generateSuggestionReminder(detectedTasks);
    }

    // Track analysis for statistics
    this.analysisHistory.push(result);

    return result;
  }

  /**
   * Extracts individual tasks from the message using various patterns.
   * @requirement REQ-005.2
   */
  private extractTasks(message: string): string[] {
    const tasks: string[] = [];
    const addTask = (raw: string) => {
      const normalized = this.normalizeTaskText(raw);
      if (normalized.length > 0 && !tasks.includes(normalized)) {
        tasks.push(normalized);
      }
    };

    for (const line of message.split(/\r?\n/)) {
      const extracted = this.extractListTaskFromLine(line);
      if (extracted) {
        addTask(extracted);
      }
    }

    // If no list-style tasks found, check for comma-separated tasks
    if (tasks.length === 0) {
      // Look for patterns like "I need to X, Y, and Z"
      const needToPattern =
        /(?:need to|want to|have to|should|must|will)\s+([^\r\n.?!]+)/i;
      const match = message.match(needToPattern);

      if (match) {
        const taskString = match[1];
        const potentialTasks = taskString
          .split(this.taskSeparatorPattern)
          .map((t) => this.normalizeTaskText(t))
          .filter((t) => t.length > 3 && !t.includes('?'));

        if (potentialTasks.length >= 2) {
          for (const task of potentialTasks) {
            addTask(task);
          }
        }
      }
    }

    // If still no tasks found, check for sequential pattern sentences
    if (tasks.length === 0) {
      // Split by sentence-ending punctuation
      const sentences = message
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Check if we have sequential indicators suggesting multiple steps
      const hasSequentialIndicators =
        this.findSequentialIndicators(message).length > 0;

      if (hasSequentialIndicators && sentences.length >= 2) {
        // Extract tasks from sentences that likely contain actions
        for (const sentence of sentences) {
          const lowerSentence = sentence.toLowerCase();
          // Look for sentences with action verbs or sequential keywords
          if (
            this.sequentialKeywords.some((kw) => lowerSentence.includes(kw)) ||
            /\b(set up|configure|run|start|create|add|implement|build|deploy)\b/i.test(
              sentence,
            )
          ) {
            // Extract the main action from the sentence
            const actionMatch = sentence.match(
              /(?:first,?\s*|then\s*|after that,?\s*|finally,?\s*)?(.+)/i,
            );
            if (actionMatch) {
              const task = this.normalizeTaskText(actionMatch[1]);
              if (task.length > 0 && !tasks.includes(task)) {
                addTask(task);
              }
            }
          }
        }
      }
    }

    return tasks;
  }

  /**
   * Extracts file references from the message.
   * NOTE: No longer used for complexity counting to reduce false positives,
   * but kept in case needed for future functionality.
   */
  // private extractFileReferences(message: string): string[] {
  //   const references: string[] = [];
  //   const matches = message.matchAll(this.fileReferencePattern);

  //   for (const match of matches) {
  //     const reference = match[0].trim();
  //     if (reference.length > 0 && !references.includes(reference)) {
  //       references.push(reference);
  //     }
  //   }

  //   return references;
  // }

  /**
   * Finds sequential indicator keywords in the message.
   * @requirement REQ-005.2
   */
  private findSequentialIndicators(message: string): string[] {
    const lowerMessage = message.toLowerCase();
    const found: string[] = [];

    // Sort keywords by length (descending) to match longer phrases first
    const sortedKeywords = [...this.sequentialKeywords].sort(
      (a, b) => b.length - a.length,
    );

    for (const keyword of sortedKeywords) {
      // For multi-word keywords, use a different pattern
      const pattern = keyword.includes(' ')
        ? new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i')
        : new RegExp(`\\b${keyword}\\b`, 'i');

      if (pattern.test(lowerMessage) && !found.includes(keyword)) {
        found.push(keyword);
      }
    }

    return found;
  }

  /**
   * Counts the number of questions in the message.
   */
  private countQuestions(message: string): number {
    const questionPattern = /[^.!?]*\?/g;
    const matches = message.match(questionPattern);
    return matches ? matches.length : 0;
  }

  /**
   * Determines if a message is narrative-heavy enough to count as complex.
   */
  private isNarrativeComplex(
    message: string,
    detectedTaskCount: number,
  ): boolean {
    if (detectedTaskCount >= this.minTasksForSuggestion) {
      return false;
    }

    const trimmed = message.trim();
    const sentences = trimmed
      .split(/[.!?]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);

    if (trimmed.length >= 600) {
      return true;
    }

    return sentences.length >= 5;
  }

  private extractListTaskFromLine(line: string): string | null {
    const trimmed = line.trimStart();
    if (trimmed.length === 0) {
      return null;
    }

    const firstChar = trimmed[0];

    if (firstChar === '[') {
      const closingIndex = trimmed.indexOf(']');
      if (closingIndex >= 0 && closingIndex + 1 < trimmed.length) {
        const remainder = trimmed.slice(closingIndex + 1).trimStart();
        if (remainder.length > 0) {
          return remainder;
        }
      }
    }

    if (
      (firstChar === '-' || firstChar === '*' || firstChar === '•') &&
      trimmed.length > 1 &&
      this.isWhitespaceChar(trimmed[1])
    ) {
      let index = 1;
      while (index < trimmed.length && this.isWhitespaceChar(trimmed[index])) {
        index += 1;
      }
      const remainder = trimmed.slice(index);
      if (remainder.length > 0) {
        return remainder;
      }
    }

    const dotIndex = trimmed.indexOf('.');
    if (dotIndex > 0 && this.isAllDigits(trimmed.slice(0, dotIndex))) {
      const remainder = trimmed.slice(dotIndex + 1).trimStart();
      if (remainder.length > 0) {
        return remainder;
      }
    }

    return null;
  }

  private isAllDigits(value: string): boolean {
    if (value.length === 0) {
      return false;
    }
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 48 || code > 57) {
        return false;
      }
    }
    return true;
  }

  private normalizeTaskText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private isWhitespaceChar(character: string): boolean {
    return character.trim().length === 0;
  }

  /**
   * Calculates a complexity score based on various factors.
   */
  private calculateComplexityScore(factors: {
    taskCount: number;
    hasSequentialIndicators: boolean;
    sequentialIndicatorCount: number;
    questionCount: number;
    messageLength: number;
  }): number {
    let score = 0;

    // Task count is the primary factor - tuned to require more genuine complexity
    if (factors.taskCount >= 5) {
      score += 0.8;
    } else if (factors.taskCount >= 4) {
      score += 0.7; // Reduced from 0.75
    } else if (factors.taskCount >= 3) {
      score += 0.5; // Exactly threshold with 3 tasks
    } else if (factors.taskCount >= 2) {
      score += 0.3; // Reduced from 0.5
    } else if (factors.taskCount === 1) {
      score += 0.1; // Reduced from 0.2
    }

    // Sequential indicators add to complexity, but with reduced impact
    if (factors.hasSequentialIndicators) {
      // If we have sequential indicators but few detected tasks, boost the score
      if (factors.taskCount === 0) {
        score += 0.3; // Reduced from 0.5
      } else {
        score += Math.min(0.3, factors.sequentialIndicatorCount * 0.1); // Reduced from 0.4 and 0.15
      }
    }

    // Multiple questions indicate complexity, with slight reduction
    if (factors.questionCount >= 3) {
      score += 0.6; // Reduced from 0.65
    } else if (factors.questionCount >= 2) {
      score += 0.35; // Reduced from 0.4
    } else if (factors.questionCount === 1) {
      score += 0.08; // Reduced from 0.1
    }

    // Very long messages might be complex
    if (factors.messageLength > 500) {
      score += 0.1;
    } else if (factors.messageLength > 200) {
      score += 0.05;
    }

    // Normalize to [0, 1]
    return Math.min(1, score);
  }

  /**
   * Generates a suggestion reminder for using todos.
   * @requirement REQ-005.3
   */
  private generateSuggestionReminder(detectedTasks: string[]): string {
    const maxDisplay = Math.min(5, detectedTasks.length);
    const taskLines =
      maxDisplay === 0
        ? [
            '  - Break this request into discrete todos',
            '  - Capture each major area using TodoWrite',
            '  - Update the list as you progress',
          ]
        : detectedTasks.slice(0, maxDisplay).map((task) => `  - ${task}`);

    if (detectedTasks.length > maxDisplay && maxDisplay > 0) {
      taskLines.push(
        `  ... and ${detectedTasks.length - maxDisplay} more tasks`,
      );
    }

    const taskList = taskLines.join('\n');

    return `I notice you have multiple tasks to complete. Using a todo list would help track progress:\n\n${taskList}`;
  }

  /**
   * Creates an empty result for edge cases.
   */
  private createEmptyResult(): ComplexityAnalysisResult {
    const result: ComplexityAnalysisResult = {
      complexityScore: 0,
      isComplex: false,
      detectedTasks: [],
      sequentialIndicators: [],
      questionCount: 0,
      shouldSuggestTodos: false,
    };

    this.analysisHistory.push(result);
    return result;
  }

  /**
   * Gets the current complexity threshold.
   */
  getComplexityThreshold(): number {
    return this.complexityThreshold;
  }

  /**
   * Gets analysis statistics.
   * @requirement REQ-005.4
   */
  getAnalysisStats(): AnalysisStats {
    const totalAnalyses = this.analysisHistory.length;

    if (totalAnalyses === 0) {
      return {
        totalAnalyses: 0,
        complexRequestCount: 0,
        suggestionsGenerated: 0,
        averageComplexityScore: 0,
      };
    }

    const complexRequestCount = this.analysisHistory.filter(
      (r) => r.isComplex,
    ).length;
    const suggestionsGenerated = this.analysisHistory.filter(
      (r) => r.shouldSuggestTodos,
    ).length;
    const totalScore = this.analysisHistory.reduce(
      (sum, r) => sum + r.complexityScore,
      0,
    );

    return {
      totalAnalyses,
      complexRequestCount,
      suggestionsGenerated,
      averageComplexityScore: totalScore / totalAnalyses,
    };
  }

  /**
   * Resets the analysis history.
   */
  reset(): void {
    this.analysisHistory = [];
  }
}
