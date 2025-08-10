# Qwen OAuth Implementation - Execution Guide

## Overview
This guide coordinates the autonomous implementation of Qwen OAuth support using subagents.

## Execution Strategy
- Phases 01-02: Analysis and design (can run in parallel)
- Phases 03-17: Component implementation (sequential TDD cycles)
- Phases 18-19: Integration and validation

## Phase Execution Commands

### Phase 1: Domain Analysis
```bash
# Subagent task
Task(
  description="Analyze OAuth domain",
  prompt="Read project-plans/qwenauth/specification.md and create comprehensive domain analysis. Analyze existing Gemini OAuth in packages/cli/src/auth/. Output to project-plans/qwenauth/analysis/domain-model.md. Include entity relationships, state transitions, business rules, auth fallback chains, edge cases, and error scenarios. Address all REQ tags from specification.",
  subagent_type="general-purpose"
)
```

### Phase 2: Pseudocode Development  
```bash
# Subagent task
Task(
  description="Create pseudocode",
  prompt="Based on project-plans/qwenauth/specification.md and analysis/domain-model.md, create detailed pseudocode for: token-store, qwen-device-flow, oauth-manager, openai-provider-oauth, and auth-command. Output each to project-plans/qwenauth/analysis/pseudocode/<component>.md. Include function signatures, algorithms, error handling. No actual TypeScript.",
  subagent_type="general-purpose"
)
```

### Phase 3-5: Token Store Implementation
```bash
# Stub phase
Task(
  description="Token store stub",
  prompt="Implement token store stub based on project-plans/qwenauth/plan/03-token-store-stub.md. Create packages/core/src/auth/token-store.ts with TokenStore interface and MultiProviderTokenStore class. All methods throw NotYetImplemented. Must compile with TypeScript strict mode.",
  subagent_type="typescript-coder"
)

# TDD phase
Task(
  description="Token store tests",
  prompt="Write behavioral tests based on project-plans/qwenauth/plan/04-token-store-tdd.md. Create packages/core/src/auth/token-store.spec.ts with 15-20 tests. Each test must have @requirement tag and test actual behavior with real file I/O. No mocks. Tests must fail with NotYetImplemented.",
  subagent_type="typescript-coder"
)

# Implementation phase
Task(
  description="Token store impl",
  prompt="Implement MultiProviderTokenStore based on project-plans/qwenauth/plan/05-token-store-impl.md. Make all tests from token-store.spec.ts pass. Use fs.promises, ensure 0600 permissions, atomic writes. Do NOT modify tests. Follow pseudocode exactly.",
  subagent_type="typescript-coder"
)
```

### Phase 6-8: Qwen Device Flow
```bash
# Stub phase
Task(
  description="Device flow stub",
  prompt="Implement Qwen device flow stub based on project-plans/qwenauth/plan/06-device-flow-stub.md. Create packages/core/src/auth/qwen-device-flow.ts with QwenDeviceFlow class. Include PKCE methods. All throw NotYetImplemented.",
  subagent_type="typescript-coder"
)

# TDD phase
Task(
  description="Device flow tests",
  prompt="Write behavioral tests based on project-plans/qwenauth/plan/07-device-flow-tdd.md. Create packages/core/src/auth/qwen-device-flow.spec.ts with 18-20 tests covering device flow, PKCE, polling, refresh. Use test HTTP server, no mocks. Tests must fail initially.",
  subagent_type="typescript-coder"
)

# Implementation phase
Task(
  description="Device flow impl",
  prompt="Implement QwenDeviceFlow based on project-plans/qwenauth/plan/08-device-flow-impl.md. Implement OAuth device flow with PKCE, use endpoints from spec, handle polling and refresh. Make all tests pass. Client ID: f0304373b74a44d2b584a3fb70ca9e56",
  subagent_type="typescript-coder"
)
```

### Phase 9-11: OAuth Manager
```bash
# Stub phase
Task(
  description="OAuth manager stub",
  prompt="Create OAuth manager stub based on project-plans/qwenauth/plan/09-oauth-manager-stub.md. Create packages/cli/src/auth/oauth-manager.ts with OAuthManager class for multi-provider coordination. All methods throw NotYetImplemented.",
  subagent_type="typescript-coder"
)

# TDD phase
Task(
  description="OAuth manager tests",
  prompt="Write behavioral tests based on project-plans/qwenauth/plan/10-oauth-manager-tdd.md. Create packages/cli/src/auth/oauth-manager.spec.ts with 15-18 tests for provider registration, authentication, token management, status. No mocks.",
  subagent_type="typescript-coder"
)

# Implementation phase
Task(
  description="OAuth manager impl",
  prompt="Implement OAuthManager based on project-plans/qwenauth/plan/11-oauth-manager-impl.md. Coordinate multiple OAuth providers, manage tokens, handle refresh. Make all tests pass without modifying them.",
  subagent_type="typescript-coder"
)
```

