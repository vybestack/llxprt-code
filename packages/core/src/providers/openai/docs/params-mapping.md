# OpenAI Responses API Parameter Mapping

This document describes how parameters are mapped from our internal `ResponsesRequestParams` to the OpenAI Responses API format.

## Field Mapping Table

| Internal Field      | Responses API Field | Type                     | Notes                                                          |
| ------------------- | ------------------- | ------------------------ | -------------------------------------------------------------- |
| `messages`          | `messages`          | `IMessage[]`             | Direct mapping. Cannot be used with `prompt`.                  |
| `prompt`            | `prompt`            | `string`                 | Shortcut for simple queries. Cannot be used with `messages`.   |
| `tools`             | `tools`             | `ITool[]`                | Maximum 16 tools allowed. Total JSON size must be <32KB.       |
| `stream`            | `stream`            | `boolean`                | Enables streaming responses.                                   |
| `conversationId`    | `conversation_id`   | `string`                 | For stateful conversations. Triggers message trimming warning. |
| `parentId`          | `parent_id`         | `string`                 | Parent message ID for conversation threading.                  |
| `tool_choice`       | `tool_choice`       | `string \| object`       | Tool selection strategy.                                       |
| `stateful`          | `stateful`          | `boolean`                | Enables stateful conversation mode.                            |
| `model`             | `model`             | `string`                 | **Required**. Model identifier.                                |
| `temperature`       | `temperature`       | `number`                 | Sampling temperature (0-2).                                    |
| `max_tokens`        | `max_tokens`        | `number`                 | Maximum tokens to generate.                                    |
| `top_p`             | `top_p`             | `number`                 | Nucleus sampling parameter.                                    |
| `frequency_penalty` | `frequency_penalty` | `number`                 | Frequency penalty (-2 to 2).                                   |
| `presence_penalty`  | `presence_penalty`  | `number`                 | Presence penalty (-2 to 2).                                    |
| `stop`              | `stop`              | `string \| string[]`     | Stop sequences.                                                |
| `n`                 | `n`                 | `number`                 | Number of completions to generate.                             |
| `logprobs`          | `logprobs`          | `boolean`                | Include log probabilities.                                     |
| `top_logprobs`      | `top_logprobs`      | `number`                 | Number of top log probabilities to return.                     |
| `response_format`   | `response_format`   | `object`                 | Response format specification.                                 |
| `seed`              | `seed`              | `number`                 | Random seed for deterministic output.                          |
| `logit_bias`        | `logit_bias`        | `Record<string, number>` | Token bias adjustments.                                        |
| `user`              | `user`              | `string`                 | End-user identifier.                                           |

## Validation Rules

### 1. Message/Prompt Exclusivity

- Either `messages` or `prompt` must be provided, but not both
- Throws error if both are specified
- Throws error if neither is specified

### 2. Tool Constraints

- Maximum 16 tools allowed
- Total JSON size of tools must be less than 32KB
- Throws error if limits are exceeded

### 3. Stateful Mode Warnings

- When `conversationId` is provided with `messages`, a warning is logged
- Future implementations may trim messages to maintain context window

### 4. Required Fields

- `model` is always required for the Responses API

## Usage Examples

### Simple Prompt Request

```typescript
const request = buildResponsesRequest({
  model: 'gpt-4o',
  prompt: 'Hello, how are you?',
  stream: true,
});
```

### Conversation with Tools

```typescript
const request = buildResponsesRequest({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is the weather?' }],
  tools: [weatherTool],
  tool_choice: 'auto',
  temperature: 0.7,
});
```

### Stateful Conversation

```typescript
const request = buildResponsesRequest({
  model: 'gpt-4o',
  messages: [
    /* conversation history */
  ],
  conversationId: 'conv-123',
  parentId: 'msg-456',
  stateful: true,
});
```
