# Integration Testing Strategy

## Introduction

This document defines when integration tests should use real LLM calls versus mocks. The goal is to prevent **"mock theater"**—tests that provide false confidence by testing mocks instead of real behavior.

Our testing philosophy aligns with [dev-docs/RULES.md](../dev-docs/RULES.md):

- **Test behavior, not implementation**
- **100% behavior coverage** (not line coverage)
- Tests validate **what the system does**, not how it does it internally

Mock theater occurs when we mock the exact behavior we're trying to verify, resulting in tests that pass regardless of whether the actual system works.

---

## Test Categories

### Category 1: MUST Use Real LLM

These tests validate that the LLM **makes correct decisions**. Mocking these defeats the purpose—we need to verify the LLM understands the prompt and selects the appropriate action.

**When to use real LLM:**

- Tests validating LLM **chooses the correct tool** from ambiguous prompts
- Multi-turn reasoning tests (LLM must maintain context across turns)
- Tests for LLM error recovery behavior (LLM must recognize and handle errors)
- At least one representative test per tool category (canary tests)

**Examples from the codebase:**

| Test File                       | What It Validates                                     |
| ------------------------------- | ----------------------------------------------------- |
| `run_shell_command.test.ts`     | LLM decides to use shell tool for command execution   |
| `file-system.test.ts`           | LLM chooses appropriate read/write/edit tools         |
| `save_memory.test.ts`           | LLM decides to use memory tool when asked to remember |
| `replace.test.ts`               | LLM performs context-aware text replacement           |
| `google_web_search.test.ts`     | LLM uses search tool for current information          |
| `todo-continuation.e2e.test.js` | Complex multi-turn flows with state persistence       |
| `list_directory.test.ts`        | LLM navigates filesystem structure                    |
| `read_many_files.test.ts`       | LLM reads multiple files efficiently                  |

**Example: Real LLM test pattern**

```typescript
// From run_shell_command.test.ts - validates LLM decides to run a command
it('executes shell commands when requested', async () => {
  const result = await runCLI('create a file named test.txt with hello world');

  // Validates the LLM chose the correct tool AND executed it
  expect(result.stdout).toContain('test.txt');
  // Verify the actual file was created
  expect(fs.existsSync(path.join(testDir, 'test.txt'))).toBe(true);
});
```

---

### Category 2: CAN Be Mocked (Infrastructure/Pipeline Tests)

These tests validate **infrastructure mechanics**, not LLM decision-making. The LLM's choice is irrelevant—we're testing that our tooling correctly processes outputs, handles errors, and maintains system stability.

**When mocking is appropriate:**

- Tests validating JSON output format (structure, not content)
- Tests validating error handling for malformed inputs
- Tests validating stdin/stdout piping mechanics
- Crash prevention tests (expected to fail/error gracefully)
- Signal handling tests (Ctrl+C, SIGTERM, etc.)

**Examples from the codebase:**

| Test File                   | What It Validates                     |
| --------------------------- | ------------------------------------- |
| `session-summary.test.ts`   | JSON structure of session output      |
| `mixed-input-crash.test.ts` | Crash prevention with malformed input |
| `json-output.test.ts`       | Output format compliance              |
| `ctrl-c-exit.test.ts`       | Signal handling and graceful shutdown |
| `utf-bom-encoding.test.ts`  | File encoding handling                |

**Example: Mockable infrastructure test**

```typescript
// From json-output.test.ts - validates output format, not LLM choice
it('outputs valid JSON in JSON mode', async () => {
  const result = await runCLI('--output-format json "any prompt"');

  // We don't care what the LLM said, only that it's valid JSON
  expect(() => JSON.parse(result.stdout)).not.toThrow();
  expect(JSON.parse(result.stdout)).toHaveProperty('messages');
});
```

---

### Category 3: Hybrid Tests

These tests mock the LLM decision but test real tool execution. Useful when:

- Tool mechanics are complex and need isolation from LLM non-determinism
- You need deterministic test scenarios for edge cases
- Testing tool error handling paths that are hard to trigger via LLM

**Pattern:** Inject a predetermined tool call, validate real execution

```typescript
// Hybrid approach: mock the LLM's decision, test real tool execution
it('handles file write errors gracefully', async () => {
  // Simulate LLM choosing to write to a read-only location
  const mockToolCall = {
    tool: 'write_file',
    params: { path: '/readonly/file.txt', content: 'test' },
  };

  const result = await executeToolCall(mockToolCall);

  // Validates real error handling, not mock behavior
  expect(result.error).toContain('permission denied');
});
```

---

## Anti-Mock-Theater Guidance

### Warning Signs of Problematic Mocks

| BAD Pattern                                        | Why It's Problematic                           |
| -------------------------------------------------- | ---------------------------------------------- |
| Mock returns exact expected output                 | Tests the mock, not the code                   |
| Test passes regardless of mock response            | Test isn't actually validating anything        |
| Mock setup is more complex than code under test    | Indicates testing implementation, not behavior |
| Test doesn't exercise any real integration points  | Not actually an integration test               |
| Mocking the exact behavior you're trying to verify | Circular logic—proves nothing                  |

