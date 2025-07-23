import { ITokenizer } from './ITokenizer.js';

export class AnthropicTokenizer implements ITokenizer {
  /**
   * Count tokens for Anthropic models
   *
   * Anthropic uses a tokenizer similar to Claude's tiktoken-based tokenizer.
   * Since there's no official @anthropic-ai/tokenizer package available,
   * we use a character-based estimation that aligns with typical Claude tokenization:
   * - Average ~3.5-4 characters per token for English text
   * - More conservative estimate for code and special characters
   *
   * This estimation should be within 10-15% of actual token counts for most content.
   *
   * @param text The text to tokenize
   * @param model The model name (for model-specific tokenization if needed)
   * @returns Estimated token count
   */
  async countTokens(text: string, _model: string): Promise<number> {
    // Base estimation: ~4 characters per token
    let baseEstimate = text.length / 4;

    // Adjust for code content (more tokens due to special characters)
    const codeIndicators = /[{}[\]()<>:;=,\n\t]/g;
    const codeMatches = text.match(codeIndicators);
    if (codeMatches && codeMatches.length > text.length * 0.1) {
      // If more than 10% special characters, it's likely code
      baseEstimate = text.length / 3.5;
    }

    // Adjust for whitespace (multiple spaces/newlines count as fewer tokens)
    const whitespaceRuns = text.match(/\s{2,}/g);
    if (whitespaceRuns) {
      const extraWhitespace = whitespaceRuns.reduce(
        (sum, run) => sum + run.length - 1,
        0,
      );
      baseEstimate -= extraWhitespace / 4;
    }

    // Round up to be conservative (better to overestimate than underestimate)
    return Math.ceil(baseEstimate);
  }
}
