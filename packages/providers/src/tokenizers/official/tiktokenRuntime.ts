/**
 * Copyright 2026 Vybestack LLC
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

import { Tiktoken } from '@dqbd/tiktoken';
import {
  createLongTextCounter,
  type LongTextCounter,
} from '@vybestack/llxprt-code-core/utils/neutral-long-piece.js';
import { tokenizationFailedError } from './errors.js';

/**
 * Shared runtime adapter that wraps the @dqbd/tiktoken WASM encoder.
 *
 * Each model configures its own BPE ranks, regex pattern (pat_str), and
 * special-token mapping. The encoder is constructed lazily on first use
 * and cached for the lifetime of the instance.
 */
export interface TiktokenModelConfig {
  /** Canonical model identifier. */
  readonly model: string;
  /** BPE ranks in tiktoken .tiktoken format (base64 rank per line). */
  readonly bpeRanks: string;
  /** Regex pattern for pre-tokenization. */
  readonly patStr: string;
  /** Special-token name → token-id mapping. */
  readonly specialTokens: Record<string, number>;
}

export class TiktokenRuntime {
  private encoder: Tiktoken | undefined;
  private readonly countLong: LongTextCounter;

  constructor(private readonly config: TiktokenModelConfig) {
    this.countLong = createLongTextCounter(config.bpeRanks, config.patStr);
  }

  private getEncoder(): Tiktoken {
    this.encoder ??= new Tiktoken(
      this.config.bpeRanks,
      this.config.specialTokens,
      this.config.patStr,
    );
    return this.encoder;
  }

  /**
   * Encode text as ordinary BPE tokens (no special-token processing).
   *
   * Strings that resemble special tokens are encoded as their constituent
   * BPE bytes, never as structural control tokens.
   */
  encodeOrdinary(text: string): number[] {
    try {
      return Array.from(this.getEncoder().encode_ordinary(text));
    } catch (e) {
      throw tokenizationFailedError(
        this.config.model,
        e instanceof Error ? e.message : String(e),
        e,
      );
    }
  }

  /**
   * Encode text with explicit control over special-token handling.
   *
   * @param text         Input text.
   * @param allowSpecial When true, registered special-token strings are
   *                     encoded as their control-token IDs. When false,
   *                     all text is treated as ordinary content.
   */
  encode(text: string, allowSpecial: boolean): number[] {
    try {
      const encoder = this.getEncoder();
      if (allowSpecial) {
        return Array.from(encoder.encode(text, 'all', []));
      }
      return Array.from(encoder.encode(text, [], []));
    } catch (e) {
      throw tokenizationFailedError(
        this.config.model,
        e instanceof Error ? e.message : String(e),
        e,
      );
    }
  }

  /** Count without allocating token IDs or scanning long BPE pieces quadratically. */
  count(text: string, allowSpecial: boolean): number {
    try {
      const encoder = this.getEncoder();
      const ordinary = (value: string): number =>
        this.countLong(value, (piece) => encoder.encode_ordinary(piece).length);
      if (!allowSpecial) return ordinary(text);
      const specials = Object.keys(this.config.specialTokens);
      if (specials.length === 0) return ordinary(text);
      const pattern = new RegExp(
        specials
          .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'g',
      );
      let count = 0;
      let start = 0;
      for (const match of text.matchAll(pattern)) {
        count += ordinary(text.slice(start, match.index)) + 1;
        start = match.index + match[0].length;
      }
      return count + ordinary(text.slice(start));
    } catch (e) {
      throw tokenizationFailedError(
        this.config.model,
        e instanceof Error ? e.message : String(e),
        e,
      );
    }
  }

  /** Count tokens in ordinary text. */
  countOrdinary(text: string): number {
    return this.count(text, false);
  }

  /** Release WASM resources. */
  dispose(): void {
    if (this.encoder !== undefined) {
      if (process.platform !== 'win32') {
        this.encoder.free();
      }
      this.encoder = undefined;
    }
  }
}
