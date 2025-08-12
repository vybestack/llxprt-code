# Pseudocode: Usage-Driven Accounting in Streaming (REQ-002)

Note: Pseudocode only. No TypeScript. Maps to REQ-002.1..REQ-002.3. Follow docs/RULES.md.

Function: applyUsageAccounting(streamIterator, conversationId, parentId, promptMessages)
Inputs:
- streamIterator: async iterator of IMessage from parseResponsesStream
- conversationId: string | undefined
- parentId: string | undefined
- promptMessages: IMessage[] // the request messages
Outputs:
- async iterator of IMessage // same messages, but ensures a usage-bearing message is emitted; updates cache

Algorithm:
1. Initialize collectedMessages = []
2. Initialize serverUsage = null
3. For each message m in streamIterator:
   a) If m.usage exists → serverUsage = m.usage [REQ-002.1]
   b) If m.content or m.tool_calls → append to collectedMessages
   c) Yield m downstream
4. After stream ends:
   a) If conversationId && parentId && collectedMessages not empty:
      i) requestTokens = estimateTokens(promptMessages)
      ii) if serverUsage exists → responseTokens = serverUsage.completion_tokens else → responseTokens = estimateTokens(collectedMessages) [REQ-002.2]
      iii) totalForRequest = requestTokens + responseTokens (prefer server total if available)
      iv) cache.accumulatedTokens(conversationId,parentId) += totalForRequest [REQ-002.1]
   b) If serverUsage is null → emit usage fallback only if estimator is allowed? No; do not fabricate usage message. [REQ-002.2]
   c) If no usage message was emitted earlier and serverUsage exists → emit final IMessage { role: assistant, content: '', usage: serverUsage } [REQ-002.3]
5. Terminate

Error Handling:
- If cache set fails → ignore (non-fatal)
- If estimator throws → ignore and proceed without usage update

Mapping:
- REQ-002.1: prefer server usage
- REQ-002.2: estimator fallback, never override server usage
- REQ-002.3: ensure a usage-bearing message is emitted when server provides usage
