/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { encoding_for_model, type TiktokenModel } from '@dqbd/tiktoken';
import { DebugLogger } from '../../debug/DebugLogger.js';
import { type ITokenizer } from './ITokenizer.js';

export class OpenAITokenizer implements ITokenizer {
  private readonly logger = new DebugLogger('llxprt:tokenizer:openai');
  private encoderCache = new Map<
    string,
    ReturnType<typeof encoding_for_model>
  >();
  private readonly isWindows = process.platform === 'win32';

  async countTokens(text: string, model: string): Promise<number> {
    try {
      // Get or create encoder for the model
      let encoder = this.encoderCache.get(model);
      if (!encoder) {
        // Try to get encoder for the specific model
        try {
          encoder = encoding_for_model(model as TiktokenModel);
          this.encoderCache.set(model, encoder);
        } catch (_error) {
          // Fall back to o200k_base encoding for newer models
          this.logger.debug(
            () => `No specific encoding for model ${model}, using o200k_base`,
          );
          encoder = encoding_for_model('gpt-4o-mini');
          this.encoderCache.set(model, encoder);
        }
      }

      // Count tokens
      const tokens = encoder.encode(text);
      return tokens.length;
    } catch (error) {
      console.error('Error counting tokens:', error);
      // Fallback: rough estimate based on characters
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Clean up encoder resources
   */
  dispose(): void {
    if (this.isWindows) {
      this.encoderCache.clear();
      return;
    }

    for (const encoder of this.encoderCache.values()) {
      encoder.free();
    }
    this.encoderCache.clear();
  }
}
