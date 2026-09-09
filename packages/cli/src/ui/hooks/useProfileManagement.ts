/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { MessageType } from '../types.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { ProfileListItem } from '../components/ProfileListDialog.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { DialogStore } from '../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';

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

interface AddMessageFn {
  (msg: { type: MessageType; content: string; timestamp: Date }): void;
}

interface UseProfileManagementParams {
  addMessage: AddMessageFn;
  store: DialogStore;
  dialogs: DialogOpeners;
}

function useProfileDialogStates(store: DialogStore) {
  const showListDialog = useStoreSelector(store.store, (state) =>
    state.requests.some((r) => r.kind === 'profileList'),
  );
  const showDetailDialog = useStoreSelector(store.store, (state) =>
    state.requests.some((r) => r.kind === 'profileDetail'),
  );
  const showEditorDialog = useStoreSelector(store.store, (state) =>
    state.requests.some((r) => r.kind === 'profileEditor'),
  );
  return {
    showListDialog,
    showDetailDialog,
    showEditorDialog,
  };
}

function useProfileDataStates() {
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
  const [detailOpenedDirectly, setDetailOpenedDirectly] = useState(false);
  const [editorOpenedDirectly, setEditorOpenedDirectly] = useState(false);

  return {
    profiles,
    setProfiles,
    isLoading,
    setIsLoading,
    selectedProfileName,
    setSelectedProfileName,
    selectedProfile,
    setSelectedProfile,
    defaultProfileName,
    setDefaultProfileName,
    activeProfileName,
    setActiveProfileName,
    profileError,
    setProfileError,
    detailOpenedDirectly,
    setDetailOpenedDirectly,
    editorOpenedDirectly,
    setEditorOpenedDirectly,
  };
}

async function fetchProfileItems(
  runtime: ReturnType<typeof useRuntimeApi>,
  profileNames: string[],
): Promise<ProfileListItem[]> {
  return Promise.all(
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
        return {
          name,
          type: 'standard',
          loadError: true,
        } as ProfileListItem;
      }
    }),
  );
}

