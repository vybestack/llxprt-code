# 07 – REQ-002 Usage-Driven Accounting – TDD Phase

Goal
- Write behavioral tests proving we use server-provided usage from response.completed when present, fall back to estimator otherwise, and emit a usage-bearing message by end of stream. Maps to [REQ-002.1..REQ-002.3].

Target
- Module(s):
  - packages/core/src/providers/openai/streamUsageAccounting.ts (wrapWithUsageAccounting)
  - packages/core/src/providers/openai/OpenAIProvider.ts (integration to ensure accounting used)

Behavioral Tests (each includes @requirement)
1) Server usage preferred over estimator
   /**
    * @requirement REQ-002.1
    * @scenario Server emits usage in response.completed
    * @given stream messages: text chunks + final usage message {input_tokens:10, output_tokens:3, total_tokens:13}
    * @when wrapped iterator consumed
    * @then cache updated using server usage, not estimator
    */

2) Estimator fallback only when server usage absent
   /** @requirement REQ-002.2 */
   - Input: text chunks only, no completed usage
   - Expect: cache uses estimator; no fabricated usage message emitted

3) Always emit usage-bearing message when server usage present
   /** @requirement REQ-002.3 */
   - Input: only text chunks and later response.completed usage
   - Expect: one usage-bearing IMessage emitted at end

4) Mixed content + tool_calls + server usage
   /** @requirement REQ-002.1, REQ-002.3 */
   - Interleave tool call messages and text; ensure final usage emitted and cache updated via server values

5) Robustness: abrupt stream end without usage
   /** @requirement REQ-002.2 */
   - Expect: no thrown error, estimator allowed, no fake usage message

Test Rules (docs/RULES.md)
- Input→Output behavior; assert cache numeric deltas, emitted usage message presence/content
- No mock-theater; if cache is injected, assert on real state changes

File Plan
- test/providers/openai/streamUsageAccounting.spec.ts

TODOLIST
- [ ] Add test file and scenarios with @requirement tags
- [ ] Ensure tests initially fail with NotYetImplemented
- [ ] Commit tests only

References
- ../specification.md [REQ-002]
- ../analysis/pseudocode/002-usage-driven-accounting.md
- ../../docs/RULES.md