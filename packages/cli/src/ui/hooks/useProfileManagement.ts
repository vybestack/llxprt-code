/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import { AppState } from '../reducers/appReducer.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { Profile } from '@vybestack/llxprt-code-core';
import type { ProfileListItem } from '../components/ProfileListDialog.js';
import { ProfileManager, DebugLogger } from '@vybestack/llxprt-code-core';

const debug = new DebugLogger('llxprt:ui:useProfileManagement');

/**
 * Validates a profile before saving. Returns error message or null if valid.
 */
function validateProfileForSave(profile: unknown): string | null {
  if (typeof profile !== 'object' || profile === null) {
    return 'Invalid profile: must be an object';
  }

  const p = profile as Record<string, unknown>;

  if (!('version' in p) || typeof p.version !== 'string') {
    return 'Invalid profile: missing or invalid version';
  }

  if (!('type' in p) || typeof p.type !== 'string') {
    return 'Invalid profile: missing or invalid type';
  }

  // Type-specific validation
  if (p.type === 'standard') {
    if (!('provider' in p) || typeof p.provider !== 'string' || !p.provider) {
      return 'Standard profile requires a provider';
    }
    if (!('model' in p) || typeof p.model !== 'string' || !p.model) {
      return 'Standard profile requires a model';
    }
  } else if (p.type === 'loadbalancer') {
    if (!('profiles' in p) || !Array.isArray(p.profiles)) {
      return 'Load balancer profile requires a profiles array';
    }
    if (p.profiles.length === 0) {
      return 'Load balancer profile requires at least one profile';
    }
    if (!p.profiles.every((item) => typeof item === 'string')) {
      return 'Load balancer profiles must be strings';
    }
    if (!('policy' in p) || typeof p.policy !== 'string' || !p.policy) {
      return 'Load balancer profile requires a policy';
    }
  } else {
    return `Unknown profile type: ${p.type}`;
  }

  return null;
}

interface UseProfileManagementParams {
  addMessage: (msg: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }) => void;
  appState: AppState;
}

