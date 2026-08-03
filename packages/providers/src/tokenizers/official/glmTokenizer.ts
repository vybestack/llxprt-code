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
 * GLM 5.2 official tokenizer configuration.
 *
 * Source: zai-org/GLM-5.2 (HuggingFace)
 *   - tokenizer.json model.vocab → converted to tiktoken BPE format
 *   - pre_tokenizer Split regex → pat_str
 *
 * The GLM 5.2 tokenizer uses byte-level BPE with a cl100k_base-like
 * pre-tokenizer regex. The HF BPE vocabulary was converted to tiktoken
 * format via the standard GPT-2 byte-to-unicode inverse mapping.
 * This conversion is valid because the underlying algorithm is
 * byte-level BPE, not an incompatible tokenizer type.
 */
const GLM_PAT_STR =
  String.raw`(?i:'s|'t|'re|'ve|'m|'ll|'d)|` +
  String.raw`[^\r\n\p{L}\p{N}]?\p{L}+|` +
  String.raw`\p{N}{1,3}|` +
  String.raw` ?[^\s\p{L}\p{N}]+[\r\n]*|` +
  String.raw`\s*[\r\n]+|` +
  String.raw`\s+(?!\S)|` +
  String.raw`\s+`;

const GLM_SPECIAL_TOKENS: Record<string, number> = {
  '<|endoftext|>': 154_820,
  '[MASK]': 154_821,
  '[gMASK]': 154_822,
  '[sMASK]': 154_823,
  '<sop>': 154_824,
  '<eop>': 154_825,
  '<|system|>': 154_826,
  '<|user|>': 154_827,
  '<|assistant|>': 154_828,
  '<|observation|>': 154_829,
  '<|begin_of_image|>': 154_830,
  '<|end_of_image|>': 154_831,
  '<|begin_of_video|>': 154_832,
  '<|end_of_video|>': 154_833,
  '<|begin_of_audio|>': 154_834,
  '<|end_of_audio|>': 154_835,
  '<|begin_of_transcription|>': 154_836,
  '<|end_of_transcription|>': 154_837,
  '<|code_prefix|>': 154_838,
  '<|code_middle|>': 154_839,
  '<|code_suffix|>': 154_840,
  '<think>': 154_841,
  '</think>': 154_842,
  '<tool_call>': 154_843,
  '</tool_call>': 154_844,
  '<tool_response>': 154_845,
  '</tool_response>': 154_846,
  '<arg_key>': 154_847,
  '</arg_key>': 154_848,
  '<arg_value>': 154_849,
  '</arg_value>': 154_850,
  '/nothink': 154_851,
  '<|begin_of_box|>': 154_852,
  '<|end_of_box|>': 154_853,
  '<|image|>': 154_854,
  '<|video|>': 154_855,
};

export const GLM_MANIFEST: AssetManifest = {
  model: 'glm-5.2',
  source: 'huggingface.co/zai-org/GLM-5.2',
  revision: 'b4734de4facf877f85769a911abafc5283eab3d9',
  sourceFile: 'tokenizer.json',
  assetFile: 'tokenizer.bpe',
  sha256: 'd2a312b6d9fa24fc27bdea3387e65477c427214e2fb2372e5f3ae980ffaa3e1d',
  license: 'MIT',
  conversion: 'hf-bpe-to-tiktoken',
};

export class GlmTokenizer implements RuntimeTokenizer {
  private readonly runtime: TiktokenRuntime;

  constructor(assetLoader?: AssetLoader) {
    const loader = assetLoader ?? new AssetLoader();
    const bpeRanks = loader.loadBpe('glm-5.2', GLM_MANIFEST);
    this.runtime = new TiktokenRuntime({
      model: 'glm-5.2',
      bpeRanks,
      patStr: GLM_PAT_STR,
      specialTokens: GLM_SPECIAL_TOKENS,
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