**Example of mock theater:**

```typescript
// BAD: This tests the mock, not the LLM
it('LLM should choose the correct tool', async () => {
  // This mock IS the behavior we're testing!
  mockLLM.mockReturnValue({ tool: 'run_shell_command', args: {...} });

  const result = await processPrompt('run ls');

  // This will ALWAYS pass because we mocked it to pass
  expect(result.toolUsed).toBe('run_shell_command');
});
```

### Good Mock Usage

| GOOD Pattern                                               | Why It Works                           |
| ---------------------------------------------------------- | -------------------------------------- |
| Mock provides input to test downstream behavior            | Tests real code with controlled inputs |
| Test validates real code execution, not mock return values | Integration points are exercised       |
| Mock simulates external dependencies, not code under test  | Isolates the unit being tested         |

**Example of legitimate mock:**

```typescript
// GOOD: Mock the external API, test our parsing logic
it('handles malformed API response gracefully', async () => {
  // Mock external dependency, not our code
  mockExternalAPI.mockReturnValue({ invalid: 'response' });

  // Test OUR error handling of bad input
  const result = await ourCodeThatCallsAPI();

  expect(result.error).toBe('Invalid response format');
  expect(result.recovered).toBe(true);
});
```

---

## Decision Tree

Use this checklist when deciding whether to mock:

```
┌─────────────────────────────────────────────────────────────┐
│ Does the test validate that the LLM chooses the right tool? │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │ YES                           │ NO
              ▼                               ▼
        ┌─────────┐         ┌─────────────────────────────────┐
        │REAL LLM │         │ Does it validate multi-step LLM │
        └─────────┘         │ reasoning?                      │
                            └─────────────────────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              │ YES                           │ NO
                              ▼                               ▼
                        ┌─────────┐   ┌───────────────────────────────┐
                        │REAL LLM │   │ Does it only validate output  │
                        └─────────┘   │ format/structure?             │
                                      └───────────────────────────────┘
                                                        │
                                        ┌───────────────┴───────────────┐
                                        │ YES                           │ NO
                                        ▼                               ▼
                                  ┌──────────┐ ┌────────────────────────────┐
                                  │ CAN MOCK │ │ Does it expect errors/     │
                                  └──────────┘ │ crashes?                   │
                                               └────────────────────────────┘
                                                              │
                                              ┌───────────────┴───────────────┐
                                              │ YES                           │ NO
                                              ▼                               ▼
                                        ┌──────────┐ ┌────────────────────────────┐
                                        │ CAN MOCK │ │ Does it test infrastructure│
                                        └──────────┘ │ mechanics (I/O, signals)?  │
                                                     └────────────────────────────┘
                                                                    │
                                                    ┌───────────────┴───────────────┐
                                                    │ YES                           │ NO
                                                    ▼                               ▼
                                              ┌──────────┐                   ┌─────────┐
                                              │ CAN MOCK │                   │REAL LLM │
                                              └──────────┘                   │(default)│
                                                                             └─────────┘
```

**Quick Reference Checklist:**

1. Does the test validate that the LLM chooses the right tool? → **REAL LLM**
2. Does the test validate multi-step LLM reasoning? → **REAL LLM**
3. Does the test only validate output format/structure? → **CAN MOCK**
4. Does the test expect errors/crashes? → **CAN MOCK**
5. Does the test validate infrastructure mechanics? → **CAN MOCK**
6. **Unsure? → Default to REAL LLM**

---

## Minimum Real LLM Coverage

To catch LLM behavior regressions, maintain **at least one real LLM test per tool category**:

| Tool Category     | Canary Test(s)                  | Purpose                                 |
| ----------------- | ------------------------------- | --------------------------------------- |
| Shell execution   | `run_shell_command.test.ts`     | Validates LLM can execute commands      |
| File operations   | `file-system.test.ts`           | Validates LLM can read/write/edit files |
| Memory            | `save_memory.test.ts`           | Validates LLM can store/recall memories |
| Search            | `google_web_search.test.ts`     | Validates LLM uses web search           |
| Multi-turn        | `todo-continuation.e2e.test.js` | Validates LLM maintains context         |
| Text manipulation | `replace.test.ts`               | Validates context-aware edits           |

**These canary tests serve as early warning systems.** If an LLM provider change or model update affects tool selection behavior, these tests will catch it before it reaches production.

### Adding New Tools

When adding a new tool:

1. **Create at least one real LLM integration test** that validates the LLM correctly chooses and uses the tool
2. Document the test in this file under the appropriate category
3. Additional infrastructure tests can be mocked as appropriate

---

## Summary

| Question                             | Answer                                 |
| ------------------------------------ | -------------------------------------- |
| Testing LLM decision-making?         | Real LLM                               |
| Testing output format?               | Can mock                               |
| Testing error handling?              | Can mock                               |
| Testing tool mechanics in isolation? | Hybrid (mock decision, real execution) |
| Not sure?                            | Real LLM (safer default)               |

**Remember:** The purpose of integration tests is to verify the **integrated system works**. If you're not testing real integration points, reconsider whether it belongs in this test suite.
