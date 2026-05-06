/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useUIState } from '../../contexts/UIStateContext.js';
import type { CommandContext } from '../../commands/types.js';
import type {
  SubagentManager,
  ProfileManager,
} from '@vybestack/llxprt-code-core';
import {
  SubagentView,
  type SubagentManagerDialogProps,
  type SubagentManagerState,
  type SubagentInfo,
} from './types.js';
import { SubagentListMenu } from './SubagentListMenu.js';
import { SubagentShowView } from './SubagentShowView.js';
import { SubagentEditForm } from './SubagentEditForm.js';
import { SubagentCreationWizard } from './SubagentCreationWizard.js';
import { ProfileAttachmentWizard } from './ProfileAttachmentWizard.js';
import { SubagentDeleteDialog } from './SubagentDeleteDialog.js';
import { SubagentMainMenu } from './SubagentMainMenu.js';

function useDataLoader(
  subagentManager: SubagentManager | undefined,
  profileManager: ProfileManager | undefined,
  initialSubagentName: string | undefined,
  initialView: SubagentView,
  setState: React.Dispatch<React.SetStateAction<SubagentManagerState>>,
) {
  return useCallback(async () => {
    if (subagentManager === undefined) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'SubagentManager not available',
      }));
      return;
    }
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const [subagentNames, profileNames] = await Promise.all([
        subagentManager.listSubagents(),
        profileManager !== undefined
          ? profileManager.listProfiles()
          : Promise.resolve([]),
      ]);
      const subagents: SubagentInfo[] = await Promise.all(
        subagentNames.map(async (name: string) => {
          const config = await subagentManager.loadSubagent(name);
          return config as SubagentInfo;
        }),
      );
      setState((prev) => {
        let selectedSubagent = prev.selectedSubagent;
        if (initialSubagentName && !selectedSubagent)
          selectedSubagent =
            subagents.find((s) => s.name === initialSubagentName) ?? null;
        else if (selectedSubagent)
          selectedSubagent =
            subagents.find((s) => s.name === selectedSubagent?.name) ?? null;
        return {
          ...prev,
          subagents,
          profiles: profileNames,
          selectedSubagent,
          currentView:
            selectedSubagent || prev.currentView !== initialView
              ? prev.currentView
              : initialView,
          isLoading: false,
        };
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load data',
      }));
    }
  }, [
    subagentManager,
    profileManager,
    initialSubagentName,
    initialView,
    setState,
  ]);
}

function useNavigation(
  setState: React.Dispatch<React.SetStateAction<SubagentManagerState>>,
  onClose: () => void,
) {
  const navigateTo = useCallback(
    (view: SubagentView, subagent?: SubagentInfo) => {
      setState((prev) => ({
        ...prev,
        currentView: view,
        navigationStack: [...prev.navigationStack, view],
        selectedSubagent: subagent ?? prev.selectedSubagent,
      }));
    },
    [setState],
  );
  const goBack = useCallback(() => {
    setState((prev) => {
      const newStack = prev.navigationStack.slice(0, -1);
      if (newStack.length === 0) {
        setTimeout(() => onClose(), 0);
        return prev;
      }
      const prevView = newStack[newStack.length - 1];
      return {
        ...prev,
        currentView: prevView,
        navigationStack: newStack,
        selectedSubagent:
          prevView === SubagentView.LIST ? null : prev.selectedSubagent,
      };
    });
  }, [onClose, setState]);
  return { navigateTo, goBack };
}

function useSelectHandlers(
  state: SubagentManagerState,
  navigateTo: (v: SubagentView, s?: SubagentInfo) => void,
) {
  const handleSubagentSelect = useCallback(
    (s: SubagentInfo) => {
      navigateTo(SubagentView.SHOW, s);
    },
    [navigateTo],
  );
  const handleEdit = useCallback(
    (s?: SubagentInfo) => {
      const t = s ?? state.selectedSubagent;
      if (t) navigateTo(SubagentView.EDIT, t);
    },
    [navigateTo, state.selectedSubagent],
  );
  const handleAttachProfile = useCallback(
    (s: SubagentInfo) => {
      navigateTo(SubagentView.ATTACH_PROFILE, s);
    },
    [navigateTo],
  );
  const handleSelectProfileFromEdit = useCallback(() => {
    if (state.selectedSubagent)
      navigateTo(SubagentView.ATTACH_PROFILE, state.selectedSubagent);
  }, [navigateTo, state.selectedSubagent]);
  const handleDeleteRequest = useCallback(
    (s: SubagentInfo) => {
      navigateTo(SubagentView.DELETE, s);
    },
    [navigateTo],
  );
  return {
    handleSubagentSelect,
    handleEdit,
    handleAttachProfile,
    handleSelectProfileFromEdit,
    handleDeleteRequest,
  };
}

