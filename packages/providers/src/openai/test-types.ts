// Type definitions for OpenAI Provider tests

// Quick utility types for linting and testing
export type AnyObject = Record<string, unknown>;
export type UnknownArray = unknown[];
export type MockChunkType = Record<string, unknown>;

export interface MockResponse {
  choices?: Array<{
    delta?: Record<string, unknown>;
    message?: {
      tool_calls?: Array<Record<string, unknown>>;
    };
  }>;
  usage?: Record<string, unknown>;
  model?: string;
  id?: string;
  object?: string;
  created?: number;
}

export interface ToolCallData {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface MockToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  delta?: Record<string, unknown>;
}

export type StreamChunk = Record<string, unknown>;
export type MockChunk = Record<string, unknown>;
