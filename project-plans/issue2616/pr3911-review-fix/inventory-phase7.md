# Phase 7 inventory: inherited members of the assembly chain

Generated at `3984a8773` with the script at the end of this file (run once on 2026-10-24 against this worktree; output pasted below unchanged). Phase 6 deletes many `adopt*` fields and the test fixtures `adoption-fixture.ts` and `activation-acquisition-capture.ts`, so T7.0 regenerates this file before phase 7 starts and commits the refreshed copy; tasks T7.1-T7.8 read the refreshed copy, not this one.

## Chain

Every class that extends a chain class, found by the script (transitive `extends`, any nesting depth, production and test):

```
SessionProviderOwner            (session-provider-reads.ts, abstract)
  ├─ ProviderReadFixture        (__tests__/helpers/provider-read-fixture.ts, test)
  └─ ForegroundAgentAssembly    (foreground-agent-assembly.ts, abstract)
       ├─ PreferredAgentAssembly          (agentRuntimeAssembly.ts)
       └─ AdoptedSessionAssembly          (fromConfig-session.ts, abstract)
            ├─ AdoptedProviderFixture     (__tests__/helpers/adopted-provider-fixture.ts, test)
            └─ AdoptedAgentAssembly       (adopted-agent-assembly.ts, abstract)
                 └─ AgentActivationBootstrap (activationPreflightState.ts)
                      ├─ PreparedActivation   (profile-preflight.ts:688, production, nested in AgentProfilePreflight.#prepareActivation)
                      ├─ ActivationFixture    (__tests__/helpers/activation-acquisition-capture.ts, test; deleted in T6.D2)
                      └─ AdoptionFixture      (__tests__/helpers/adoption-fixture.ts, test; deleted in T6.D2)
```

## Cross-file edges that matter for phase 7 (read from the tables below)

