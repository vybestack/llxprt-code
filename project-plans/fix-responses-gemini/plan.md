# Plan: Fix Stateful Responses API Integration

## TDD Progress Checklist

- [ ] **Part 1.1**: Create `ConversationContext.ts` file with class and method shells.
- [ ] **Part 1.2**: Create `ConversationContext.test.ts` and implement unit tests to validate the class logic.
- [ ] **Part 1.3**: Implement the logic in `ConversationContext.ts` to make all its unit tests pass.

- [ ] **Part 2.1**: Create `OpenAIProvider.stateful.integration.test.ts` with the two test cases (`o3` stateful and `gpt-3.5-turbo` stateless).
- [ ] **Part 2.2**: Run the integration tests and confirm that they **FAIL** as expected.

- [ ] **Part 3.1**: Implement the provider logic in `OpenAIProvider.ts` to read from and write to the `ConversationContext`.
- [ ] **Part 3.2**: Run the integration tests and confirm that they now **PASS**.

- [ ] **Part 4.1**: Implement the UI logic in `SessionController.tsx` to manage the `ConversationContext` lifecycle (on new/load session).

- [ ] **Part 5.1**: Perform manual verification as outlined in the plan.
- [ ] **Part 5.2**: Cleanup and remove any temporary test files or debug logging.

---

## 1. Overview

The core issue is that stateful "Responses API" models (like `o3`) are not functioning as intended within the `OpenAIProvider`. The `conversationId`, which is essential for stateful interaction, is not being passed from the application layer to the provider. This results in every request being treated as stateless, sending the full message history each time and preventing features like session saving/loading from working correctly with these models.

This plan outlines the creation of a state management bridge to connect the application's conversation lifecycle with the provider's execution logic, ensuring true statefulness.

## 2. Problem Analysis: The Disconnected Layers

The current architecture has a clean separation between the UI and Provider layers, but this has created a communication gap for stateful information.

- **Stateless Interface**: The `IProvider` interface defines a stateless `generateChatCompletion` method, which does not accept a `conversationId`.
  - **Source**: `packages/cli/src/providers/IProvider.ts`

- **Stateful Implementation**: The `OpenAIProvider`'s internal `callResponsesEndpoint` method *is* designed to be stateful and expects a `conversationId` to manage caching and context.
  - **Source**: `packages/cli/src/providers/openai/OpenAIProvider.ts`

- **The Broken Link**: The public `generateChatCompletion` method calls `callResponsesEndpoint` but has no `conversationId` to give it. This is the central failure point.

- **Inefficient Fallback**: Because `conversationId` is always missing, the message trimming logic in `buildResponsesRequest` is never executed. The application incorrectly sends the entire message history on every request, defeating the purpose of the stateful Responses API.
  - **Source**: `packages/cli/src/providers/openai/buildResponsesRequest.ts`

## 3. Solution: A `ConversationContext` State Bridge

To fix this without violating architectural boundaries, we will introduce a singleton state manager, `ConversationContext`, to act as a bridge.

- **The UI Layer (`SessionController`) will WRITE to the bridge.** It remains the source of truth for the conversation's lifecycle (start, end, load).
- **The Provider Layer (`OpenAIProvider`) will READ from the bridge.** It will consume the context to make stateful API calls.

This maintains a clean separation of concerns while ensuring the two layers are always synchronized.

## 4. Implementation Steps

### Step 1: Create the `ConversationContext` Singleton

Create a new file to house the state manager. This singleton will hold the active `conversationId` and `parentId`.

- **File to Create**: `packages/cli/src/utils/ConversationContext.ts`
- **Key Exports**:
  - A class `ConversationContextManager` with methods:
    - `startNewConversation()`: Generates a new `conversationId`.
    - `getContext()`: Returns the current `{ conversationId, parentId }`.
    - `setParentId(newParentId: string)`: Updates the parent ID for the next turn.
    - `setContext({ conversationId, parentId })`: Restores state when loading a session.
  - A singleton instance: `export const ConversationContext = new ConversationContextManager();`

### Step 2: Integrate `ConversationContext` with the UI Lifecycle

Modify the main UI controller to manage the `ConversationContext` singleton, tying its lifecycle to the `history` object.

- **File to Modify**: `packages/cli/src/ui/containers/SessionController.tsx`
- **Logic to Add**:
  - **On New Conversation**: When the `history` is cleared (e.g., on initial load or via `/clear`), call `ConversationContext.startNewConversation()`.
  - **On Load Session**: When a chat session is loaded via `/chat load`, check if the loaded data contains a `conversationContext` object. If it does, call `ConversationContext.setContext(...)` to restore the state.