function useProfileLoader(
  runtime: ReturnType<typeof useRuntimeApi>,
  addMessage: AddMessageFn,
  setProfiles: React.Dispatch<React.SetStateAction<ProfileListItem[]>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setProfileError: React.Dispatch<React.SetStateAction<string | null>>,
  setDefaultProfileName: React.Dispatch<React.SetStateAction<string | null>>,
  setActiveProfileName: React.Dispatch<React.SetStateAction<string | null>>,
) {
  return useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading !== false;
      if (showLoading) {
        setIsLoading(true);
      }
      setProfileError(null);

      try {
        const profileNames = await runtime.listSavedProfiles();
        const profileItems = await fetchProfileItems(runtime, profileNames);
        setProfiles(profileItems);

        try {
          const services = runtime.getCliRuntimeServices();
          const defaultName = services.settingsService.get('defaultProfile') as
            | string
            | null;
          setDefaultProfileName(defaultName ?? null);
        } catch {
          // Ignore errors getting default profile
        }

        try {
          const diagnostics = runtime.getRuntimeDiagnosticsSnapshot();
          setActiveProfileName(diagnostics.profileName);
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
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [
      runtime,
      addMessage,
      setProfiles,
      setIsLoading,
      setProfileError,
      setDefaultProfileName,
      setActiveProfileName,
    ],
  );
}

function useListDialogActions(
  dialogs: DialogOpeners,
  loadProfiles: () => Promise<void>,
) {
  const openListDialog = useCallback(async () => {
    debug.log(() => 'openListDialog called');
    dialogs.profileList.open({});
    debug.log(() => 'opened profileList dialog');
    await loadProfiles();
    debug.log(() => 'loadProfiles completed');
  }, [dialogs, loadProfiles]);

  const closeListDialog = useCallback(() => {
    dialogs.profileList.close();
  }, [dialogs]);

  return { openListDialog, closeListDialog };
}

function useDetailDialogActions(
  dialogs: DialogOpeners,
  runtime: ReturnType<typeof useRuntimeApi>,
  setSelectedProfileName: React.Dispatch<React.SetStateAction<string | null>>,
  setSelectedProfile: React.Dispatch<React.SetStateAction<Profile | null>>,
  setProfileError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setDetailOpenedDirectly: React.Dispatch<React.SetStateAction<boolean>>,
  detailOpenedDirectly: boolean,
  loadProfiles: () => Promise<void>,
) {
  const viewProfileDetail = useCallback(
    async (profileName: string, openedDirectly = false) => {
      setSelectedProfileName(profileName);
      setSelectedProfile(null);
      setProfileError(null);
      setIsLoading(true);
      setDetailOpenedDirectly(openedDirectly);

      dialogs.profileList.close();
      dialogs.profileDetail.open({ profileName });

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
    [
      dialogs,
      runtime,
      setSelectedProfileName,
      setSelectedProfile,
      setProfileError,
      setIsLoading,
      setDetailOpenedDirectly,
    ],
  );

  const closeDetailDialog = useCallback(async () => {
    dialogs.profileDetail.close();
    setSelectedProfileName(null);
    setSelectedProfile(null);
    setProfileError(null);

    if (detailOpenedDirectly === false) {
      dialogs.profileList.open({});
      await loadProfiles();
    }
    setDetailOpenedDirectly(false);
  }, [
    dialogs,
    loadProfiles,
    detailOpenedDirectly,
    setSelectedProfileName,
    setSelectedProfile,
    setProfileError,
    setDetailOpenedDirectly,
  ]);

  return { viewProfileDetail, closeDetailDialog };
}

function useLoadProfileAction(
  addMessage: AddMessageFn,
  dialogs: DialogOpeners,
  runtime: ReturnType<typeof useRuntimeApi>,
  setActiveProfileName: React.Dispatch<React.SetStateAction<string | null>>,
) {
  return useCallback(
    async (profileName: string) => {
      try {
        const result = await runtime.loadProfileByName(profileName);
        const extra = result.infoMessages
          .map((message: string) => `\n- ${message}`)
          .join('');
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' loaded${extra}`,
          timestamp: new Date(),
        });
        for (const warning of result.warnings) {
          addMessage({
            type: MessageType.INFO,
            content: `\u26A0 ${warning}`,
            timestamp: new Date(),
          });
        }
        setActiveProfileName(profileName);
        dialogs.profileDetail.close();
        dialogs.profileList.close();
      } catch (error) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to load profile: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, dialogs, runtime, setActiveProfileName],
  );
}

