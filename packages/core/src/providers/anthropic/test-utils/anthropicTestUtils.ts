export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: unknown;
      is_error?: boolean;
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  stream?: boolean;
  thinking?: {
    type: 'adaptive' | 'enabled';
    budget_tokens?: number;
  };
  output_config?: {
    effort?: 'low' | 'medium' | 'high' | 'max';
  };
}