### Phase 12-14: OpenAI Provider OAuth
```bash
# Stub phase
Task(
  description="OpenAI provider stub",
  prompt="Extend OpenAI provider based on project-plans/qwenauth/plan/12-openai-provider-stub.md. Modify packages/core/src/providers/openai.ts to add OAuth support. Add auth resolution methods throwing NotYetImplemented. Preserve existing functionality.",
  subagent_type="typescript-coder"
)

# TDD phase
Task(
  description="OpenAI provider tests",
  prompt="Write behavioral tests based on project-plans/qwenauth/plan/13-openai-provider-tdd.md. Create packages/core/src/providers/openai-oauth.spec.ts with 15-18 tests for auth precedence, OAuth usage, refresh. Verify backward compatibility.",
  subagent_type="typescript-coder"
)

# Implementation phase
Task(
  description="OpenAI provider impl",
  prompt="Implement OAuth in OpenAI provider based on project-plans/qwenauth/plan/14-openai-provider-impl.md. Auth precedence: --key, env var, OAuth. Use OAuth token as API key. Maintain backward compatibility. All tests must pass.",
  subagent_type="typescript-coder"
)
```

### Phase 15-17: Auth Command Updates
```bash
# Stub phase
Task(
  description="Auth command stub",
  prompt="Modify auth command based on project-plans/qwenauth/plan/15-auth-command-stub.md. Update packages/cli/src/commands/auth.ts for OAuth-only menu, provider-specific flows. Remove API key setup. New methods throw NotYetImplemented.",
  subagent_type="typescript-coder"
)

# TDD phase
Task(
  description="Auth command tests",
  prompt="Write behavioral tests based on project-plans/qwenauth/plan/16-auth-command-tdd.md. Create packages/cli/src/commands/auth.spec.ts with 15-18 tests for OAuth menu, direct auth, multi-provider support. No API key options.",
  subagent_type="typescript-coder"
)

# Implementation phase
Task(
  description="Auth command impl",
  prompt="Implement auth command based on project-plans/qwenauth/plan/17-auth-command-impl.md. OAuth-only menu, support /auth qwen and /auth gemini, show auth status. Remove all API key setup code. Make tests pass.",
  subagent_type="typescript-coder"
)
```

### Phase 18: Integration Testing
```bash
Task(
  description="Integration tests",
  prompt="Create end-to-end tests based on project-plans/qwenauth/plan/18-integration-tests.md. Create test/integration/qwen-oauth-e2e.spec.ts with 12-15 integration tests. Test complete OAuth flows, multi-provider scenarios, token lifecycle, backward compatibility. Use real components, no mocks.",
  subagent_type="typescript-coder"
)
```

### Phase 19: Final Validation
```bash
Task(
  description="Final validation",
  prompt="Perform final validation based on project-plans/qwenauth/plan/19-final-validation.md. Verify all requirements met, run full test suite, check security (file permissions, no token logging), update documentation. Create migration guide. Ensure >90% test coverage and backward compatibility.",
  subagent_type="general-purpose"
)
```

## Execution Order

1. **Analysis Phase** (Parallel)
   - Phase 1: Domain Analysis
   - Phase 2: Pseudocode (after Phase 1)

2. **Core Infrastructure** (Sequential TDD)
   - Phase 3-5: Token Store
   - Phase 6-8: Device Flow
   - Phase 9-11: OAuth Manager

3. **Provider Integration** (Sequential TDD)
   - Phase 12-14: OpenAI Provider
   - Phase 15-17: Auth Command

4. **Validation** (Sequential)
   - Phase 18: Integration Tests
   - Phase 19: Final Validation

## Verification Gates

After each implementation phase:
1. All tests must pass
2. TypeScript must compile with no errors
3. Linting must pass
4. No console.log or TODO comments
5. >90% code coverage for new code

## Success Criteria

- [ ] All 6 requirements fully implemented
- [ ] 100+ behavioral tests passing
- [ ] OAuth works for both Gemini and Qwen
- [ ] Tokens stored securely with proper permissions
- [ ] Backward compatibility maintained
- [ ] Documentation updated
- [ ] Integration tests passing

## Notes for Subagents

- Follow TDD strictly: stub → test → implement
- Tests are behavioral contracts - do NOT modify them
- Reference pseudocode for algorithms
- Maintain backward compatibility at all times
- Use existing patterns from codebase
- No premature abstractions