1. Facade publication (both leaves write, foreground reads). `adopted-agent-assembly.ts` lines 645-706 and `agentRuntimeAssembly.ts` lines 707-744 each assign the same 20 members (`facadeSettingsOwner`, `facadeSessionOwner`, `facadeWorkspaceSkills`, `facadeMediaOwner`, `facadeTaskOwner`, `facadeShellOwner`, `ide`, `lsp`, `mcp`, `facadeAuthState`, `facadeProviderManager`, `facadeOAuth`, `facadeRuntimeKind`, `facadeSettingsService`, `facadeRuntimeId`, `facadeRuntimeState`, `facadeOwnership`, `facadeEditors`, `facadeDisplay`, plus `childDisplay`/`authentication`/`awaitMcpDiscovery`/`closeMcpAdmission`/`closeRuntime`/`sessionIdentityOwnership`) and then call `initializeFacade()`. Several of those members are declared in `SessionProviderOwner` (`facadeSettingsOwner`, `facadeSessionOwner`, `facadeAuthState`, `facadeProviderManager`, `facadeOAuth`, `facadeSettingsService`, `facadeRuntimeState`, `facadeOwnership`, `onOAuthPrompt`, `initialAuth`), the rest in `ForegroundAgentAssembly`.
2. Session acquisition writes into foreground fields. `fromConfig-session.ts` assigns `workspaceTrust` (265), `settingsOwner` (279), `mediaOwner` (289), `workspaceFilesystem` (305), `workspaceMemory`/`workspaceMemoryOwnership` (317-318), `workspaceDefinitions` (330), `ownedSessionClient` (371), all declared in `ForegroundAgentAssembly`. Each acquisition registers its close in the private `#activationRelease` (`AcquisitionRelease`, `fromConfig-session.ts:227`), rolled back on failure.
3. Preflight transfer. `activationPreflightState.ts` writes `ownsMemory` (83), `mediaOwner` (204), `foregroundMcp` (291) and reads `foregroundMcp` (11 uses), `ownedSessionClient` (9), `assertConstructionOpen` (7), `workspaceDefinitions` (6), `config` (6), `workspaceFilesystem` (4) and others declared in `ForegroundAgentAssembly`; it reads `adoptIntent`, `executeActivation`, `activationManager`, `adoptSettingsService` declared in `fromConfig-session.ts`; it implements the four template methods `validateAdoptionIdentity`, `acceptAdoption`, `closeAcquisition`, `publishAdoptedAgent` that `adopted-agent-assembly.ts` declares abstract and calls once each, and calls `assembleAdoption`. After `finishForeground` succeeds it flips ownership flags (`ownsSessionClient = false`, `ownsSettings = false`, `mediaOwner = undefined`) so its own disposal no longer releases what the agent now owns.
4. Provider reads. `foreground-agent-assembly.ts` calls `SessionProviderOwner` methods (`coordinator` 9, `isProviderReady` 5, `assertProfileIdle` 2, `activeRun` 2, `constructProfiles`, `constructProviderSwitch`, `buildAuthControl`, `initializeProviderReads`, `switchProvider`, `providerReads`, `profiles`, `providerState`) and implements the abstract `rebuild` that the base calls twice. `selectOwnerModel` is called once each from `foreground-agent-assembly.ts`, `adopted-agent-assembly.ts` and `agentRuntimeAssembly.ts`.
5. Late binding. `SessionProviderOwner` builds closures over `facade*` fields that the leaves assign later (`session-provider-reads.ts` around lines 212-245). The replacement keeps the behavior by construction order instead: `publishAgentFacade` builds `SessionProviderControl` and the controls after every owner exists, so they capture the owners directly and never read an assembly field later (`ports-B6-B3.md`, "The rule").
6. `config` is declared in `SessionProviderOwner` and used in every chain file (31 uses in `fromConfig-session.ts`).
7. Nested production subclass. `PreparedActivation` (`profile-preflight.ts:688-729`, inside the method that prepares the preflight's activation) constructs the bootstrap with `super(config)` and then writes 21 inherited fields from the preflight's private state: the 14 `activation*` fields declared in `fromConfig-session.ts` (`activationSettings`, `activationManager`, `activationOAuth`, `activationReadKind`, `activationProviderLifetime` (a close capability: `() => preflight.#release.close()`), `activationFilesystem`, `activationMemory`, `activationSettingsOwner`, `activationSettingsOwnership`, `activationTrust`, `activationTrustCleanup`, `activationFiles`, `activationBus`, `activationMemoryOwnership`), `foregroundPolicy`, `foregroundAuthority`, `foregroundRuntimeContext` (declared in `activationPreflightState.ts`), and `foregroundSettings`, `foregroundManager`, `foregroundOAuth`, `releaseForegroundProviders` (a close capability: `() => preflight.#releaseForegroundProviders()`, declared in `foreground-agent-assembly.ts`). Its `prepare()` calls the inherited `acquireActivation()` and `initializePreparedActivation()` and returns `activationSwitch`. After that, the preflight reads `activation.sessionClient`, `listProfiles`, `loadProfile`, `readHistory`, `prepareProfileActivation`, `createForeground`, `closeForegroundAdmission`, `disposeForeground` and `dispose` (`profile-preflight.ts:730-818`). Release transfer already works by handing over close capabilities, not by moving `AcquisitionRelease` entries: the preflight keeps its own `#release` and the bootstrap calls the capability once, as its final owner.
   Replacement and task mapping (contract in `ports-B6-B3.md`, "Preflight activation (T7.0b)"). T7.0b deletes the subclass before any of these fields moves: the preflight calls `AgentActivationBootstrap.forPreflight(config, activation, settings, providers, auth)` with four records (`PreflightActivationInput`: 13 fields, root `MessageBus`; `PreflightSettingsInput`: 2, `SettingsService`; `PreflightProviderInput`: 4 old fields, 2 values, `SettingsService`; `PreflightAuthInput`: 2 old fields, 1 value, `OAuthManager`), then `preparePreflight()`. The three capabilities (`readKind`, `providerLifetime`, `releaseForegroundProviders`) are built by a module-level helper over the host input, the release scope and the settings owner, not over `preflight`. The tasks that then remove the written fields each carry the matching `forPreflight` assignment in scope:
   - the 14 `activation*` fields (declared in `fromConfig-session.ts`): T7.6;
   - `foregroundPolicy`, `foregroundAuthority`, `foregroundRuntimeContext` (declared in the bootstrap): T7.0b makes them private;
   - `foregroundSettings`, `foregroundManager`, `foregroundOAuth`, `releaseForegroundProviders` (declared in `foreground-agent-assembly.ts`): T7.7a turns the writes into `acceptPreflightTransfer(transfer, providers, auth)`, T7.8 moves the declarations into `ForegroundAssembly`'s constructor input.
   After transfer the preflight also holds closures over the bootstrap (`#readProfiles`, `#runImage`, `#readHistory`, `#profiles`, plus `#activation`, `#provisionalActivation`); T7.7b clears them so the reachability test passes for the preflight path.
8. Test subclasses. `ProviderReadFixture` overrides `rebuild` to drive `SessionProviderOwner` directly; `AdoptedProviderFixture` redeclares eight `adopt*` members of `AdoptedSessionAssembly`. Both lose their base class in T7.1 and T7.6 respectively; their scenarios fall under the test conservation rule (phase 6) and are listed in the T7.0 refresh with an outcome each.

## Member tables (at `3984a8773`)

Columns: member, kind, declaration (with uses inside its own file), and uses in the other files that declare a chain class (`this.<member>` matches; paths are relative to `packages/agents/src/api/`).

### SessionProviderOwner (session-provider-reads.ts): 34 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `workspace` | field | session-provider-reads.ts:114 (own uses 1) | foreground-agent-assembly.ts:5, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `switchProvider` | field | session-provider-reads.ts:115 (own uses 2) | foreground-agent-assembly.ts:1 |
| `createProviderReads` | method | session-provider-reads.ts:116 (own uses 1) | none |
| `providerReads` | field | session-provider-reads.ts:137 (own uses 2) | foreground-agent-assembly.ts:1 |
| `readConfiguredModel` | method | session-provider-reads.ts:138 (own uses 3) | __tests__/helpers/provider-read-fixture.ts:1 |
| `readProviderSettings` | method | session-provider-reads.ts:139 (own uses 3) | __tests__/helpers/provider-read-fixture.ts:1 |
| `initializeProviderReads` | method | session-provider-reads.ts:143 (own uses 0) | foreground-agent-assembly.ts:1, __tests__/helpers/provider-read-fixture.ts:1 |
| `rebuild` | abstract | session-provider-reads.ts:150 (own uses 2) | foreground-agent-assembly.ts:2 |
| `facadeSettingsOwner` | field | session-provider-reads.ts:152 (own uses 21) | foreground-agent-assembly.ts:3, agentRuntimeAssembly.ts:1, __tests__/helpers/provider-read-fixture.ts:1, adopted-agent-assembly.ts:1 |
| `facadeSessionOwner` | field | session-provider-reads.ts:154 (own uses 8) | foreground-agent-assembly.ts:29, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeAuthState` | field | session-provider-reads.ts:156 (own uses 7) | foreground-agent-assembly.ts:2, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `config` | field | session-provider-reads.ts:158 (own uses 2) | foreground-agent-assembly.ts:11, agentRuntimeAssembly.ts:13, fromConfig-session.ts:31, adopted-agent-assembly.ts:12, __tests__/helpers/adopted-provider-fixture.ts:1, activationPreflightState.ts:6, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `facadeProviderManager` | field | session-provider-reads.ts:160 (own uses 22) | foreground-agent-assembly.ts:6, agentRuntimeAssembly.ts:1, __tests__/helpers/provider-read-fixture.ts:1, adopted-agent-assembly.ts:1 |
| `facadeOAuth` | field | session-provider-reads.ts:162 (own uses 7) | foreground-agent-assembly.ts:2, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeSettingsService` | field | session-provider-reads.ts:164 (own uses 7) | foreground-agent-assembly.ts:4, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeRuntimeState` | field | session-provider-reads.ts:166 (own uses 0) | foreground-agent-assembly.ts:2, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeOwnership` | field | session-provider-reads.ts:168 (own uses 1) | foreground-agent-assembly.ts:10, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `onOAuthPrompt` | field | session-provider-reads.ts:170 (own uses 2) | foreground-agent-assembly.ts:1, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `initialAuth` | field | session-provider-reads.ts:172 (own uses 0) | foreground-agent-assembly.ts:2, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `selectOwnerModel` | method | session-provider-reads.ts:174 (own uses 2) | foreground-agent-assembly.ts:1, agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `coordinator` | method | session-provider-reads.ts:176 (own uses 8) | foreground-agent-assembly.ts:9 |
| `activeRun` | method | session-provider-reads.ts:180 (own uses 4) | foreground-agent-assembly.ts:2 |
| `providerState` | field | session-provider-reads.ts:254 (own uses 21) | foreground-agent-assembly.ts:2 |
| `profiles` | field | session-provider-reads.ts:256 (own uses 1) | foreground-agent-assembly.ts:4 |
| `constructProfiles` | method | session-provider-reads.ts:258 (own uses 0) | foreground-agent-assembly.ts:1 |
| `constructProviderSwitch` | method | session-provider-reads.ts:311 (own uses 0) | foreground-agent-assembly.ts:1 |
| `prepareReplacement` | method | session-provider-reads.ts:330 (own uses 1) | none |
| `buildAuthControl` | method | session-provider-reads.ts:368 (own uses 0) | foreground-agent-assembly.ts:1 |
| `applyProviderSwitch` | method | session-provider-reads.ts:531 (own uses 1) | none |
| `restoreChatVisibility` | method | session-provider-reads.ts:559 (own uses 2) | none |
| `assertProfileIdle` | method | session-provider-reads.ts:569 (own uses 4) | foreground-agent-assembly.ts:2 |
| `isProviderReady` | method | session-provider-reads.ts:574 (own uses 1) | foreground-agent-assembly.ts:5 |
| `computeWinner` | method | session-provider-reads.ts:582 (own uses 2) | none |
| `readProviderName` | method | session-provider-reads.ts:645 (own uses 1) | __tests__/helpers/provider-read-fixture.ts:1 |

### ForegroundAgentAssembly (foreground-agent-assembly.ts): 61 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `closeConstructionAdmission` | method | foreground-agent-assembly.ts:125 (own uses 0) | activationPreflightState.ts:1 |
| `mediaOwner` | field | foreground-agent-assembly.ts:128 (own uses 1) | fromConfig-session.ts:2, adopted-agent-assembly.ts:2, activationPreflightState.ts:2, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `ownsSessionClient` | field | foreground-agent-assembly.ts:129 (own uses 0) | adopted-agent-assembly.ts:1, activationPreflightState.ts:2 |
| `ownsSettings` | field | foreground-agent-assembly.ts:130 (own uses 0) | adopted-agent-assembly.ts:1, activationPreflightState.ts:2 |
| `ownsMemory` | field | foreground-agent-assembly.ts:131 (own uses 0) | fromConfig-session.ts:2, adopted-agent-assembly.ts:1, activationPreflightState.ts:3 |
| `providerFileLifecycle` | field | foreground-agent-assembly.ts:132 (own uses 0) | fromConfig-session.ts:3, activationPreflightState.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `ownedSessionClient` | field | foreground-agent-assembly.ts:133 (own uses 7) | fromConfig-session.ts:3, adopted-agent-assembly.ts:2, activationPreflightState.ts:9, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `workspaceFilesystem` | field | foreground-agent-assembly.ts:134 (own uses 0) | fromConfig-session.ts:2, activationPreflightState.ts:4, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `workspaceMemory` | field | foreground-agent-assembly.ts:135 (own uses 0) | fromConfig-session.ts:2, activationPreflightState.ts:2, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `ownsFilesystem` | field | foreground-agent-assembly.ts:136 (own uses 0) | fromConfig-session.ts:2, adopted-agent-assembly.ts:1, activationPreflightState.ts:3, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `settingsOwner` | field | foreground-agent-assembly.ts:137 (own uses 3) | agentRuntimeAssembly.ts:5, fromConfig-session.ts:5, adopted-agent-assembly.ts:1, activationPreflightState.ts:3, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `settingsOwnerOwnership` | field | foreground-agent-assembly.ts:138 (own uses 0) | fromConfig-session.ts:1, activationPreflightState.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `workspaceDefinitions` | field | foreground-agent-assembly.ts:139 (own uses 0) | fromConfig-session.ts:3, activationPreflightState.ts:6, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `ownsDefinitions` | field | foreground-agent-assembly.ts:140 (own uses 0) | fromConfig-session.ts:2, adopted-agent-assembly.ts:1, activationPreflightState.ts:3, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `workspaceTrust` | field | foreground-agent-assembly.ts:141 (own uses 0) | fromConfig-session.ts:3, activationPreflightState.ts:2, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `trustCleanup` | method | foreground-agent-assembly.ts:142 (own uses 0) | fromConfig-session.ts:3, activationPreflightState.ts:2, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `oauthManager` | field | foreground-agent-assembly.ts:143 (own uses 0) | fromConfig-session.ts:1, adopted-agent-assembly.ts:1, activationPreflightState.ts:2, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `messageBus` | field | foreground-agent-assembly.ts:144 (own uses 0) | fromConfig-session.ts:1, adopted-agent-assembly.ts:1, activationPreflightState.ts:2, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `workspaceMemoryOwnership` | field | foreground-agent-assembly.ts:145 (own uses 0) | fromConfig-session.ts:1, activationPreflightState.ts:2, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `foregroundMcp` | field | foreground-agent-assembly.ts:146 (own uses 13) | activationPreflightState.ts:11 |
| `foregroundSettings` | field | foreground-agent-assembly.ts:147 (own uses 5) | activationPreflightState.ts:3, profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `foregroundManager` | field | foreground-agent-assembly.ts:148 (own uses 4) | activationPreflightState.ts:3, profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `foregroundOAuth` | field | foreground-agent-assembly.ts:149 (own uses 2) | activationPreflightState.ts:1, profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `releaseForegroundProviders` | method | foreground-agent-assembly.ts:150 (own uses 2) | activationPreflightState.ts:1, profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `assertConstructionOpen` | method | foreground-agent-assembly.ts:151 (own uses 1) | adopted-agent-assembly.ts:1, activationPreflightState.ts:7 |
| `finishForeground` | method | foreground-agent-assembly.ts:154 (own uses 0) | activationPreflightState.ts:1 |
| `facadeWorkspaceSkills` | field | foreground-agent-assembly.ts:311 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeMediaOwner` | field | foreground-agent-assembly.ts:312 (own uses 3) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeTaskOwner` | field | foreground-agent-assembly.ts:313 (own uses 7) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeShellOwner` | field | foreground-agent-assembly.ts:314 (own uses 6) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `ide` | field | foreground-agent-assembly.ts:315 (own uses 5) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `lsp` | field | foreground-agent-assembly.ts:316 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `awaitMcpDiscovery` | field | foreground-agent-assembly.ts:317 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `closeMcpAdmission` | method | foreground-agent-assembly.ts:318 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `mcp` | field | foreground-agent-assembly.ts:319 (own uses 3) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeRuntimeKind` | method | foreground-agent-assembly.ts:320 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeRuntimeId` | field | foreground-agent-assembly.ts:321 (own uses 3) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `closeRuntime` | method | foreground-agent-assembly.ts:322 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `sessionIdentityOwnership` | field | foreground-agent-assembly.ts:323 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeEditors` | field | foreground-agent-assembly.ts:325 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `facadeDisplay` | field | foreground-agent-assembly.ts:328 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `childDisplay` | field | foreground-agent-assembly.ts:329 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `authentication` | field | foreground-agent-assembly.ts:330 (own uses 2) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |
| `metrics` | field | foreground-agent-assembly.ts:332 (own uses 4) | none |
| `facadeSessionOperations` | field | foreground-agent-assembly.ts:338 (own uses 2) | none |
| `captureProfile` | field | foreground-agent-assembly.ts:340 (own uses 2) | none |
| `saveProfileSnapshot` | field | foreground-agent-assembly.ts:341 (own uses 2) | none |
| `deleteProfileByName` | field | foreground-agent-assembly.ts:342 (own uses 2) | none |
| `getActiveProfileName` | field | foreground-agent-assembly.ts:343 (own uses 2) | none |
| `setDefaultProfileName` | field | foreground-agent-assembly.ts:344 (own uses 2) | none |
| `getRuntimeDiagnosticsSnapshot` | field | foreground-agent-assembly.ts:345 (own uses 2) | none |
| `tools` | field | foreground-agent-assembly.ts:346 (own uses 8) | none |
| `auth` | field | foreground-agent-assembly.ts:347 (own uses 2) | none |
| `session` | field | foreground-agent-assembly.ts:348 (own uses 11) | none |
| `hooks` | field | foreground-agent-assembly.ts:349 (own uses 5) | none |
| `policy` | field | foreground-agent-assembly.ts:350 (own uses 2) | none |
| `tasks` | field | foreground-agent-assembly.ts:351 (own uses 2) | none |
| `memory` | field | foreground-agent-assembly.ts:352 (own uses 2) | none |
| `skills` | field | foreground-agent-assembly.ts:353 (own uses 4) | none |
| `rebuild` | method | foreground-agent-assembly.ts:619 (own uses 2) | session-provider-reads.ts:2 |
| `initializeFacade` | method | foreground-agent-assembly.ts:751 (own uses 1) | agentRuntimeAssembly.ts:1, adopted-agent-assembly.ts:1 |

### PreferredAgentAssembly (agentRuntimeAssembly.ts): 0 protected/abstract members


### ProviderReadFixture (__tests__/helpers/provider-read-fixture.ts): 1 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `rebuild` | method | __tests__/helpers/provider-read-fixture.ts:39 (own uses 0) | session-provider-reads.ts:2, foreground-agent-assembly.ts:2 |

### AdoptedSessionAssembly (fromConfig-session.ts): 51 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `adoptSettingsService` | abstract | fromConfig-session.ts:69 (own uses 7) | adopted-agent-assembly.ts:7, __tests__/helpers/adopted-provider-fixture.ts:1, activationPreflightState.ts:2, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptIntent` | abstract | fromConfig-session.ts:70 (own uses 3) | adopted-agent-assembly.ts:19, activationPreflightState.ts:3, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptAgentClient` | abstract | fromConfig-session.ts:71 (own uses 2) | adopted-agent-assembly.ts:3, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptRuntimeFactoryBindings` | abstract | fromConfig-session.ts:72 (own uses 1) | adopted-agent-assembly.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptPolicyOwner` | abstract | fromConfig-session.ts:75 (own uses 1) | adopted-agent-assembly.ts:3, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptMcpRuntime` | abstract | fromConfig-session.ts:76 (own uses 1) | adopted-agent-assembly.ts:9, activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptClient` | field | fromConfig-session.ts:78 (own uses 5) | adopted-agent-assembly.ts:9 |
| `adoptMcp` | field | fromConfig-session.ts:79 (own uses 2) | adopted-agent-assembly.ts:17 |
| `adoptMedia` | field | fromConfig-session.ts:80 (own uses 1) | adopted-agent-assembly.ts:9 |
| `adoptSelectedSettings` | field | fromConfig-session.ts:81 (own uses 7) | adopted-agent-assembly.ts:4, __tests__/helpers/adopted-provider-fixture.ts:2 |
| `adoptFiles` | field | fromConfig-session.ts:82 (own uses 2) | adopted-agent-assembly.ts:3, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `adoptManager` | field | fromConfig-session.ts:83 (own uses 14) | adopted-agent-assembly.ts:4, __tests__/helpers/adopted-provider-fixture.ts:3 |
| `adoptOauth` | field | fromConfig-session.ts:84 (own uses 7) | adopted-agent-assembly.ts:4, __tests__/helpers/adopted-provider-fixture.ts:2 |
| `adoptTokenizer` | field | fromConfig-session.ts:85 (own uses 2) | adopted-agent-assembly.ts:2, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `adoptContent` | field | fromConfig-session.ts:86 (own uses 1) | adopted-agent-assembly.ts:1 |
| `adoptSelectedBus` | field | fromConfig-session.ts:87 (own uses 1) | adopted-agent-assembly.ts:1 |
| `adoptImages` | field | fromConfig-session.ts:88 (own uses 1) | adopted-agent-assembly.ts:1 |
| `adoptProviderManager` | abstract | fromConfig-session.ts:90 (own uses 3) | adopted-agent-assembly.ts:2, __tests__/helpers/adopted-provider-fixture.ts:2, activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptRuntimeId` | field | fromConfig-session.ts:91 (own uses 2) | adopted-agent-assembly.ts:5, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `adoptAuthority` | field | fromConfig-session.ts:92 (own uses 2) | adopted-agent-assembly.ts:2, __tests__/helpers/adopted-provider-fixture.ts:2 |
| `adoptRelease` | abstract | fromConfig-session.ts:93 (own uses 4) | adopted-agent-assembly.ts:6, __tests__/helpers/adopted-provider-fixture.ts:2 |
| `adoptOAuthProfiles` | field | fromConfig-session.ts:94 (own uses 1) | adopted-agent-assembly.ts:1, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `adoptSuppliedOAuth` | field | fromConfig-session.ts:97 (own uses 3) | adopted-agent-assembly.ts:1, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `adoptTokenStore` | field | fromConfig-session.ts:98 (own uses 2) | __tests__/helpers/adopted-provider-fixture.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptOAuthBus` | field | fromConfig-session.ts:99 (own uses 1) | adopted-agent-assembly.ts:1, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `acquireAdoptedProviderManager` | method | fromConfig-session.ts:101 (own uses 0) | adopted-agent-assembly.ts:1, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `acquireAdoptedOAuth` | method | fromConfig-session.ts:124 (own uses 0) | adopted-agent-assembly.ts:1, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `activateAdoptedProviders` | method | fromConfig-session.ts:160 (own uses 0) | adopted-agent-assembly.ts:1, __tests__/helpers/adopted-provider-fixture.ts:1 |
| `activationSettings` | field | fromConfig-session.ts:205 (own uses 6) | profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `activationManager` | field | fromConfig-session.ts:206 (own uses 6) | activationPreflightState.ts:1, profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `activationOAuth` | field | fromConfig-session.ts:207 (own uses 5) | profile-preflight.ts:1 |
| `activationReadKind` | method | fromConfig-session.ts:208 (own uses 1) | profile-preflight.ts:1 |
| `activationProviderLifetime` | method | fromConfig-session.ts:209 (own uses 1) | profile-preflight.ts:1 |
| `activationSuppliedClient` | field | fromConfig-session.ts:210 (own uses 5) | none |
| `activationMcp` | field | fromConfig-session.ts:211 (own uses 6) | none |
| `activationFilesystem` | field | fromConfig-session.ts:212 (own uses 1) | profile-preflight.ts:1 |
| `activationMemory` | field | fromConfig-session.ts:213 (own uses 2) | profile-preflight.ts:1 |
| `activationSettingsOwner` | field | fromConfig-session.ts:214 (own uses 1) | profile-preflight.ts:1 |
| `activationSettingsOwnership` | field | fromConfig-session.ts:215 (own uses 2) | profile-preflight.ts:1 |
| `activationTrust` | field | fromConfig-session.ts:217 (own uses 2) | profile-preflight.ts:1 |
| `activationTrustCleanup` | method | fromConfig-session.ts:218 (own uses 1) | profile-preflight.ts:1 |
| `activationTokenizer` | field | fromConfig-session.ts:219 (own uses 1) | none |
| `activationContent` | field | fromConfig-session.ts:220 (own uses 1) | none |
| `activationFiles` | field | fromConfig-session.ts:223 (own uses 1) | profile-preflight.ts:1 |
| `activationBus` | field | fromConfig-session.ts:224 (own uses 2) | profile-preflight.ts:1 |
| `activationMemoryOwnership` | field | fromConfig-session.ts:225 (own uses 1) | profile-preflight.ts:1 |
| `activationSwitch` | field | fromConfig-session.ts:226 (own uses 2) | profile-preflight.ts:1 |
| `acquireActivation` | method | fromConfig-session.ts:229 (own uses 0) | profile-preflight.ts:1 |
| `executeActivation` | method | fromConfig-session.ts:421 (own uses 0) | activationPreflightState.ts:1 |
| `acquireAdoptedSession` | method | fromConfig-session.ts:434 (own uses 0) | adopted-agent-assembly.ts:1 |
| `activateAdoptedSession` | method | fromConfig-session.ts:465 (own uses 0) | adopted-agent-assembly.ts:1 |

### AdoptedAgentAssembly (adopted-agent-assembly.ts): 41 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `validateAdoptionIdentity` | abstract | adopted-agent-assembly.ts:129 (own uses 1) | none |
| `acceptAdoption` | abstract | adopted-agent-assembly.ts:130 (own uses 1) | none |
| `closeAcquisition` | abstract | adopted-agent-assembly.ts:131 (own uses 1) | none |
| `publishAdoptedAgent` | abstract | adopted-agent-assembly.ts:132 (own uses 1) | none |
| `adoptSettingsService` | field | adopted-agent-assembly.ts:133 (own uses 7) | fromConfig-session.ts:7, __tests__/helpers/adopted-provider-fixture.ts:1, activationPreflightState.ts:2, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptIntent` | field | adopted-agent-assembly.ts:134 (own uses 19) | fromConfig-session.ts:3, activationPreflightState.ts:3, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptSettingsOwner` | field | adopted-agent-assembly.ts:135 (own uses 4) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptProviderManager` | field | adopted-agent-assembly.ts:136 (own uses 2) | fromConfig-session.ts:3, __tests__/helpers/adopted-provider-fixture.ts:2, activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptOauthManager` | field | adopted-agent-assembly.ts:137 (own uses 2) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptMessageBus` | field | adopted-agent-assembly.ts:138 (own uses 1) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptMcpRuntime` | field | adopted-agent-assembly.ts:139 (own uses 9) | fromConfig-session.ts:1, activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptActivationPreflight` | field | adopted-agent-assembly.ts:140 (own uses 10) | activationPreflightState.ts:2, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptAgentClient` | field | adopted-agent-assembly.ts:141 (own uses 3) | fromConfig-session.ts:2, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptProviderFileLifecycle` | field | adopted-agent-assembly.ts:142 (own uses 1) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptTokenizerFactory` | field | adopted-agent-assembly.ts:143 (own uses 1) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptContentGeneratorFactory` | field | adopted-agent-assembly.ts:144 (own uses 1) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptRuntimeFactoryBindings` | field | adopted-agent-assembly.ts:147 (own uses 1) | fromConfig-session.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptCredentialAuthority` | field | adopted-agent-assembly.ts:150 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptPolicyOwner` | field | adopted-agent-assembly.ts:151 (own uses 3) | fromConfig-session.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptTrustPort` | field | adopted-agent-assembly.ts:152 (own uses 1) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptIdePort` | field | adopted-agent-assembly.ts:153 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptHookOwner` | field | adopted-agent-assembly.ts:154 (own uses 2) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptDefinitionOwner` | field | adopted-agent-assembly.ts:155 (own uses 11) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptFilesystemOwner` | field | adopted-agent-assembly.ts:156 (own uses 2) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptLspOwner` | field | adopted-agent-assembly.ts:157 (own uses 3) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptMemoryOwner` | field | adopted-agent-assembly.ts:158 (own uses 7) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptAsyncTaskManager` | field | adopted-agent-assembly.ts:159 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptMcpHost` | field | adopted-agent-assembly.ts:160 (own uses 3) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptMcpTokenStorage` | field | adopted-agent-assembly.ts:161 (own uses 1) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptGithubBrokerClient` | field | adopted-agent-assembly.ts:162 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptDisposeGitHubBroker` | method | adopted-agent-assembly.ts:163 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptImageOperation` | field | adopted-agent-assembly.ts:164 (own uses 1) | activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptOnApproval` | field | adopted-agent-assembly.ts:167 (own uses 2) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptOnOAuthPrompt` | field | adopted-agent-assembly.ts:168 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptEditorCallbacks` | field | adopted-agent-assembly.ts:169 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptPrepareSessionTools` | field | adopted-agent-assembly.ts:170 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptToolSchedulerFactory` | field | adopted-agent-assembly.ts:171 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptSkillPolicy` | field | adopted-agent-assembly.ts:172 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptRegisterSkillTools` | field | adopted-agent-assembly.ts:175 (own uses 1) | __tests__/helpers/adoption-fixture.ts:1 |
| `assembleAdoption` | method | adopted-agent-assembly.ts:178 (own uses 0) | activationPreflightState.ts:1 |
| `adoptRelease` | method | adopted-agent-assembly.ts:357 (own uses 6) | fromConfig-session.ts:4, __tests__/helpers/adopted-provider-fixture.ts:2 |

### AdoptedProviderFixture (__tests__/helpers/adopted-provider-fixture.ts): 8 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `adoptSettingsService` | field | __tests__/helpers/adopted-provider-fixture.ts:30 (own uses 1) | fromConfig-session.ts:7, adopted-agent-assembly.ts:7, activationPreflightState.ts:2, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptIntent` | field | __tests__/helpers/adopted-provider-fixture.ts:31 (own uses 0) | fromConfig-session.ts:3, adopted-agent-assembly.ts:19, activationPreflightState.ts:3, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptAgentClient` | field | __tests__/helpers/adopted-provider-fixture.ts:32 (own uses 0) | fromConfig-session.ts:2, adopted-agent-assembly.ts:3, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptRuntimeFactoryBindings` | field | __tests__/helpers/adopted-provider-fixture.ts:33 (own uses 0) | fromConfig-session.ts:1, adopted-agent-assembly.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptPolicyOwner` | field | __tests__/helpers/adopted-provider-fixture.ts:36 (own uses 0) | fromConfig-session.ts:1, adopted-agent-assembly.ts:3, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptMcpRuntime` | field | __tests__/helpers/adopted-provider-fixture.ts:37 (own uses 0) | fromConfig-session.ts:1, adopted-agent-assembly.ts:9, activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptProviderManager` | field | __tests__/helpers/adopted-provider-fixture.ts:38 (own uses 2) | fromConfig-session.ts:3, adopted-agent-assembly.ts:2, activationPreflightState.ts:1, __tests__/helpers/adoption-fixture.ts:1 |
| `adoptRelease` | method | __tests__/helpers/adopted-provider-fixture.ts:39 (own uses 2) | fromConfig-session.ts:4, adopted-agent-assembly.ts:6 |

### AgentActivationBootstrap (activationPreflightState.ts): 10 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `initializePreparedActivation` | method | activationPreflightState.ts:82 (own uses 0) | profile-preflight.ts:1 |
| `foregroundPolicy` | field | activationPreflightState.ts:110 (own uses 1) | profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `foregroundAuthority` | field | activationPreflightState.ts:111 (own uses 1) | profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `foregroundRuntimeContext` | field | activationPreflightState.ts:113 (own uses 1) | profile-preflight.ts:1, __tests__/helpers/activation-acquisition-capture.ts:1 |
| `beginAdoption` | method | activationPreflightState.ts:537 (own uses 0) | __tests__/helpers/adoption-fixture.ts:1 |
| `adoptionConfig` | field | activationPreflightState.ts:542 (own uses 2) | __tests__/helpers/adoption-fixture.ts:1 |
| `validateAdoptionIdentity` | method | activationPreflightState.ts:543 (own uses 0) | adopted-agent-assembly.ts:1 |
| `acceptAdoption` | method | activationPreflightState.ts:622 (own uses 0) | adopted-agent-assembly.ts:1 |
| `closeAcquisition` | method | activationPreflightState.ts:639 (own uses 0) | adopted-agent-assembly.ts:1 |
| `publishAdoptedAgent` | method | activationPreflightState.ts:642 (own uses 0) | adopted-agent-assembly.ts:1 |

### PreparedActivation (profile-preflight.ts): 0 protected/abstract members


### ActivationFixture (__tests__/helpers/activation-acquisition-capture.ts): 1 protected/abstract members

| member | kind | declared | readers/writers in other chain files (file:count) |
| --- | --- | --- | --- |
| `executeActivation` | method | __tests__/helpers/activation-acquisition-capture.ts:67 (own uses 0) | activationPreflightState.ts:1 |

### AdoptionFixture (__tests__/helpers/adoption-fixture.ts): 0 protected/abstract members


## Files that name a chain class (imports, construction, types)

- packages/agents/src/api/__tests__/activationPreflightState-owner-16.behavior.test.ts (test)
- packages/agents/src/api/__tests__/fromConfig-tokenizer-readiness.behavior.test.ts (test)
- packages/agents/src/api/__tests__/helpers/activation-acquisition-capture.ts (test)
- packages/agents/src/api/__tests__/helpers/adopted-provider-fixture.ts (test)
- packages/agents/src/api/__tests__/helpers/adoption-fixture.ts (test)
- packages/agents/src/api/__tests__/helpers/provider-read-fixture.ts (test)
- packages/agents/src/api/__tests__/post-config-preflight.test.ts (test)
- packages/agents/src/api/__tests__/preflightAgentActivation.behavior.test.ts (test)
- packages/agents/src/api/__tests__/provider-switch-assembly.test.ts (test)
- packages/agents/src/api/__tests__/providerActivation-owner-8.behavior.test.ts (test)
- packages/agents/src/api/__tests__/raw-authority-absence.contract.test.ts (test)
- packages/agents/src/api/activationPreflightState.ts (production)
- packages/agents/src/api/adopted-agent-assembly.ts (production)
- packages/agents/src/api/agentRuntimeAssembly.ts (production)
- packages/agents/src/api/createAgent.ts (production)
- packages/agents/src/api/foreground-agent-assembly.ts (production)
- packages/agents/src/api/fromConfig-session.ts (production)
- packages/agents/src/api/fromConfig.ts (production)
- packages/agents/src/api/profile-preflight.ts (production)
- packages/agents/src/api/session-provider-accessors.spec.ts (test)
- packages/agents/src/api/session-provider-reads.test.ts (test)
- packages/agents/src/api/session-provider-reads.ts (production)
- packages/agents/src/api/session-provider-status.owner.test.ts (test)
- packages/cli/src/__tests__/startup-activation-fixture.ts (test)
- packages/cli/src/__tests__/uiSessionOwner.ts (test)
- packages/cli/src/config/__tests__/cliRuntimeImportCut.test.ts (test)
- packages/cli/src/runtime/__tests__/runtime-model-ownership.test.ts (test)
- packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts (test)
- packages/cli/src/ui/contexts/runtime-owner-missing.test.ts (test)
- packages/providers/src/auth/auth-owner-identity.test.ts (test)
- packages/providers/src/composition/oauth-browser-owner.test.ts (test)
- packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts (test)
- packages/providers/src/runtime/assembleCliProviderRuntime.identity.test.ts (test)
- packages/providers/src/runtime/assembleCliProviderRuntime.test.ts (test)
- packages/providers/src/runtime/config-manager-lifecycle.behavior.test.ts (test)
- packages/providers/src/runtime/explicitRuntimeId.behavior.test.ts (test)
- packages/providers/src/runtime/isolated-runtime-owner-scope.test.ts (test)
- packages/providers/src/runtime/isolatedRuntimeDefaultPointer.behavior.test.ts (test)
- packages/providers/src/runtime/runtimeContextFactory.oauthRetirement.test.ts (test)
- packages/providers/src/runtime/runtimeContextFactory.setRuntimeContext.test.ts (test)

## Regeneration script (T7.0)

Copy into `W/tmp/pr3911/T7.0/inv7.ts` (never commit it) and run it with the worktree root as its only argument:

```
exec < /dev/null; cd /Volumes/XS1000/acoliver/projects/llxprt/branch-2/llxprt-code/tmp/w2616k && bun tmp/pr3911/T7.0/inv7.ts /Volumes/XS1000/acoliver/projects/llxprt/branch-2/llxprt-code/tmp/w2616k > tmp/pr3911/T7.0/inv7.out
```

The root is an argument, not derived from the script location, so the copy works wherever it is saved. The script walks `packages/*/src` (skipping `node_modules`, `dist` and `.d.ts`), discovers every class that transitively extends `SessionProviderOwner` at any nesting depth, and counts `this.<member>` uses in every file that declares one of those classes; it then lists every file that names a chain class. Paste its output over the "Chain" class list and "Member tables" sections and update the numbered edge notes when a line moves or a member disappears. It was run once against this worktree when this file was written (exit 0).

```ts
// Throwaway inventory script for the phase 7 plan (not committed; tmp/ is gitignored).
// Usage: bun inv7.ts <worktree root>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const worktree = process.argv[2];
if (worktree === undefined) throw new Error('usage: bun inv7.ts <worktree root>');
const packages = join(worktree, 'packages');
const roots = ['SessionProviderOwner'];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const files = readdirSync(packages)
  .map((p) => join(packages, p, 'src'))
  .filter((p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap((p) => walk(p, []));
const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')] as const));
const rel = (f: string) => relative(worktree, f);
const isTest = (f: string) => /(\.test\.|\.spec\.|__tests__|test-utils|fixture)/.test(f);

// Discover every class that extends a chain class, at any nesting depth, transitively.
type ClassInfo = { name: string; parent: string; file: string; line: number; indent: number };
const classes = new Map<string, ClassInfo>();
const classRe = /^(\s*)(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?\s+extends\s+(\w+)/;
let grew = true;
const known = new Set(roots);
while (grew) {
  grew = false;
  for (const [file, text] of texts) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = classRe.exec(lines[i]) ?? (/^\s*extends\s+(\w+)/.test(lines[i]) && /class\s+(\w+)/.test(lines[i - 1] ?? '')
        ? [lines[i - 1], /^(\s*)/.exec(lines[i - 1])![1], /class\s+(\w+)/.exec(lines[i - 1])![1], /extends\s+(\w+)/.exec(lines[i])![1]]
        : null);
      if (!m) continue;
      const [, indent, name, parent] = m;
      if (known.has(parent) && !classes.has(name)) {
        classes.set(name, { name, parent, file, line: i + 1, indent: indent.length });
        known.add(name);
        grew = true;
      }
    }
  }
}
const rootFile = files.find((f) => /^export abstract class SessionProviderOwner\b/m.test(texts.get(f)!))!;
const declaring = [
  { name: 'SessionProviderOwner', parent: '(none)', file: rootFile, line: texts.get(rootFile)!.split('\n').findIndex((l) => /class SessionProviderOwner\b/.test(l)) + 1, indent: 0 },
  ...classes.values(),
];

const out: string[] = ['## Classes in the chain (discovered by `extends`, transitive, any nesting)', '', '| class | extends | file:line | kind |', '| --- | --- | --- | --- |'];
for (const c of declaring)
  out.push(`| \`${c.name}\` | \`${c.parent}\` | ${rel(c.file)}:${c.line} | ${isTest(c.file) ? 'test' : 'production'}${c.indent > 0 ? ', nested' : ''} |`);