function useSaveHandler(
  subagentManager: SubagentManager | undefined,
  state: SubagentManagerState,
  setPendingProfile: (p: string | undefined) => void,
  setState: React.Dispatch<React.SetStateAction<SubagentManagerState>>,
  loadData: () => Promise<void>,
  goBack: () => void,
) {
  return useCallback(
    async (systemPrompt: string, profile: string) => {
      if (subagentManager === undefined || !state.selectedSubagent) return;
      try {
        await subagentManager.saveSubagent(
          state.selectedSubagent.name,
          profile,
          systemPrompt,
        );
        setPendingProfile(undefined);
        await loadData();
        goBack();
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Failed to save subagent',
        }));
      }
    },
    [
      subagentManager,
      state.selectedSubagent,
      loadData,
      goBack,
      setPendingProfile,
      setState,
    ],
  );
}

function useCreateHandler(
  subagentManager: SubagentManager | undefined,
  runtimeCommandContext: CommandContext | undefined,
  onClose: () => void,
) {
  return useCallback(
    async (
      name: string,
      systemPrompt: string,
      profile: string,
      mode: 'auto' | 'manual' = 'auto',
    ) => {
      if (subagentManager === undefined)
        throw new Error('SubagentManager not available');
      let finalPrompt = systemPrompt;
      if (mode === 'auto') {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Subagent creation can be invoked before the runtime command context has a config service.
        const config = runtimeCommandContext?.services?.config;
        if (config === null || config === undefined)
          throw new Error(
            'Configuration service unavailable. Set up the CLI before using auto mode.',
          );
        const { generateAutoPrompt } = await import(
          '../../utils/autoPromptGenerator.js'
        );
        finalPrompt = await generateAutoPrompt(config, systemPrompt);
      }
      await subagentManager.saveSubagent(name, profile, finalPrompt);
      onClose();
    },
    [subagentManager, onClose, runtimeCommandContext],
  );
}

function useProfileAttachHandler(
  subagentManager: SubagentManager | undefined,
  state: SubagentManagerState,
  setPendingProfile: (p: string | undefined) => void,
  setState: React.Dispatch<React.SetStateAction<SubagentManagerState>>,
  loadData: () => Promise<void>,
  goBack: () => void,
) {
  return useCallback(
    async (profileName: string) => {
      if (!state.selectedSubagent) return;
      const prevView =
        state.navigationStack.length >= 2
          ? state.navigationStack[state.navigationStack.length - 2]
          : null;
      if (prevView === SubagentView.EDIT) {
        setPendingProfile(profileName);
        goBack();
        return;
      }
      if (subagentManager === undefined) return;
      try {
        await subagentManager.saveSubagent(
          state.selectedSubagent.name,
          profileName,
          state.selectedSubagent.systemPrompt,
        );
        await loadData();
        goBack();
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error:
            err instanceof Error ? err.message : 'Failed to attach profile',
        }));
      }
    },
    [
      subagentManager,
      state.selectedSubagent,
      state.navigationStack,
      loadData,
      goBack,
      setPendingProfile,
      setState,
    ],
  );
}

function useDeleteConfirmHandler(
  subagentManager: SubagentManager | undefined,
  state: SubagentManagerState,
  setState: React.Dispatch<React.SetStateAction<SubagentManagerState>>,
  loadData: () => Promise<void>,
  onClose: () => void,
) {
  return useCallback(async () => {
    if (subagentManager === undefined || !state.selectedSubagent) return;
    try {
      await subagentManager.deleteSubagent(state.selectedSubagent.name);
      await loadData();
      onClose();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to delete subagent',
      }));
    }
  }, [subagentManager, state.selectedSubagent, loadData, onClose, setState]);
}

function LoadingOrErrorView({ error }: { error: string | null }) {
  if (error !== null)
    return (
      <Box flexDirection="column">
        <Text color="#ff0000">Error: {error}</Text>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>[ESC] Close</Text>
        </Box>
      </Box>
    );
  return <Text color={Colors.Gray}>Loading...</Text>;
}

