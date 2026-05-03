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

import type { OpenAIResponsesTool } from './schemaConverter.js';

export type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; file_data: string; filename?: string };

export type ResponsesInputItem =
  | {
      role: 'user' | 'assistant';
      content?: string | ResponsesContentPart[];
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    }
  | {
      type: 'reasoning';
      id: string;
      summary?: Array<{ type: string; text: string }>;
      encrypted_content?: string;
    };

export type OpenAIResponsesRequest = {
  model: string;
  input: ResponsesInputItem[];
  instructions?: string;
  tools?: OpenAIResponsesTool[];
  tool_choice?: string;
  parallel_tool_calls?: boolean;
  stream: boolean;
  include?: string[];
  reasoning?: { effort?: string; summary?: string };
  text?: { verbosity: string };
  store?: boolean;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
  [key: string]: unknown;
};