const userFiles = [...new Set(declaring.map((c) => c.file))];
const decl =
  /^\s+(?:protected|public)?\s*(?:abstract\s+)?(?:readonly\s+)?(?:override\s+)?(?:get\s+|set\s+|async\s+)?([a-zA-Z_][\w]*)\s*[!?]?\s*[:(<=]/;
const skip = new Set(['constructor', 'if', 'for', 'return', 'const', 'let', 'await', 'try', 'catch', 'throw', 'while', 'switch', 'case', 'else']);

for (const c of declaring) {
  const lines = texts.get(c.file)!.split('\n');
  const start = c.line - 1;
  const memberIndent = ' '.repeat(c.indent + 2);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (lines[i].startsWith(' '.repeat(c.indent) + '}') && !lines[i].startsWith(memberIndent)) {
      end = i;
      break;
    }
  const members = new Map<string, { line: number; kind: string }>();
  for (let i = start + 1; i < end; i++) {
    const l = lines[i];
    if (!l.startsWith(memberIndent) || l.startsWith(memberIndent + ' ')) continue;
    if (!/^\s+(protected|abstract|public)\b/.test(l)) continue;
    const m = decl.exec(l);
    if (!m || skip.has(m[1])) continue;
    const kind = /abstract/.test(l) ? 'abstract' : /\(/.test(l.split(m[1])[1] ?? '') ? 'method' : 'field';
    if (!members.has(m[1])) members.set(m[1], { line: i + 1, kind });
  }
  out.push(`\n### ${c.name} (${rel(c.file)}): ${members.size} protected/abstract members\n`);
  if (members.size === 0) continue;
  out.push('| member | kind | declared | readers/writers in other chain files (file:count) |');
  out.push('| --- | --- | --- | --- |');
  for (const [name, { line, kind }] of members) {
    const re = new RegExp(`\\bthis\\.${name}\\b`, 'g');
    const users: string[] = [];
    for (const f of userFiles) {
      if (f === c.file) continue;
      const n = (texts.get(f)!.match(re) ?? []).length;
      if (n > 0) users.push(`${rel(f).replace('packages/agents/src/api/', '')}:${n}`);
    }
    const own = (texts.get(c.file)!.match(re) ?? []).length;
    out.push(`| \`${name}\` | ${kind} | ${rel(c.file).replace('packages/agents/src/api/', '')}:${line} (own uses ${own}) | ${users.join(', ') || 'none'} |`);
  }
}

const names = declaring.map((c) => c.name);
const nameRe = new RegExp(`\\b(${names.join('|')})\\b`);
out.push('\n## Files that name a chain class (imports, construction, types)\n');
for (const f of files.filter((f) => nameRe.test(texts.get(f)!)).sort())
  out.push(`- ${rel(f)} (${isTest(f) ? 'test' : 'production'})`);
console.log(out.join('\n'));
```