function getTitle(
  currentView: SubagentView,
  selectedSubagent: SubagentInfo | null,
): string {
  switch (currentView) {
    case SubagentView.LIST:
      return 'Subagent List';
    case SubagentView.SHOW:
      return `Subagent: ${selectedSubagent?.name ?? ''}`;
    case SubagentView.EDIT:
      return `Edit: ${selectedSubagent?.name ?? ''}`;
    case SubagentView.CREATE:
      return 'Create Subagent';
    case SubagentView.ATTACH_PROFILE:
      return `Attach Profile: ${selectedSubagent?.name ?? ''}`;
    case SubagentView.DELETE:
      return 'Delete Subagent';
    case SubagentView.MENU:
      return 'Subagent Manager';
    default:
      return 'Subagent';
  }
}

function NoSubagentSelected() {
  return <Text color={Colors.Gray}>No subagent selected</Text>;
}

function ViewForList({
  state,
  handlers,
  goBack,
}: {
  state: SubagentManagerState;
  handlers: ReturnType<typeof useSelectHandlers>;
  goBack: () => void;
}) {
  return (
    <SubagentListMenu
      subagents={state.subagents}
      onSelect={handlers.handleSubagentSelect}
      onEdit={handlers.handleEdit}
      onAttachProfile={handlers.handleAttachProfile}
      onDelete={handlers.handleDeleteRequest}
      onBack={goBack}
      isLoading={state.isLoading}
      isFocused={true}
    />
  );
}

function ViewForShow({
  state,
  handlers,
  goBack,
}: {
  state: SubagentManagerState;
  handlers: ReturnType<typeof useSelectHandlers>;
  goBack: () => void;
}) {
  const handleEdit = useCallback(() => {
    handlers.handleEdit();
  }, [handlers]);

  if (!state.selectedSubagent) return <NoSubagentSelected />;
  return (
    <SubagentShowView
      subagent={state.selectedSubagent}
      onEdit={handleEdit}
      onBack={goBack}
      isFocused={true}
    />
  );
}

function ViewForEdit({
  state,
  pendingProfile,
  handlers,
  handleSave,
  handleEditCancel,
}: {
  state: SubagentManagerState;
  pendingProfile: string | undefined;
  handlers: ReturnType<typeof useSelectHandlers>;
  handleSave: (sp: string, p: string) => Promise<void>;
  handleEditCancel: () => void;
}) {
  if (!state.selectedSubagent) return <NoSubagentSelected />;
  return (
    <SubagentEditForm
      subagent={state.selectedSubagent}
      profiles={state.profiles}
      pendingProfile={pendingProfile}
      onSave={handleSave}
      onCancel={handleEditCancel}
      onSelectProfile={handlers.handleSelectProfileFromEdit}
      isFocused={true}
    />
  );
}

function ViewForAttach({
  state,
  handleProfileAttach,
  goBack,
}: {
  state: SubagentManagerState;
  handleProfileAttach: (p: string) => Promise<void>;
  goBack: () => void;
}) {
  if (!state.selectedSubagent) return <NoSubagentSelected />;
  return (
    <ProfileAttachmentWizard
      subagent={state.selectedSubagent}
      profiles={state.profiles}
      onConfirm={handleProfileAttach}
      onCancel={goBack}
      isFocused={true}
    />
  );
}

function ViewForDelete({
  state,
  handleDeleteConfirm,
  goBack,
}: {
  state: SubagentManagerState;
  handleDeleteConfirm: () => Promise<void>;
  goBack: () => void;
}) {
  if (!state.selectedSubagent) return <NoSubagentSelected />;
  return (
    <SubagentDeleteDialog
      subagent={state.selectedSubagent}
      onConfirm={handleDeleteConfirm}
      onCancel={goBack}
      isFocused={true}
    />
  );
}

function useDialogState(initialView: SubagentView) {
  return useState<SubagentManagerState>(() => ({
    currentView: initialView,
    selectedSubagent: null,
    navigationStack: [initialView],
    searchTerm: '',
    searchActive: false,
    selectedIndex: 0,
    subagents: [],
    profiles: [],
    isLoading: true,
    error: null,
  }));
}

interface ManagerDialogViewProps {
  state: SubagentManagerState;
  pendingProfile: string | undefined;
  activeProfileName: string | null | undefined;
  handlers: ReturnType<typeof useSelectHandlers>;
  handleSave: (sp: string, p: string) => Promise<void>;
  handleEditCancel: () => void;

