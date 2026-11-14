# Streaming response logging

Conversation responses are redacted and written incrementally. The provider wrapper no longer retains the completed response text for logging. Each write is awaited before another provider chunk is requested, so filesystem backpressure cannot create a queue of response chunks.

## Redaction bounds

`StreamingRedactor` applies rules in the same order as `ConfigBasedRedactor`. Each rule has its own input window because earlier replacements can create input for later rules. Regex syntax is parsed with `@eslint-community/regexpp`. The retained suffix covers the maximum match width plus assertion context. A bounded left-context window preserves word boundaries and lookbehind after an emitted prefix. UTF-16 surrogate pairs are not cut at emission boundaries.

Finite repetition bounds are preserved, including configured patterns longer than the built-in rules. Open-ended repetitions (`*`, `+`, and `{n,}`) are bounded to 4,096 repetitions, or their minimum when that is greater. Character classes reserve two UTF-16 code units per character. Alternations take the widest branch, sequences add widths, and quantifiers multiply widths. `retentionLimit` sums both context windows for all enabled rules. This bound does not grow with the response length.

When an open-ended match observed in the current window exceeds its bounded form, logging fails rather than writing a partially redacted secret. Arbitrary custom patterns are interpreted with these finite repetition bounds. In particular, a custom pattern whose terminator lies beyond its bound does not have unlimited lookahead. Configure finite patterns appropriate to the secrets being protected.

Regex backreferences, sticky patterns, Unicode-set (`v`) patterns, and replacement strings that request the entire prefix or suffix are rejected before response consumption. Those forms need additional streaming semantics; they are not evaluated independently on provider chunks. Ordinary captures, named captures, non-global replacement, bounded lookaround and boundary assertions are supported.

## Files and telemetry

Redacted response pieces are JSON-string escaped into a permanent `response-<uuid>.jsonl` artifact in the conversation-log directory. No temporary response file is used. One trailing high surrogate is held until the next write, so splitting a surrogate pair does not change the JSON-string bytes. Completion adds the existing metadata fields and syncs the artifact. The existing daily conversation sink then appends it with a bounded file reader under its write chain. Concurrent responses can stream independently without holding that chain during provider execution or retry logging.

Response telemetry carries `response_artifact`, containing the artifact identifier, local path, JSON-string byte offset, byte and character counts, SHA-256 digest and row count. It carries no response body string on this path. Strict mode retains durable-write-before-publication and telemetry acknowledgement ordering.

A source failure discards its partial response artifact and records the same empty failed response body as the earlier logger. Cancellation removes the unfinished artifact. Disk write failures retain the existing post-reply logging-failure behavior. The request-body logger and the nonstreaming response helper are unchanged.

## Verification

The provider tests compare streamed output with the earlier whole-response redactor, including every split offset in API keys, credentials, paths, URLs, email addresses and personal information. Additional cases advance the emission windows through secrets. Disk tests compare exact JSON-string bytes and cover escaping, surrogate splits, concurrent completion, source failure, cancellation and deferred telemetry. A 67,584,000-character response is fed in 22,000 chunks while checking the retained character bound after every chunk. An accumulating control must fail the same bound assertion.
