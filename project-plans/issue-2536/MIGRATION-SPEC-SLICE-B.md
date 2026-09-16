# Slice B migration spec — exact writer/reader map (recon verified 2026-09-08)

Store API (exists, commit 8ca86b6f9):
- `stores/createStore.ts`: `createStore<S>(initial)` → `{getState, setState, subscribe}`
- `stores/useStoreSelector.ts`: `useStoreSelector(store, selector)`
- `stores/dialog/dialogStore.ts`: `createDialogStore()` → `{store, commands}`; commands:
  `openDialog(request)`, `closeDialog(kind)`, `updateDialogPayload(kind, patch)`,
  `setConfirmationRequest(req|null)`, `addConfirmUpdateExtensionRequest(req)`,
  `resolveConfirmUpdateExtensionRequest(req)`;
  `selectActiveDialog(state)`; `DIALOG_PRIORITY` (verify vs DialogManager chain).
- `stores/dialog/DialogContext.tsx`: `DialogProvider` + `useDialogStore()`.

## Dialog state sources today

| Dialog | Boolean today | Data today | Open fn | Close/exit fn |
|---|---|---|---|---|
| workspaceMigration | useWorkspaceMigration `showWorkspaceMigrationDialog` | `workspaceLlxprtExtensions` | (startup-detected) | onWorkspaceMigrationDialogOpen/Close |
| idePrompt | `shouldShowIdePrompt` + `currentIDE` (bootstrap) | currentIDE | (ide detected) | handleIdePromptComplete |
| folderTrust | useFolderTrust `isFolderTrustDialogOpen` | — | (trust check) | handleFolderTrustSelect |
| welcome | useWelcomeOnboarding `showWelcome` | welcomeState, availableProviders/Models (stay in hook) | — | welcomeActions.dismiss |
| confirmation | `confirmationRequest` (useAppInput) | {prompt,onConfirm} | setConfirmationRequest | onConfirm |
| extensionUpdateConfirm | `confirmUpdateLlxprtExtensionRequests` (useExtensionUpdates) | list | addConfirmUpdateExtensionRequest | onConfirm |
| theme | appReducer openDialogs.theme (useThemeCommand:132) | themeError (errors.theme) | openThemeDialog | handleThemeSelect/exit |
| settings | useSettingsCommand internal | — | openSettingsDialog | closeSettingsDialog |
| auth | appReducer openDialogs.auth (useAuthCommand:18) | authError | openAuthDialog | handleAuthSelect |
| oauthCode | appReducer openDialogs.oauthCode (useAppDialogs:211) | oauthGlobalState | dispatch OPEN/CLOSE in useInputHandling/useAppInput | handleOAuthCodeDialogClose |
| editor | appReducer openDialogs.editor (useEditorSettings:36) | editorError | openEditorDialog | handleEditorSelect/exitEditorDialog |
| provider | appReducer openDialogs.provider (useProviderDialog:111) | providerOptions, selectedProvider | openProviderDialog | handleProviderSelect/exitProviderDialog |
| loadProfile | appReducer openDialogs.loadProfile (useLoadProfileDialog:77) | profiles | openLoadProfileDialog | handleProfileSelect/exitLoadProfileDialog |
| createProfile | appReducer openDialogs.createProfile (useCreateProfileDialog:21) | createProfileProviders | openCreateProfileDialog | exitCreateProfileDialog |
| profileList | appReducer (useProfileManagement:76) | profileListItems, loading, default/active | openProfileListDialog | closeProfileListDialog |
| profileDetail | appReducer (useProfileManagement:77) | selectedProfileName/Data, error | viewProfileDetail | closeProfileDetailDialog |
| profileEditor | appReducer (useProfileManagement:78) | selectedProfileData | openProfileEditor | closeProfileEditor |
| tools | appReducer openDialogs.tools (useToolsDialog:106) | action, tools, disabledTools | openToolsDialog(action) | handleToolsSelect/exitToolsDialog |
| privacy | useDialogsState showPrivacyNotice | — | openPrivacyNotice | handlePrivacyNoticeExit |
| permissions | useDialogOrchestration | — | openPermissionsDialog | closePermissionsDialog |
| logging | useDialogOrchestration + loggingDialogData | entries | openLoggingDialog(data) | closeLoggingDialog |
| subagent | useDialogOrchestration | initialView/Name | openSubagentDialog(v,n) | closeSubagentDialog |
| models | useDialogOrchestration + modelsDialogData | ModelsDialogData | openModelsDialog(data) | closeModelsDialog |
| sessionBrowser | useDialogOrchestration | — | openSessionBrowserDialog | closeSessionBrowserDialog |
| modelConfig | useDialogOrchestration | — | openModelConfigDialog | closeModelConfigDialog |
| policies | useDialogOrchestration | — | openPoliciesDialog | closePoliciesDialog |

## Readers of dialog fields (outside plumbing files)

- `layouts/DefaultAppLayoutHelpers.tsx`: `hasActiveDialog(uiState)` aggregates ALL
  25 booleans+confirmation → becomes `useStoreSelector(dialogStore, hasOpenDialog)`
  where `hasOpenDialog = (s) => s.requests.length>0 || s.confirmationRequest!==null || s.confirmUpdateLlxprtExtensionRequests.length>0`.
  NOTE today's list does NOT include shouldShowIdePrompt? It DOES (line 53). Include idePrompt as a request kind driven by the composition root.