  handleCreate: (
    n: string,
    sp: string,
    p: string,
    m: 'auto' | 'manual',
  ) => Promise<void>;
  handleProfileAttach: (p: string) => Promise<void>;
  handleDeleteConfirm: () => Promise<void>;
  navigateTo: (v: SubagentView, s?: SubagentInfo) => void;
  goBack: () => void;
  onClose: () => void;
}

function CreateView(props: ManagerDialogViewProps) {
  return (
    <SubagentCreationWizard
      profiles={props.state.profiles}
      activeProfileName={props.activeProfileName}
      onSave={props.handleCreate}
      onCancel={props.goBack}
      isFocused={true}
    />
  );
}

function MenuView(props: ManagerDialogViewProps) {
  return (
    <SubagentMainMenu
      onSelect={props.navigateTo}
      onCancel={props.onClose}
      isFocused={true}
    />
  );
}

function renderCurrentView(props: ManagerDialogViewProps) {
  const { state } = props;
  if (state.isLoading || state.error !== null)
    return <LoadingOrErrorView error={state.error} />;
  switch (state.currentView) {
    case SubagentView.LIST:
      return (
        <ViewForList
          state={state}
          handlers={props.handlers}
          goBack={props.goBack}
        />
      );
    case SubagentView.SHOW:
      return (
        <ViewForShow
          state={state}
          handlers={props.handlers}
          goBack={props.goBack}
        />
      );
    case SubagentView.EDIT:
      return (
        <ViewForEdit
          state={state}
          pendingProfile={props.pendingProfile}
          handlers={props.handlers}
          handleSave={props.handleSave}
          handleEditCancel={props.handleEditCancel}
        />
      );
    case SubagentView.CREATE:
      return <CreateView {...props} />;
    case SubagentView.ATTACH_PROFILE:
      return (
        <ViewForAttach
          state={state}
          handleProfileAttach={props.handleProfileAttach}
          goBack={props.goBack}
        />
      );
    case SubagentView.DELETE:
      return (
        <ViewForDelete
          state={state}
          handleDeleteConfirm={props.handleDeleteConfirm}
          goBack={props.goBack}
        />
      );
    case SubagentView.MENU:
      return <MenuView {...props} />;
    default:
      return <Text color={Colors.Gray}>Unknown view</Text>;
  }
}

function ManagerDialogView(props: ManagerDialogViewProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
    >
      <Box marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          {getTitle(props.state.currentView, props.state.selectedSubagent)}
        </Text>
      </Box>
      {renderCurrentView(props)}
    </Box>
  );
}

export const SubagentManagerDialog: React.FC<SubagentManagerDialogProps> = ({
  onClose,
  initialView = SubagentView.MENU,
  initialSubagentName,
}) => {
  const { activeProfileName, commandContext } = useUIState();
  const runtimeCommandContext = commandContext as CommandContext | undefined;
  const subagentManager = runtimeCommandContext?.services.subagentManager;
  const profileManager = runtimeCommandContext?.services.profileManager;

  const [state, setState] = useDialogState(initialView);
  const [pendingProfile, setPendingProfile] = useState<string | undefined>(
    undefined,
  );

  const loadData = useDataLoader(
    subagentManager,
    profileManager,
    initialSubagentName,
    initialView,
    setState,
  );
  useEffect(() => {
    void loadData();
  }, [loadData]);

  const { navigateTo, goBack } = useNavigation(setState, onClose);
  const handlers = useSelectHandlers(state, navigateTo);
  const handleSave = useSaveHandler(
    subagentManager,
    state,
    setPendingProfile,
    setState,
    loadData,
    goBack,
  );
  const handleEditCancel = useCallback(() => {
    setPendingProfile(undefined);
    goBack();
  }, [goBack]);
  const handleCreate = useCreateHandler(
    subagentManager,
    runtimeCommandContext,
    onClose,
  );
  const handleProfileAttach = useProfileAttachHandler(
    subagentManager,
    state,
    setPendingProfile,
    setState,
    loadData,
    goBack,
  );
  const handleDeleteConfirm = useDeleteConfirmHandler(
    subagentManager,
    state,
    setState,
    loadData,
    onClose,
  );

  return (
    <ManagerDialogView
      state={state}
      pendingProfile={pendingProfile}
      activeProfileName={activeProfileName}
      handleEditCancel={handleEditCancel}
      handlers={handlers}
      handleSave={handleSave}
      handleCreate={handleCreate}
      handleProfileAttach={handleProfileAttach}
      handleDeleteConfirm={handleDeleteConfirm}
      navigateTo={navigateTo}
      goBack={goBack}
      onClose={onClose}
    />
  );
};
