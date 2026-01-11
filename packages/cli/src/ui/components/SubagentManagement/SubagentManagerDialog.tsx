/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useUIState } from '../../contexts/UIStateContext.js';
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

export const SubagentManagerDialog: React.FC<SubagentManagerDialogProps> = ({
  onClose,
  initialView = SubagentView.MENU,
  initialSubagentName,
}) => {
  const uiState = useUIState();
  const { commandContext } = uiState;
  const subagentManager = commandContext?.services?.subagentManager;
  const profileManager = commandContext?.services?.profileManager;

  const [state, setState] = useState<SubagentManagerState>({
    currentView: initialView,
    selectedSubagent: null,
    navigationStack: [initialView], // Start with initial view, not menu
    searchTerm: '',
    searchActive: false,
    selectedIndex: 0,
    subagents: [],
    profiles: [],
    isLoading: true,
    error: null,
  });

  // Load subagents and profiles
  const loadData = useCallback(async () => {
    if (!subagentManager) {
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
        profileManager?.listProfiles() ?? Promise.resolve([]),
      ]);

      // Load full subagent configs
      const subagents: SubagentInfo[] = await Promise.all(
        subagentNames.map(async (name) => {
          const config = await subagentManager.loadSubagent(name);
          return config as SubagentInfo;
        }),
      );

      setState((prev) => ({
        ...prev,
        subagents,
        profiles: profileNames,
        isLoading: false,
      }));

      // If initial subagent specified, select it
      if (initialSubagentName) {
        const found = subagents.find((s) => s.name === initialSubagentName);
        if (found) {
          setState((prev) => ({
            ...prev,
            selectedSubagent: found,
            currentView: initialView,
          }));
        }
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load data',
      }));
    }
  }, [subagentManager, profileManager, initialSubagentName, initialView]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Navigation helpers
  const navigateTo = useCallback(
    (view: SubagentView, subagent?: SubagentInfo) => {
      setState((prev) => ({
        ...prev,
        currentView: view,
        navigationStack: [...prev.navigationStack, view],
        selectedSubagent: subagent ?? prev.selectedSubagent,
      }));
    },
    [],
  );

  const goBack = useCallback(() => {
    setState((prev) => {
      const newStack = prev.navigationStack.slice(0, -1);
      // If stack is empty or only has initial view, close dialog
      if (newStack.length === 0) {
        // Use setTimeout to avoid state update during render
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
  }, [onClose]);

  // Handle subagent selection from list
  const handleSubagentSelect = useCallback(
    (subagent: SubagentInfo) => {
      navigateTo(SubagentView.SHOW, subagent);
    },
    [navigateTo],
  );

  // Handle edit from list or show view
  const handleEdit = useCallback(
    (subagent?: SubagentInfo) => {
      const target = subagent ?? state.selectedSubagent;
      if (target) {
        navigateTo(SubagentView.EDIT, target);
      }
    },
    [navigateTo, state.selectedSubagent],
  );

  // Handle attach profile from list
  const handleAttachProfile = useCallback(
    (subagent: SubagentInfo) => {
      navigateTo(SubagentView.ATTACH_PROFILE, subagent);
    },
    [navigateTo],
  );

  // Handle select profile from edit form (uses current selected subagent)
  const handleSelectProfileFromEdit = useCallback(() => {
    if (state.selectedSubagent) {
      navigateTo(SubagentView.ATTACH_PROFILE, state.selectedSubagent);
    }
  }, [navigateTo, state.selectedSubagent]);

  // Handle delete from list
  const handleDeleteRequest = useCallback(
    (subagent: SubagentInfo) => {
      navigateTo(SubagentView.DELETE, subagent);
    },
    [navigateTo],
  );

  // Handle save (edit)
  const handleSave = useCallback(
    async (systemPrompt: string, profile: string) => {
      if (!subagentManager || !state.selectedSubagent) return;

      await subagentManager.saveSubagent(
        state.selectedSubagent.name,
        profile,
        systemPrompt,
      );
      await loadData();
      goBack();
    },
    [subagentManager, state.selectedSubagent, loadData, goBack],
  );

  // Handle create
  const handleCreate = useCallback(
    async (name: string, systemPrompt: string, profile: string) => {
      if (!subagentManager) return;

      await subagentManager.saveSubagent(name, profile, systemPrompt);
      await loadData();
      navigateTo(SubagentView.LIST);
    },
    [subagentManager, loadData, navigateTo],
  );

  // Handle profile attachment
  const handleProfileAttach = useCallback(
    async (profileName: string) => {
      if (!subagentManager || !state.selectedSubagent) return;

      await subagentManager.saveSubagent(
        state.selectedSubagent.name,
        profileName,
        state.selectedSubagent.systemPrompt,
      );
      await loadData();
      goBack();
    },
    [subagentManager, state.selectedSubagent, loadData, goBack],
  );

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (!subagentManager || !state.selectedSubagent) return;

    await subagentManager.deleteSubagent(state.selectedSubagent.name);
    await loadData();
    // After delete, close the dialog
    onClose();
  }, [subagentManager, state.selectedSubagent, loadData, onClose]);

  // Render current view
  const renderView = () => {
    if (state.isLoading) {
      return <Text color={Colors.Gray}>Loading...</Text>;
    }

    if (state.error) {
      return (
        <Box flexDirection="column">
          <Text color="#ff0000">Error: {state.error}</Text>
          <Box marginTop={1}>
            <Text color={Colors.Gray}>[ESC] Close</Text>
          </Box>
        </Box>
      );
    }

    switch (state.currentView) {
      case SubagentView.LIST:
        return (
          <SubagentListMenu
            subagents={state.subagents}
            onSelect={handleSubagentSelect}
            onEdit={handleEdit}
            onAttachProfile={handleAttachProfile}
            onDelete={handleDeleteRequest}
            onBack={goBack}
            isLoading={state.isLoading}
            isFocused={true}
          />
        );

      case SubagentView.SHOW:
        if (!state.selectedSubagent) {
          return <Text color={Colors.Gray}>No subagent selected</Text>;
        }
        return (
          <SubagentShowView
            subagent={state.selectedSubagent}
            onEdit={handleEdit}
            onBack={goBack}
            isFocused={true}
          />
        );

      case SubagentView.EDIT:
        if (!state.selectedSubagent) {
          return <Text color={Colors.Gray}>No subagent selected</Text>;
        }
        return (
          <SubagentEditForm
            subagent={state.selectedSubagent}
            profiles={state.profiles}
            onSave={handleSave}
            onCancel={goBack}
            onSelectProfile={handleSelectProfileFromEdit}
            isFocused={true}
          />
        );

      case SubagentView.CREATE:
        return (
          <SubagentCreationWizard
            profiles={state.profiles}
            onSave={handleCreate}
            onCancel={goBack}
            isFocused={true}
          />
        );

      case SubagentView.ATTACH_PROFILE:
        if (!state.selectedSubagent) {
          return <Text color={Colors.Gray}>No subagent selected</Text>;
        }
        return (
          <ProfileAttachmentWizard
            subagent={state.selectedSubagent}
            profiles={state.profiles}
            onConfirm={handleProfileAttach}
            onCancel={goBack}
            isFocused={true}
          />
        );

      case SubagentView.DELETE:
        if (!state.selectedSubagent) {
          return <Text color={Colors.Gray}>No subagent selected</Text>;
        }
        return (
          <SubagentDeleteDialog
            subagent={state.selectedSubagent}
            onConfirm={handleDeleteConfirm}
            onCancel={goBack}
            isFocused={true}
          />
        );

      default:
        return <Text color={Colors.Gray}>Unknown view</Text>;
    }
  };

  // Get title based on current view
  const getTitle = () => {
    switch (state.currentView) {
      case SubagentView.LIST:
        return 'Subagent List';
      case SubagentView.SHOW:
        return `Subagent: ${state.selectedSubagent?.name ?? ''}`;
      case SubagentView.EDIT:
        return `Edit: ${state.selectedSubagent?.name ?? ''}`;
      case SubagentView.CREATE:
        return 'Create Subagent';
      case SubagentView.ATTACH_PROFILE:
        return `Attach Profile: ${state.selectedSubagent?.name ?? ''}`;
      case SubagentView.DELETE:
        return 'Delete Subagent';
      default:
        return 'Subagent';
    }
  };

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
    >
      <Box marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          {getTitle()}
        </Text>
      </Box>

      {renderView()}
    </Box>
  );
};
