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

import type { RuntimeTokenizer } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizer.js';
import type { AssetManifest } from './assetManifest.js';
import { AssetLoader } from './assetLoader.js';
import { TiktokenRuntime } from './tiktokenRuntime.js';

/**
 * MiniMax M3 official tokenizer configuration.
 *
 * Source: MiniMaxAI/MiniMax-M3 (HuggingFace)
 *   - tokenizer.json model.vocab → converted to tiktoken BPE format
 *   - pre_tokenizer Split regex → pat_str (o200k_base pattern)
 *
 * The MiniMax M3 tokenizer uses byte-level BPE with the o200k_base
 * pre-tokenizer regex. The HF BPE vocabulary was converted to tiktoken
 * format via the standard GPT-2 byte-to-unicode inverse mapping.
 */
const MINIMAX_PAT_STR =
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?|` +
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?|` +
  String.raw`\p{N}{1,3}|` +
  String.raw` ?[^\s\p{L}\p{N}]+[\r\n]*|` +
  String.raw`\s*[\r\n]+|` +
  String.raw`\s+(?!\S)|` +
  String.raw`\s+`;

const MINIMAX_SPECIAL_TOKENS: Record<string, number> = {
  ']!p~[': 200_000,
  '<fim_prefix>': 200_001,
  '<fim_middle>': 200_002,
  '<fim_suffix>': 200_003,
  '<fim_pad>': 200_004,
  '<reponame>': 200_005,
  '<filename>': 200_006,
  '<gh_stars>': 200_007,
  '<issue_start>': 200_008,
  '<issue_comment>': 200_009,
  '<issue_closed>': 200_010,
  '<jupyter_start>': 200_011,
  '<jupyter_text>': 200_012,
  '<jupyter_code>': 200_013,
  '<jupyter_output>': 200_014,
  '<empty_output>': 200_015,
  '<commit_before>': 200_016,
  '<commit_msg>': 200_017,
  '<commit_after>': 200_018,
  ']~b]': 200_019,
  '[e~[': 200_020,
  ']!d~[': 200_021,
  '<function_call>': 200_022,
  '<code_interpreter>': 200_023,
  ']<]speech[>[': 200_024,
  ']<]image[>[': 200_025,
  ']<]video[>[': 200_026,
  ']<]start of speech[>[': 200_027,
  ']<]end of speech[>[': 200_028,
  ']<]start of image[>[': 200_029,
  ']<]end of image[>[': 200_030,
  ']<]start of video[>[': 200_031,
  ']<]end of video[>[': 200_032,
  ']<]vision pad[>[': 200_033,
  ']~!b[': 200_034,
  '<jupyter_error>': 200_035,
  '<add_file>': 200_036,
  '<delete_file>': 200_037,
  '<rename_file>': 200_038,
  '<edit_file>': 200_039,
  '<commit_message>': 200_040,
  '<empty_source_file>': 200_041,
  '<repo_struct>': 200_042,
  '<code_context>': 200_043,
  '<file_content>': 200_044,
  '<source_files>': 200_045,
  '<pr_start>': 200_046,
  '<review_comment>': 200_047,
  '<filepath>': 200_048,
  '<file_sep>': 200_049,
  '<think>': 200_050,
  '</think>': 200_051,
  '<tool_call>': 200_052,
  '</tool_call>': 200_053,
  ']<]frame[>[': 200_054,
  ']<]start of frame[>[': 200_055,
  ']<]end of frame[>[': 200_056,
  '<|content_altered_placeholder|>': 200_057,
  ']<]minimax[>[': 200_058,
  '<mm:think>': 200_059,
  '</mm:think>': 200_060,
};

export const MINIMAX_MANIFEST: AssetManifest = {
  model: 'minimax-m3',
  source: 'huggingface.co/MiniMaxAI/MiniMax-M3',
  revision: 'f0e1c1e04d40177e4673a22097036854f536e9c0',
  sourceFile: 'tokenizer.json',
  assetFile: 'tokenizer.bpe',
  sha256: '9b423908eab5445f88a72b26a283d848da80884fde9e0b8e5e7a4fe495313f1e',
  license: 'MiniMax-Community-License',
  conversion: 'hf-bpe-to-tiktoken',
};

export class MinimaxTokenizer implements RuntimeTokenizer {
  private readonly runtime: TiktokenRuntime;

  constructor(assetLoader?: AssetLoader) {
    const loader = assetLoader ?? new AssetLoader();
    const bpeRanks = loader.loadBpe('minimax-m3', MINIMAX_MANIFEST);
    this.runtime = new TiktokenRuntime({
      model: 'minimax-m3',
      bpeRanks,
      patStr: MINIMAX_PAT_STR,
      specialTokens: MINIMAX_SPECIAL_TOKENS,
    });
  }

  countTokens(content: unknown): number {
    const text =
      typeof content === 'string' ? content : JSON.stringify(content) || '';
    return this.runtime.countOrdinary(text);
  }

  dispose(): void {
    this.runtime.dispose();
  }
}