### Step 3: Connect the `OpenAIProvider` to the Context Bridge

Modify the provider to read from the `ConversationContext` before making an API call.

- **File to Modify**: `packages/cli/src/providers/openai/OpenAIProvider.ts`
- **Logic to Add**:
  - Inside `generateChatCompletion`, right before calling `callResponsesEndpoint`, retrieve the context: `const { conversationId, parentId } = ConversationContext.getContext();`.
  - Pass these variables into the `options` object for `callResponsesEndpoint`. This will fix the broken link and enable the message trimming logic in `buildResponsesRequest`.

### Step 4: Update the Context After a Response

Modify the provider to update the `parentId` in the context bridge after receiving a response. This is critical for chaining conversation turns.

- **File to Modify**: `packages/cli/src/providers/openai/OpenAIProvider.ts`
- **Logic to Add**:
  - Inside `handleResponsesApiResponse`, after a message chunk containing an `id` is received from the stream, call `ConversationContext.setParentId(message.id)`.
  - **Note**: This requires that the `IMessage` interface and the `parseResponsesStream` function correctly expose the message ID from the API response. This needs to be verified during implementation.

## 5. Test-Driven Development (TDD) Strategy

This project will strictly follow a TDD methodology. I will write failing tests first to define the required functionality, then write the minimum implementation code to make the tests pass, and finally refactor.

### Part 1: Unit Testing the State Manager
**Methodology:** First, create the shell `ConversationContext.ts` file. Then, create the test file and implement the tests below. The implementation will be written to make these tests pass.

- **File to Create**: `packages/cli/src/utils/ConversationContext.test.ts`
- **Goal**: To rigorously validate the logic of the `ConversationContextManager` class.
- **Test Cases**:
    - `it('should initialize with a new context when getContext is called for the first time')`
    - `it('should start a new conversation with a new ID')`
    - `it('should correctly set and retrieve the parentId')`
    - `it('should correctly restore a full context object')`
    - `it('should reset the context')`

### Part 2: Integration Testing the Provider (TDD Driver)
**Methodology:** This is the core of the TDD loop. I will write these tests **after** the unit tests pass but **before** modifying `OpenAIProvider.ts`. These tests will make **live API calls** and will fail until the implementation steps in Section 4 are complete.

- **File to Create**: `packages/cli/src/providers/openai/OpenAIProvider.stateful.integration.test.ts`
- **Setup (`beforeAll`)**:
    1. Define the path to the API key: `const keyPath = path.join(os.homedir(), '.openai_key');`.
    2. Use a `try...catch` block to read the key: `apiKey = fs.readFileSync(keyPath, 'utf-8').trim();`.
    3. If the file doesn't exist, the entire test suite will be skipped using `it.skip(...)` in each test case.
    4. Instantiate the real provider: `provider = new OpenAIProvider(apiKey);`.
- **Isolation (`beforeEach`)**:
    1. Before each test, call `ConversationContext.reset()` to ensure no state leaks between test cases.

- **Test Case 1 (FAILING FIRST): Stateful `o3` End-to-End Conversation**
    - `it('should maintain context across multiple turns with a stateful model (o3)')`
    - **Arrange**: Set model to `o3`, start a new conversation, define two prompts.
    - **Act & Assert (Turn 1)**: Call `generateChatCompletion` with prompt 1, consume the stream, assert that `ConversationContext.getContext().parentId` is now a non-empty string.
    - **Act & Assert (Turn 2)**: Call `generateChatCompletion` with prompt 2, consume the stream, and assert that the final response text correctly references information from prompt 1.

- **Test Case 2 (FAILING FIRST): Stateless `gpt-3.5-turbo` Regression Test**
    - `it('should not break stateless models by correctly passing full message history')`
    - **Arrange**: Set model to `gpt-3.5-turbo`, create a multi-message history array.
    - **Act**: Call `generateChatCompletion` with the full history plus a new prompt.
    - **Assert**: The final response text must correctly reference information from the earlier messages in the history array.

## 6. Manual Verification

After the automated tests pass, perform manual verification to ensure the end-to-end user experience is correct.

1.  **Enable Debug Logging**: Confirm that for the `o3` model, subsequent requests after the first one send a trimmed message list (`"input": [...]` contains only the last few messages).
2.  **Test Session Saving/Loading**:
    - Start a conversation with `o3`.
    - Save the session using `/chat save o3_test`.
    - Clear the session using `/clear`.
    - Load the session using `/chat load o3_test`.
    - Continue the conversation and verify it works, confirming the context was restored.
3.  **Test Stateless Models**: Ensure that models like `gemini-1.5-pro` continue to function correctly and are unaffected by these changes.
