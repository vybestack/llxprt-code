# Preflight Fix Epic

The current `npm run preflight` fails due to numerous outdated or brittle test suites. This epic tracks the systematic repair of each failing area so that the full build, lint and **all tests** pass again.

## Task Breakdown

| #   | Area                                     | File(s) / Suite                                                | Status |
| --- | ---------------------------------------- | -------------------------------------------------------------- | ------ |
| 1   | Slash Command Processor                  | `src/ui/hooks/slashCommandProcessor.test.ts`                   | ☐      |
| 2   | MCP / Provider Manager Output Assertions | same file                                                      | ☐      |
| 3   | Quit / Exit handling                     | same file                                                      | ☐      |
| 4   | `useGeminiStream` hook                   | `src/ui/hooks/useGeminiStream.test.tsx`                        | ☐      |
| 5   | `Turn` core logic                        | `src/core/turn.test.ts`                                        | ☐      |
| 6   | `ToolFormatter` error semantics          | `src/tools/ToolFormatter.test.ts`                              | ☐      |
| 7   | `enhanceConfigWithProviders` integration | `src/providers/enhanceConfigWithProviders.test.ts`             | ☐      |
| 8   | Provider / Gemini switching              | `src/providers/provider-gemini-switching.test.ts`              | ☐      |
| 9   | OpenAI provider mock & integration       | `src/providers/openai/*.test.ts` & `.integration.test.ts`      | ☐      |
| 10  | Multi-provider integration flow          | `src/providers/integration/multi-provider.integration.test.ts` | ☐      |

Each sub-task has its own markdown file detailing:

- Current failing behaviour / errors
- Root cause hypothesis
- Fix strategy (code vs. test updates)
- Verification steps (specific `vitest --run` commands)

Progress is complete when the individual suite passes locally and CI preflight shows ✅.
