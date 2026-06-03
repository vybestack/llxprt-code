/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import type { Profile } from '@vybestack/llxprt-code-core';

interface ProfileDetailDialogProps {
  profileName: string;
  profile: Profile | null;
  onClose: () => void;
  onLoad: (profileName: string) => void;
  onDelete: (profileName: string) => void;
  onSetDefault: (profileName: string) => void;
  onEdit: (profileName: string) => void;
  isLoading?: boolean;
  isDefault?: boolean;
  isActive?: boolean;
  error?: string;
}

/**
 * Allowlist of ephemeralSettings keys that are safe to display.
 * Any key NOT in this set will be hidden to prevent accidental secret leakage.
 */
const SAFE_EPHEMERAL_KEYS = new Set([
  'baseurl',
  'endpoint',
  'url',
  'timeout',
  'maxretries',
  'retries',
  'region',
  'debug',
  'loglevel',
  'version',
  'apiversion',
  'organization',
  'orgid',
  'project',
  'projectid',
  'maxtokens',
  'temperature',
  'topp',
  'topk',
  'stream',
  'safetysettings',
]);

// Type guard for load balancer profile
function isLoadBalancerProfile(profile: Profile): profile is Profile & {
  type: 'loadbalancer';
  profiles: string[];
  policy: string;
} {
  const p = profile as unknown as Record<string, unknown>;
  return (
    profile.type === 'loadbalancer' &&
    Array.isArray(p.profiles) &&
    typeof p.policy === 'string'
  );
}

function asRenderableRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function handleDetailKeypress(
  key: { name?: string; sequence?: string },
  confirmDelete: boolean,
  profileName: string,
  error: string | undefined,
  profile: Profile | null,
  setConfirmDelete: React.Dispatch<React.SetStateAction<boolean>>,
  onClose: () => void,
  onDelete: (name: string) => void,
  onLoad: (name: string) => void,
  onEdit: (name: string) => void,
  onSetDefault: (name: string) => void,
): void {
  if (key.name === 'escape') {
    if (confirmDelete) {
      setConfirmDelete(false);
    } else {
      onClose();
    }
    return;
  }

  if (error || !profile) {
    return;
  }

  if (confirmDelete) {
    if (key.sequence === 'y' || key.sequence === 'Y') {
      onDelete(profileName);
    } else if (key.sequence === 'n' || key.sequence === 'N') {
      setConfirmDelete(false);
    }
    return;
  }

  if (key.sequence === 'l') {
    onLoad(profileName);
    return;
  }
  if (key.sequence === 'e') {
    onEdit(profileName);
    return;
  }
  if (key.sequence === 'd') {
    setConfirmDelete(true);
  }
  if (key.sequence === 's') {
    onSetDefault(profileName);
  }
}

const LoadBalancerConfig: React.FC<{
  profile: Profile & {
    type: 'loadbalancer';
    profiles: string[];
    policy: string;
  };
}> = ({ profile }) => (
  <Box flexDirection="column">
    <Box marginBottom={1}>
      <Text color={SemanticColors.text.secondary}>Type: </Text>
      <Text color={SemanticColors.text.accent}>Load Balancer</Text>
    </Box>
    <Box marginBottom={1}>
      <Text color={SemanticColors.text.secondary}>Policy: </Text>
      <Text color={SemanticColors.text.primary}>{profile.policy}</Text>
    </Box>
    <Box flexDirection="column" marginBottom={1}>
      <Text color={SemanticColors.text.secondary}>Member Profiles:</Text>
      {profile.profiles.map((p: string) => (
        <Text key={p} color={SemanticColors.text.primary}>
          {'  '}- {p}
        </Text>
      ))}
    </Box>
  </Box>
);

const ModelParamsSection: React.FC<{
  modelParams: Record<string, unknown>;
}> = ({ modelParams }) => {
  if (Object.keys(modelParams).length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={SemanticColors.text.secondary}>Model Parameters:</Text>
      {Object.entries(modelParams).map(([key, value]) => (
        <Text key={key} color={SemanticColors.text.primary}>
          {'  '}
          {key}: {JSON.stringify(value)}
        </Text>
      ))}
    </Box>
  );
};

const EphemeralSettingsSection: React.FC<{
  ephemeralSettings: Record<string, unknown>;
}> = ({ ephemeralSettings }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={SemanticColors.text.secondary}>Settings:</Text>
    {Object.entries(ephemeralSettings)
      .filter(([key]) => SAFE_EPHEMERAL_KEYS.has(key.toLowerCase()))
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 10)
      .map(([key, value]) => (
        <Text key={key} color={SemanticColors.text.primary}>
          {'  '}
          {key}: {JSON.stringify(value)}
        </Text>
      ))}
  </Box>
);

const AuthConfigSection: React.FC<{
  profile: Profile & { auth?: { type: string; buckets?: string[] } };
}> = ({ profile }) => {
  if (!profile.auth) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={SemanticColors.text.secondary}>Authentication:</Text>
      <Text color={SemanticColors.text.primary}>
        {'  '}Type: {profile.auth.type}
      </Text>
      {profile.auth.buckets != null && profile.auth.buckets.length > 0 && (
        <Text color={SemanticColors.text.primary}>
          {'  '}Buckets: {profile.auth.buckets.join(', ')}
        </Text>
      )}
    </Box>
  );
};