export const useProfileManagement = ({
  addMessage,
  appState,
}: UseProfileManagementParams) => {
  const appDispatch = useAppDispatch();
  const runtime = useRuntimeApi();

  // Dialog visibility states
  const showListDialog = appState.openDialogs.profileList;
  const showDetailDialog = appState.openDialogs.profileDetail;
  const showEditorDialog = appState.openDialogs.profileEditor;

  // Data states
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(
    null,
  );
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [defaultProfileName, setDefaultProfileName] = useState<string | null>(
    null,
  );
  const [activeProfileName, setActiveProfileName] = useState<string | null>(
    null,
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  // Track if detail was opened directly (vs from list)
  const [detailOpenedDirectly, setDetailOpenedDirectly] = useState(false);
  // Track if editor was opened directly (vs from detail)
  const [editorOpenedDirectly, setEditorOpenedDirectly] = useState(false);

  // Load profiles list
  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    setProfileError(null);

    try {
      const profileNames = await runtime.listSavedProfiles();

      // Get additional profile info (type, provider, model)
      const profileItems: ProfileListItem[] = await Promise.all(
        profileNames.map(async (name) => {
          try {
            const profile = await runtime.getProfileByName(name);
            const isLB = profile.type === 'loadbalancer';
            return {
              name,
              type: isLB ? 'loadbalancer' : 'standard',
              provider: isLB ? undefined : profile.provider,
              model: isLB ? undefined : profile.model,
            } as ProfileListItem;
          } catch {
            // If we can't load the profile, return with error indicator
            return {
              name,
              type: 'standard',
              loadError: true,
            } as ProfileListItem;
          }
        }),
      );

      setProfiles(profileItems);

      // Try to get default profile name from settings
      try {
        const services = runtime.getCliRuntimeServices();
        const defaultName = services.settingsService.get('defaultProfile') as
          | string
          | null;
        setDefaultProfileName(defaultName ?? null);
      } catch {
        // Ignore errors getting default profile
      }

      // Try to get active profile name
      try {
        const diagnostics = runtime.getRuntimeDiagnosticsSnapshot();
        const current = diagnostics?.profileName;
        setActiveProfileName(current ?? null);
      } catch {
        // Ignore errors getting active profile
      }
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : 'Failed to load profiles',
      );
      addMessage({
        type: MessageType.ERROR,
        content: `Failed to load profiles: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      });
    } finally {
      setIsLoading(false);
    }
  }, [runtime, addMessage]);

  // Open list dialog
  const openListDialog = useCallback(async () => {
    debug.log(() => 'openListDialog called');
    appDispatch({ type: 'OPEN_DIALOG', payload: 'profileList' });
    debug.log(() => 'dispatched OPEN_DIALOG profileList');
    await loadProfiles();
    debug.log(() => 'loadProfiles completed');
  }, [appDispatch, loadProfiles]);

  // Close list dialog
  const closeListDialog = useCallback(() => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileList' });
  }, [appDispatch]);

  // View profile detail
  // openedDirectly: true when opened via /profile show, false when from list
  const viewProfileDetail = useCallback(
    async (profileName: string, openedDirectly = false) => {
      setSelectedProfileName(profileName);
      setSelectedProfile(null);
      setProfileError(null);
      setIsLoading(true);
      setDetailOpenedDirectly(openedDirectly);

      // Close list, open detail
      appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileList' });
      appDispatch({ type: 'OPEN_DIALOG', payload: 'profileDetail' });

      try {
        const profile = await runtime.getProfileByName(profileName);
        setSelectedProfile(profile);
      } catch (error) {
        setProfileError(
          error instanceof Error ? error.message : 'Failed to load profile',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [appDispatch, runtime],
  );

  // Close detail dialog
  const closeDetailDialog = useCallback(async () => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileDetail' });
    setSelectedProfileName(null);
    setSelectedProfile(null);
    setProfileError(null);

    // If opened directly via /profile show, just close
    // If opened from list, go back to list
    if (!detailOpenedDirectly) {
      appDispatch({ type: 'OPEN_DIALOG', payload: 'profileList' });
      await loadProfiles();
    }
    setDetailOpenedDirectly(false);
  }, [appDispatch, loadProfiles, detailOpenedDirectly]);

  // Load profile
  const loadProfile = useCallback(
    async (profileName: string) => {
      try {
        const result = await runtime.loadProfileByName(profileName);
        const extra = (result.infoMessages ?? [])
          .map((message: string) => `\n- ${message}`)
          .join('');
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' loaded${extra}`,
          timestamp: new Date(),
        });
        for (const warning of result.warnings ?? []) {
          addMessage({
            type: MessageType.INFO,
            content: `\u26A0 ${warning}`,
            timestamp: new Date(),
          });
        }
        // Close all profile dialogs
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileDetail' });
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileList' });
      } catch (error) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to load profile: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, appDispatch, runtime],
  );

  // Delete profile
  const deleteProfile = useCallback(
    async (profileName: string) => {
      try {
        await runtime.deleteProfileByName(profileName);
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' deleted`,
          timestamp: new Date(),
        });
        // Close detail dialog and refresh list
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileDetail' });
        appDispatch({ type: 'OPEN_DIALOG', payload: 'profileList' });
        await loadProfiles();
      } catch (error) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to delete profile: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, appDispatch, runtime, loadProfiles],
  );

  // Set default profile
  const setDefault = useCallback(
    async (profileName: string) => {
      try {
        runtime.setDefaultProfileName(profileName);
        setDefaultProfileName(profileName);
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' set as default`,
          timestamp: new Date(),
        });
      } catch (error) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to set default: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, runtime],
  );

  // Open editor
  // openedDirectly: true when opened via /profile edit, false when from detail
  const openEditor = useCallback(
    async (profileName: string, openedDirectly = false) => {
      setSelectedProfileName(profileName);
      setEditorOpenedDirectly(openedDirectly);
      setProfileError(null);

      // If opened directly, need to load profile data first
      if (openedDirectly) {
        setIsLoading(true);
        try {
          const profile = await runtime.getProfileByName(profileName);
          setSelectedProfile(profile);
        } catch (error) {
          setProfileError(
            error instanceof Error ? error.message : 'Failed to load profile',
          );
        } finally {
          setIsLoading(false);
        }
      }

      appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileDetail' });
      appDispatch({ type: 'OPEN_DIALOG', payload: 'profileEditor' });
    },
    [appDispatch, runtime],
  );

  // Close editor
  const closeEditor = useCallback(async () => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileEditor' });

    // If opened directly via /profile edit, just close
    // If opened from detail, go back to detail (preserving detailOpenedDirectly)
    if (!editorOpenedDirectly && selectedProfileName) {
      // Preserve the original detailOpenedDirectly state when going back
      await viewProfileDetail(selectedProfileName, detailOpenedDirectly);
    } else {
      setSelectedProfileName(null);
      setSelectedProfile(null);
      setProfileError(null);
    }
    setEditorOpenedDirectly(false);
  }, [
    appDispatch,
    selectedProfileName,
    viewProfileDetail,
    editorOpenedDirectly,
    detailOpenedDirectly,
  ]);

  // Save edited profile
  const saveProfile = useCallback(
    async (profileName: string, updatedProfile: unknown) => {
      try {
        // Comprehensive validation before save
        const validationError = validateProfileForSave(updatedProfile);
        if (validationError) {
          setProfileError(validationError);
          return;
        }

        // Use ProfileManager directly to save
        const manager = new ProfileManager();
        await manager.saveProfile(profileName, updatedProfile as Profile);
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' saved`,
          timestamp: new Date(),
        });
        // Close editor and reopen detail
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'profileEditor' });
        await viewProfileDetail(profileName, editorOpenedDirectly);
      } catch (error) {
        setProfileError(
          error instanceof Error ? error.message : 'Failed to save profile',
        );
      }
    },
    [addMessage, appDispatch, viewProfileDetail, editorOpenedDirectly],
  );

  return {
    // Dialog states
    showListDialog,
    showDetailDialog,
    showEditorDialog,

    // Data
    profiles,
    isLoading,
    selectedProfileName,
    selectedProfile,
    defaultProfileName,
    activeProfileName,
    profileError,

    // List dialog actions
    openListDialog,
    closeListDialog,

    // Detail dialog actions
    viewProfileDetail,
    closeDetailDialog,
    loadProfile,
    deleteProfile,
    setDefault,

    // Editor actions
    openEditor,
    closeEditor,
    saveProfile,
  };
};