- `containers/AppContainer/hooks/useInitialPromptSubmit.ts`: reads isThemeDialogOpen,
  isAuthDialogOpen, isEditorDialogOpen, isProviderDialogOpen,
  isCreateProfileDialogOpen, isToolsDialogOpen, isFolderTrustDialogOpen,
  showPrivacyNotice, isWelcomeDialogOpen → replace with one
  `useStoreSelector(store, hasOpenDialog)`-style selector or per-kind reads as logic requires.
- `hooks/useUnconfiguredProviderGuidance.ts`: isWelcomeDialogOpen → selector.
- `hooks/useSlashCommandProcessorCore.ts`, `containers/AppContainer/hooks/useSelectionDebugLogger.ts`,
  `containers/AppContainer/hooks/useConfirmationSelection.ts`: confirmationRequest → store.
- `hooks/useOAuthOrchestration.ts`: isOAuthCodeDialogOpen prop → fed from selector.
- Dialog data fields in UIState used ONLY by DialogManager (providerOptions,
  toolsDialog*, loggingDialogData, subagentDialogInitial*, modelsDialogData,
  profileList*, selectedProfile*, welcome*) → leave data in feature hooks /
  store payloads; remove from UIState.

## appReducer OPEN_DIALOG/CLOSE_DIALOG dispatchers (files)

useThemeCommand, useOAuthOrchestration, useProviderDialog, useEditorSettings,
useProfileManagement, useLoadProfileDialog, useAuthCommand, useCreateProfileDialog,
useToolsDialog, useAppInput, useInputHandling (+ appReducer itself).

## Open/close function consumers (to re-route to store commands)

- `useAppInput` params list (AppContainerRuntime buildInputParams) — remove
  open*/set* dialog params; give useAppInput the dialog store instead.
- `useSlashCommandActions`, `hooks/slashCommandHandlers.ts`,
  `hooks/slashCommandProcessor.ts` — receive open callbacks today; receive
  store (or a small `DialogOpeners` object derived once from commands) instead.
- `useAppLayout` params (dialog booleans for layout decisions) → selectors.
- `IdeIntegrationNudge` completion → closeDialog('idePrompt').
- `useSteer`, `oauth-submission.ts`, `oauthGlobalState.ts` — check for dialog refs.

## UIActions dialog members to delete

openThemeDialog/handleThemeHighlight(non-dialog? keep if theme preview),
openSettingsDialog/closeSettingsDialog, openAuthDialog, openEditorDialog/
exitEditorDialog, openProviderDialog/exitProviderDialog, openLoadProfileDialog/
exitLoadProfileDialog, openCreateProfileDialog/exitCreateProfileDialog,
openProfileListDialog/closeProfileListDialog/viewProfileDetail/
closeProfileDetailDialog/loadProfileFromDetail? (domain: keep reachable via
profile hook wiring in DialogManager), openProfileEditor/closeProfileEditor,
openToolsDialog/handleToolsSelect/exitToolsDialog, openPermissionsDialog/
closePermissionsDialog, openLoggingDialog/closeLoggingDialog, openSubagentDialog/
closeSubagentDialog, openModelsDialog/closeModelsDialog, openModelConfigDialog/
closeModelConfigDialog, openPoliciesDialog/closePoliciesDialog,
openSessionBrowserDialog/closeSessionBrowserDialog, onWorkspaceMigrationDialog*
(open/close), openPrivacyNotice/handlePrivacyNoticeExit, handleOAuthCodeDialogClose.
KEEP domain handlers where still consumed: handleThemeSelect, handleAuthSelect,
handleEditorSelect, handleProviderSelect, handleFolderTrustSelect, welcomeActions,
triggerWelcomeAuth, handleOAuthCodeSubmit, handleIdePromptComplete,
handleToolsSelect, handleConfirmationSelect, saveProfileFromEditor,
deleteProfileFromList/Detail, setProfileAsDefault, loadProfileFromDetail.

## Test files referencing dialog plumbing

appReducer.test.ts, buildUIState.test.ts, buildUIActions.test.ts,
DialogManager.test.tsx, ThemeDialog.test.tsx, DefaultAppLayout.test.tsx,
DefaultAppLayout.rendering.test.tsx, __tests__/integrationWiring.spec.tsx,
AppContainer.cancel-race.test.tsx, AppContainer.oauth-dismiss.test.ts,
hooks/useSlashCommandActions.test.ts, containers/AppContainer/hooks/*.test.ts
(grep each removed symbol).

## Compilable two-step split

- **B2 (store-native dialogs):** migrate everything EXCEPT the appReducer-backed
  kinds: confirmation, extensionUpdateConfirm, idePrompt, workspaceMigration,
  folderTrust, welcome, privacy, permissions, logging, subagent, models,
  sessionBrowser, modelConfig, policies + settings (useSettingsCommand internal
  boolean). appReducer-backed booleans (theme/auth/oauthCode/editor/provider/
  loadProfile/createProfile/profileList/profileDetail/profileEditor/tools) still
  flow through UIState this step. Delete useDialogOrchestration.
- **B3 (appReducer-backed dialogs):** migrate the remaining 12 kinds, delete
  openDialogs + OPEN_DIALOG/CLOSE_DIALOG + errors-as-payload for theme/auth/
  editor dialog errors if only used by dialogs, finish UIState/UIActions
  dialog-field removal.