function useDeleteProfileAction(
  addMessage: AddMessageFn,
  dialogs: DialogOpeners | null,
  runtime: ReturnType<typeof useRuntimeApi>,
  loadProfiles: (options?: { showLoading?: boolean }) => Promise<void>,
  options?: { fromList?: boolean },
) {
  const fromList = options?.fromList === true;
  return useCallback(
    async (profileName: string) => {
      try {
        await runtime.deleteProfileByName(profileName);
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' deleted`,
          timestamp: new Date(),
        });
        if (!fromList && dialogs !== null) {
          dialogs.profileDetail.close();
          dialogs.profileList.open({});
          await loadProfiles();
        } else {
          // Refresh in place without the loading flash so selection can clamp.
          await loadProfiles({ showLoading: false });
        }
      } catch (error) {
        addMessage({
          type: MessageType.ERROR,
          content: `Failed to delete profile: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        });
      }
    },
    [addMessage, dialogs, runtime, loadProfiles, fromList],
  );
}

function useSetDefaultAction(
  addMessage: AddMessageFn,
  runtime: ReturnType<typeof useRuntimeApi>,
  setDefaultProfileName: React.Dispatch<React.SetStateAction<string | null>>,
) {
  return useCallback(
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
    [addMessage, runtime, setDefaultProfileName],
  );
}

function useOpenEditorAction(
  dialogs: DialogOpeners,
  runtime: ReturnType<typeof useRuntimeApi>,
  setSelectedProfileName: React.Dispatch<React.SetStateAction<string | null>>,
  setSelectedProfile: React.Dispatch<React.SetStateAction<Profile | null>>,
  setProfileError: React.Dispatch<React.SetStateAction<string | null>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setEditorOpenedDirectly: React.Dispatch<React.SetStateAction<boolean>>,
) {
  return useCallback(
    async (profileName: string, openedDirectly = false) => {
      setSelectedProfileName(profileName);
      setEditorOpenedDirectly(openedDirectly);
      setProfileError(null);

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

      dialogs.profileDetail.close();
      dialogs.profileEditor.open({ profileName });
    },
    [
      dialogs,
      runtime,
      setSelectedProfileName,
      setEditorOpenedDirectly,
      setProfileError,
      setIsLoading,
      setSelectedProfile,
    ],
  );
}

function useCloseEditorAction(
  dialogs: DialogOpeners,
  editorOpenedDirectly: boolean,
  selectedProfileName: string | null,
  detailOpenedDirectly: boolean,
  viewProfileDetail: (name: string, direct: boolean) => Promise<void>,
  setSelectedProfileName: React.Dispatch<React.SetStateAction<string | null>>,
  setSelectedProfile: React.Dispatch<React.SetStateAction<Profile | null>>,
  setProfileError: React.Dispatch<React.SetStateAction<string | null>>,
  setEditorOpenedDirectly: React.Dispatch<React.SetStateAction<boolean>>,
) {
  return useCallback(async () => {
    dialogs.profileEditor.close();

    if (editorOpenedDirectly === false && selectedProfileName) {
      await viewProfileDetail(selectedProfileName, detailOpenedDirectly);
    } else {
      setSelectedProfileName(null);
      setSelectedProfile(null);
      setProfileError(null);
    }
    setEditorOpenedDirectly(false);
  }, [
    dialogs,
    selectedProfileName,
    viewProfileDetail,
    editorOpenedDirectly,
    detailOpenedDirectly,
    setSelectedProfileName,
    setSelectedProfile,
    setProfileError,
    setEditorOpenedDirectly,
  ]);
}

function useSaveProfileAction(
  addMessage: AddMessageFn,
  dialogs: DialogOpeners,
  editorOpenedDirectly: boolean,
  viewProfileDetail: (name: string, direct: boolean) => Promise<void>,
  setProfileError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  return useCallback(
    async (profileName: string, updatedProfile: unknown) => {
      try {
        const validationError = validateProfileForSave(updatedProfile);
        if (validationError) {
          setProfileError(validationError);
          return;
        }

        const manager = new ProfileManager();
        await manager.saveProfile(profileName, updatedProfile as Profile);
        addMessage({
          type: MessageType.INFO,
          content: `Profile '${profileName}' saved`,
          timestamp: new Date(),
        });
        dialogs.profileEditor.close();
        await viewProfileDetail(profileName, editorOpenedDirectly);
      } catch (error) {
        setProfileError(
          error instanceof Error ? error.message : 'Failed to save profile',
        );
      }
    },
    [
      addMessage,
      dialogs,
      viewProfileDetail,
      editorOpenedDirectly,
      setProfileError,
    ],
  );
}

function useProfileDispatchActions(
  addMessage: AddMessageFn,
  dialogs: DialogOpeners,
  runtime: ReturnType<typeof useRuntimeApi>,
  loadProfiles: (options?: { showLoading?: boolean }) => Promise<void>,
  dataStates: ReturnType<typeof useProfileDataStates>,
  viewProfileDetail: (name: string, direct: boolean) => Promise<void>,
) {
  const loadProfile = useLoadProfileAction(
    addMessage,
    dialogs,
    runtime,
    dataStates.setActiveProfileName,
  );
  const deleteProfile = useDeleteProfileAction(
    addMessage,
    dialogs,
    runtime,
    loadProfiles,
  );
  const deleteProfileFromList = useDeleteProfileAction(
    addMessage,
    null,
    runtime,
    loadProfiles,
    { fromList: true },
  );
  const setDefault = useSetDefaultAction(
    addMessage,
    runtime,
    dataStates.setDefaultProfileName,
  );
  const openEditor = useOpenEditorAction(
    dialogs,
    runtime,
    dataStates.setSelectedProfileName,
    dataStates.setSelectedProfile,
    dataStates.setProfileError,
    dataStates.setIsLoading,
    dataStates.setEditorOpenedDirectly,
  );
  const closeEditor = useCloseEditorAction(
    dialogs,
    dataStates.editorOpenedDirectly,
    dataStates.selectedProfileName,
    dataStates.detailOpenedDirectly,
    viewProfileDetail,
    dataStates.setSelectedProfileName,
    dataStates.setSelectedProfile,
    dataStates.setProfileError,
    dataStates.setEditorOpenedDirectly,
  );
  const saveProfile = useSaveProfileAction(
    addMessage,
    dialogs,
    dataStates.editorOpenedDirectly,
    viewProfileDetail,
    dataStates.setProfileError,
  );
  return {
    loadProfile,
    deleteProfile,
    deleteProfileFromList,
    setDefault,
    openEditor,
    closeEditor,
    saveProfile,
  };
}

function buildProfileManagementResult<TActions extends object>(
  dialogStates: ReturnType<typeof useProfileDialogStates>,
  dataStates: ReturnType<typeof useProfileDataStates>,
  actions: TActions,
) {
  return {
    ...dialogStates,
    profiles: dataStates.profiles,
    isLoading: dataStates.isLoading,
    selectedProfileName: dataStates.selectedProfileName,
    selectedProfile: dataStates.selectedProfile,
    defaultProfileName: dataStates.defaultProfileName,
    activeProfileName: dataStates.activeProfileName,
    profileError: dataStates.profileError,
    ...actions,
  };
}

export const useProfileManagement = ({
  addMessage,
  store,
  dialogs,
}: UseProfileManagementParams) => {
  const runtime = useRuntimeApi();

  const dialogStates = useProfileDialogStates(store);
  const dataStates = useProfileDataStates();
  const { setActiveProfileName } = dataStates;

  useEffect(() => {
    try {
      const diagnostics = runtime.getRuntimeDiagnosticsSnapshot();
      const current = diagnostics.profileName;
      if (current) {
        setActiveProfileName(current);
      }
    } catch {
      // Ignore errors getting active profile on mount
    }
  }, [runtime, setActiveProfileName]);

  const loadProfiles = useProfileLoader(
    runtime,
    addMessage,
    dataStates.setProfiles,
    dataStates.setIsLoading,
    dataStates.setProfileError,
    dataStates.setDefaultProfileName,
    dataStates.setActiveProfileName,
  );
  const { openListDialog, closeListDialog } = useListDialogActions(
    dialogs,
    loadProfiles,
  );
  const { viewProfileDetail, closeDetailDialog } = useDetailDialogActions(
    dialogs,
    runtime,
    dataStates.setSelectedProfileName,
    dataStates.setSelectedProfile,
    dataStates.setProfileError,
    dataStates.setIsLoading,
    dataStates.setDetailOpenedDirectly,
    dataStates.detailOpenedDirectly,
    loadProfiles,
  );
  const dispatchActions = useProfileDispatchActions(
    addMessage,
    dialogs,
    runtime,
    loadProfiles,
    dataStates,
    viewProfileDetail,
  );

  return buildProfileManagementResult(dialogStates, dataStates, {
    openListDialog,
    closeListDialog,
    viewProfileDetail,
    closeDetailDialog,
    ...dispatchActions,
  });
};
