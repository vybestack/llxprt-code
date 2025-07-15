# Provider Runtime – Functional Specification

> Version: 0.1  
> Status: Draft  
> Owner: Core Team  
> Last updated: 2025-07-15

## 1 – Goals & Non-Goals

### 1.1 Goals
1. Offer a **single, strongly-typed API** for issuing text-generation requests to any LLM provider.
2. Move **all cross-cutting concerns** (retry, back-off, quota checking, token accounting, cost estimation, streaming helpers, telemetry) from individual provider classes into a common runtime.
3. Allow **new providers** to be integrated by supplying only a minimal "adapter" layer.
4. Provide **pluggable strategy hooks** so behaviour can be tuned per provider and/or per request.
5. Emit **uniform telemetry events** for observability and billing across all providers.
6. Remain **framework-agnostic** and usable by both `packages/core` and `packages/cli` without additional peer dependencies.

### 1.2 Non-Goals
* Implementing specific provider adapters (these will be delivered separately).
* UI changes in the CLI.
* Support for non text-generation modalities (vision, speech, etc.).

## 2 – Public Surface

```
+ provider-runtime
  ├─ index.ts                  // entry point, exports kernel + helpers
  ├─ types.ts                  // canonical request/response types
  ├─ strategies/               // pluggable strategy implementations
  │   ├─ retry.ts
  │   ├─ backoff.ts
  │   ├─ quota.ts
  │   ├─ cost.ts
  │   └─ streaming.ts
  └─ adapters/                // provider-specific shims live outside runtime
```

### 2.1 Canonical Types

```ts
// types.ts
export interface ProviderRequest {
  model: string;
  messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>;
  tools?: ToolCallSchema[];    // tool definitions if function calling is enabled
  maxTokens?: number;         // soft cap; runtime will enforce provider hard limits
  temperature?: number;
  stream?: boolean;
  extra?: Record<string, unknown>; // provider-specific raw params
}

export interface ProviderResponse {
  id: string;
  created: number;             // epoch millis
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    costUSD: number;
  };
  content?: string;            // when stream === false
  stream?: AsyncIterable<ProviderStreamChunk>; // when stream === true
}

export interface ProviderStreamChunk {
  delta: string;               // incremental text
  done: boolean;
}
```

### 2.2 Kernel API

```ts
export interface ProviderKernel {
  request(req: ProviderRequest): Promise<ProviderResponse>;
  registerAdapter(name: string, adapter: ProviderAdapter): void;
  setDefaultProvider(name: string): void;
}

export interface ProviderAdapter {
  name: string;                                        // e.g. "openai"
  maxTokens(model: string): number;                    // provider hard cap
  send(req: ProviderRequest, ctx: AdapterContext): Promise<AdapterResult>; // core call
  tokenizer?: Tokenizer;                               // optional custom tokenizer
  costStrategy?: CostStrategy;                         // cost computation override
  quotaStrategy?: QuotaStrategy;                       // quota error parser
  streamParser?: StreamParser;                         // streaming chunk parser
}
```

### 2.3 Strategy Interfaces

```ts
export type RetryStrategy = (attempt: number, err: unknown) => number | null;
// return ms to wait or null to fail immediately

export interface BackoffStrategy {
  nextDelay(attempt: number): number;                  // ms
}

export interface QuotaStrategy {
  isQuotaError(err: unknown): boolean;
}

export interface CostStrategy {
  compute(costInput: { tokens: number; model: string }): number; // USD
}

export interface StreamParser {
  parse(data: Uint8Array): Iterable<ProviderStreamChunk>;
}
```

### 2.4 Configuration

Runtime reads a top-level configuration file at startup (`provider-runtime.config.{json,ts}`) or accepts a JS object via `initRuntime(config)`.  Relevant keys:

```ts
interface RuntimeConfig {
  defaultProvider: string;
  providers: Record<string, {
    apiKeyEnv?: string;               // env var holding credential
    baseURL?: string;                 // optional override
    modelAliases?: Record<string,string>; // friendly → real name
    strategyOverrides?: Partial<{
      retry: RetryStrategy;
      backoff: BackoffStrategy;
      quota: QuotaStrategy;
      cost: CostStrategy;
      stream: StreamParser;
    }>;
  }>;
  telemetry?: {
    enabled: boolean;
    sink?: 'console'|'gcp'|'file'|'custom';
  };
}
```

## 3 – Behavioural Contracts

1. **Token Accounting**  
   If the adapter supplies a custom `tokenizer`, the kernel must use it; otherwise fall back to shared `@gemini-core/tokenizer` heuristics.

2. **Retry & Back-off**  
   The kernel invokes `retryStrategy` after any failure **before** looking at quota detection.  If strategy returns `null`, error is surfaced; otherwise waits the returned delay and re-sends.

3. **Quota Detection**  
   On HTTP/SDK errors the kernel calls `quotaStrategy.isQuotaError`.  If `true`, emits `telemetry.quota_hit` and terminates retries even if the retry strategy would allow.

4. **Streaming**  
   When `ProviderRequest.stream === true`, kernel passes a readable stream from adapter through `streamParser`.  Parser must yield chunks **incrementally**; kernel forwards them to caller *and* updates `usage.completionTokens` in real time when possible.

5. **Telemetry**  
   Kernel sends telemetry events:
   * `provider.request.start` – timestamp, provider, model, token estimate
   * `provider.request.success` – duration, costUSD, tokens
   * `provider.request.error` – duration, error class, isQuota
   * `provider.stream.chunk` – bytes, tokens (throttled)

6. **Cancellation**  
   `ProviderRequest` returns a `ProviderResponse` whose `stream` iterable respects `AbortSignal`.  If caller aborts, kernel cancels underlying HTTP request and emits `provider.request.cancelled`.

## 4 – Security & Compliance

* **Secret Handling** – API keys are read **only** from env vars or the process key-ring; never logged.  Kernel redacts any header beginning with `Authorization` or `api-key` in debug output.
* **PII** – Telemetry events are restricted to aggregate statistics; no request content is persisted.
* **Sandbox Awareness** – When running inside the sandbox executor, adapters must use the sandboxed fetch polyfill.

## 5 – Open Questions / TBD

* Should we expose a batch interface for parallel prompt evaluation? (e.g. embeddings endpoints)
* How to support vision/multimodal extensions without breaking type safety?
* Automatic circuit-breaker pooling across different CLIs within same process?

---

```text
END OF SPECIFICATION – implementation plan to follow in a separate document.
```