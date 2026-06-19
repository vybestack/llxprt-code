## Addendum — provider/profile switches must preserve conversation context

One product-critical guarantee needs to be explicit in the public Agent API design:

**Switching provider/model/profile continues the same conversation. It does not reset chat.**

This is the user-visible benefit of provider switching and load-balancer profiles: if Anthropic is overloaded, a client can apply a GPT-backed profile and continue in the same context.

The mechanism already exists in `Config.initializeContentGeneratorConfig()`:

    extractExistingState()
      -> transferHistoryToNewClient()
      -> initializeContentGeneratorConfig()

The old `AgentClient` is replaced during auth/provider/model changes, but the existing conversation history and `HistoryService` are transferred to the new client. The new public `Agent` facade must preserve that behavior and make it a first-class contract:

- `agent.setProvider(...)`, `agent.setModel(...)`, and `agent.profiles.apply(...)` must not reset chat.
- Manual switch and load-balancer failover must use the same continuity mechanism.
- The facade must not cache the old `AgentClient`; it must resolve the current client from `Config` after each switch/rebind.
- Tests must assert that a follow-up turn after switching still receives prior context.
- Provider-incompatible history artifacts can be normalized. Example: switching into the Vertex path strips thought signatures via the existing `stripThoughtSignatures` behavior, so the guarantee is semantic continuity, not byte-identical history.

The design overview now includes this in section 4.3 and adds harness rows T4d/T4e/T4f for context preservation, load-balancer failover continuity, and switch-time normalization.