const StandardProfileConfig: React.FC<{ profile: Profile }> = ({ profile }) => {
  const modelParams = asRenderableRecord(
    (profile as { modelParams?: unknown }).modelParams,
  );
  const ephemeralSettings = asRenderableRecord(
    (profile as { ephemeralSettings?: unknown }).ephemeralSettings,
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={SemanticColors.text.secondary}>Type: </Text>
        <Text color={SemanticColors.text.primary}>Standard</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={SemanticColors.text.secondary}>Provider: </Text>
        <Text color={SemanticColors.text.accent}>{profile.provider}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={SemanticColors.text.secondary}>Model: </Text>
        <Text color={SemanticColors.text.primary}>{profile.model}</Text>
      </Box>
      {modelParams !== undefined && (
        <ModelParamsSection modelParams={modelParams} />
      )}
      {ephemeralSettings !== undefined && (
        <EphemeralSettingsSection ephemeralSettings={ephemeralSettings} />
      )}
      <AuthConfigSection profile={profile} />
    </Box>
  );
};

const ProfileConfigDisplay: React.FC<{ profile: Profile }> = ({ profile }) => {
  if (isLoadBalancerProfile(profile)) {
    return <LoadBalancerConfig profile={profile} />;
  }
  return <StandardProfileConfig profile={profile} />;
};

const DeleteConfirmation: React.FC<{
  profileName: string;
  width: number;
}> = ({ profileName, width }) => (
  <Box
    borderStyle="round"
    borderColor={SemanticColors.status.warning}
    flexDirection="column"
    padding={1}
    width={Math.min(width, 60)}
  >
    <Text bold color={SemanticColors.status.warning}>
      Delete Profile?
    </Text>
    <Box marginY={1}>
      <Text color={SemanticColors.text.primary}>
        Are you sure you want to delete &quot;{profileName}&quot;?
      </Text>
    </Box>
    <Text color={SemanticColors.text.secondary}>
      This action cannot be undone.
    </Text>
    <Box marginTop={1}>
      <Text color={SemanticColors.text.accent}>
        Press y to confirm, n or Esc to cancel
      </Text>
    </Box>
  </Box>
);

const ActionsBar: React.FC = () => (
  <Box
    marginTop={1}
    borderStyle="single"
    borderTop
    borderBottom={false}
    borderLeft={false}
    borderRight={false}
    borderColor={SemanticColors.border.default}
    paddingTop={1}
  >
    <Text color={SemanticColors.text.secondary}>
      Actions: <Text color={SemanticColors.text.accent}>l</Text>=load{' '}
      <Text color={SemanticColors.text.accent}>e</Text>=edit{' '}
      <Text color={SemanticColors.text.accent}>d</Text>=delete{' '}
      <Text color={SemanticColors.text.accent}>s</Text>=set-default{' '}
      <Text color={SemanticColors.text.secondary}>Esc</Text>=back
    </Text>
  </Box>
);

const LoadingState: React.FC = () => (
  <Box
    borderStyle="round"
    borderColor={SemanticColors.border.default}
    flexDirection="column"
    padding={1}
  >
    <Text color={SemanticColors.text.primary}>Loading profile...</Text>
  </Box>
);

const ErrorState: React.FC<{ error: string }> = ({ error }) => (
  <Box
    borderStyle="round"
    borderColor={SemanticColors.status.error}
    flexDirection="column"
    padding={1}
  >
    <Text bold color={SemanticColors.status.error}>
      Error Loading Profile
    </Text>
    <Text color={SemanticColors.text.secondary}>{error}</Text>
    <Box marginTop={1}>
      <Text color={SemanticColors.text.secondary}>Press Esc to go back</Text>
    </Box>
  </Box>
);

const NotFoundState: React.FC<{ profileName: string }> = ({ profileName }) => (
  <Box
    borderStyle="round"
    borderColor={SemanticColors.border.default}
    flexDirection="column"
    padding={1}
  >
    <Text color={SemanticColors.text.secondary}>
      Profile not found: {profileName}
    </Text>
    <Text color={SemanticColors.text.secondary}>Press Esc to go back</Text>
  </Box>
);

const ProfileHeader: React.FC<{
  profileName: string;
  isActive: boolean;
  isDefault: boolean;
}> = ({ profileName, isActive, isDefault }) => (
  <Box marginBottom={1}>
    <Text bold color={SemanticColors.text.accent}>
      {profileName}
    </Text>
    {isActive && <Text color={SemanticColors.status.success}> (Active)</Text>}
    {isDefault && <Text color={SemanticColors.text.secondary}> (Default)</Text>}
  </Box>
);

export const ProfileDetailDialog: React.FC<ProfileDetailDialogProps> = ({
  profileName,
  profile,
  onClose,
  onLoad,
  onDelete,
  onSetDefault,
  onEdit,
  isLoading = false,
  isDefault = false,
  isActive = false,
  error,
}) => {
  const { isNarrow, width } = useResponsive();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleKeypress = useCallback(
    (key: Parameters<Parameters<typeof useKeypress>[0]>[0]) => {
      handleDetailKeypress(
        key,
        confirmDelete,
        profileName,
        error,
        profile,
        setConfirmDelete,
        onClose,
        onDelete,
        onLoad,
        onEdit,
        onSetDefault,
      );
    },
    [
      confirmDelete,
      profileName,
      error,
      profile,
      setConfirmDelete,
      onClose,
      onDelete,
      onLoad,
      onEdit,
      onSetDefault,
    ],
  );

  useKeypress(handleKeypress, { isActive: !isLoading });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!profile) return <NotFoundState profileName={profileName} />;
  if (confirmDelete) {
    return <DeleteConfirmation profileName={profileName} width={width} />;
  }

  const dialogWidth = isNarrow ? undefined : Math.min(width, 80);

  return (
    <Box
      borderStyle="round"
      borderColor={SemanticColors.border.default}
      flexDirection="column"
      padding={1}
      width={dialogWidth}
    >
      <ProfileHeader
        profileName={profileName}
        isActive={isActive}
        isDefault={isDefault}
      />
      <ProfileConfigDisplay profile={profile} />
      <ActionsBar />
    </Box>
  );
};
