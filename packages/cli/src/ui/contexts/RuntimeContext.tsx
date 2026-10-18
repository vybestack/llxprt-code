/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createContext, useContext } from 'react';
import type {
  Agent,
  AgentProfileDefinitions,
  SessionProviderReads,
  createProviderInspection,
} from '@vybestack/llxprt-code-agents';
import type {
  NetworkFetch,
  ModelChangeResult,
  ApiKeyUpdateResult,
  BaseUrlUpdateResult,
} from '@vybestack/llxprt-code-core';

export type GetActiveProviderDetailsOperation = ReturnType<
  typeof createProviderInspection
>['getActiveProviderDetails'];
const GetActiveProviderDetailsContext =
  createContext<GetActiveProviderDetailsOperation | null>(null);
export const GetActiveProviderDetailsProvider =
  GetActiveProviderDetailsContext.Provider;
export function useGetActiveProviderDetails(): GetActiveProviderDetailsOperation {
  const operation = useContext(GetActiveProviderDetailsContext);
  if (operation === null)
    throw new Error(
      'GetActiveProviderDetailsProvider is missing from the component tree.',
    );
  return operation;
}

export type GetProviderDumpMetadataOperation = ReturnType<
  typeof createProviderInspection
>['getProviderDumpMetadata'];
const GetProviderDumpMetadataContext =
  createContext<GetProviderDumpMetadataOperation | null>(null);
export const GetProviderDumpMetadataProvider =
  GetProviderDumpMetadataContext.Provider;
export function useGetProviderDumpMetadata(): GetProviderDumpMetadataOperation {
  const operation = useContext(GetProviderDumpMetadataContext);
  if (operation === null)
    throw new Error(
      'GetProviderDumpMetadataProvider is missing from the component tree.',
    );
  return operation;
}

export type GetActiveProviderAliasConfigOperation = ReturnType<
  typeof createProviderInspection
>['getActiveProviderAliasConfig'];
const GetActiveProviderAliasConfigContext =
  createContext<GetActiveProviderAliasConfigOperation | null>(null);
export const GetActiveProviderAliasConfigProvider =
  GetActiveProviderAliasConfigContext.Provider;
export function useGetActiveProviderAliasConfig(): GetActiveProviderAliasConfigOperation {
  const operation = useContext(GetActiveProviderAliasConfigContext);
  if (operation === null)
    throw new Error(
      'GetActiveProviderAliasConfigProvider is missing from the component tree.',
    );
  return operation;
}

export type DetectProviderQuotaOperation = ReturnType<
  typeof createProviderInspection
>['detectProviderQuota'];
const DetectProviderQuotaContext =
  createContext<DetectProviderQuotaOperation | null>(null);
export const DetectProviderQuotaProvider = DetectProviderQuotaContext.Provider;
export function useDetectProviderQuota(): DetectProviderQuotaOperation {
  const operation = useContext(DetectProviderQuotaContext);
  if (operation === null)
    throw new Error(
      'DetectProviderQuotaProvider is missing from the component tree.',
    );
  return operation;
}

export type GetLoadBalancerStatsOperation = ReturnType<
  typeof createProviderInspection
>['getLoadBalancerStats'];
const GetLoadBalancerStatsContext =
  createContext<GetLoadBalancerStatsOperation | null>(null);
export const GetLoadBalancerStatsProvider =
  GetLoadBalancerStatsContext.Provider;
export function useGetLoadBalancerStats(): GetLoadBalancerStatsOperation {
  const operation = useContext(GetLoadBalancerStatsContext);
  if (operation === null)
    throw new Error(
      'GetLoadBalancerStatsProvider is missing from the component tree.',
    );
  return operation;
}

export type GetLoadBalancerTokenAccountingOperation = ReturnType<
  typeof createProviderInspection
>['getLoadBalancerTokenAccounting'];
const GetLoadBalancerTokenAccountingContext =
  createContext<GetLoadBalancerTokenAccountingOperation | null>(null);
export const GetLoadBalancerTokenAccountingProvider =
  GetLoadBalancerTokenAccountingContext.Provider;
export function useGetLoadBalancerTokenAccounting(): GetLoadBalancerTokenAccountingOperation {
  const operation = useContext(GetLoadBalancerTokenAccountingContext);
  if (operation === null)
    throw new Error(
      'GetLoadBalancerTokenAccountingProvider is missing from the component tree.',
    );
  return operation;
}

export type ListSavedProfilesOperation =
  AgentProfileDefinitions['listSavedProfiles'];
const ListSavedProfilesContext =
  createContext<ListSavedProfilesOperation | null>(null);
export const ListSavedProfilesProvider = ListSavedProfilesContext.Provider;
export function useListSavedProfiles(): ListSavedProfilesOperation {
  const operation = useContext(ListSavedProfilesContext);
  if (operation === null)
    throw new Error(
      'ListSavedProfilesProvider is missing from the component tree.',
    );
  return operation;
}

export type GetProfileByNameOperation =
  AgentProfileDefinitions['getProfileByName'];
const GetProfileByNameContext = createContext<GetProfileByNameOperation | null>(
  null,
);
export const GetProfileByNameProvider = GetProfileByNameContext.Provider;
export function useGetProfileByName(): GetProfileByNameOperation {
  const operation = useContext(GetProfileByNameContext);
  if (operation === null)
    throw new Error(
      'GetProfileByNameProvider is missing from the component tree.',
    );
  return operation;
}

export type SaveProfileDefinitionOperation =
  AgentProfileDefinitions['saveProfileDefinition'];
const SaveProfileDefinitionContext =
  createContext<SaveProfileDefinitionOperation | null>(null);
export const SaveProfileDefinitionProvider =
  SaveProfileDefinitionContext.Provider;
export function useSaveProfileDefinition(): SaveProfileDefinitionOperation {
  const operation = useContext(SaveProfileDefinitionContext);
  if (operation === null)
    throw new Error(
      'SaveProfileDefinitionProvider is missing from the component tree.',
    );
  return operation;
}

export type SaveLoadBalancerProfileOperation =
  AgentProfileDefinitions['saveLoadBalancerProfile'];
const SaveLoadBalancerProfileContext =
  createContext<SaveLoadBalancerProfileOperation | null>(null);
export const SaveLoadBalancerProfileProvider =
  SaveLoadBalancerProfileContext.Provider;
export function useSaveLoadBalancerProfile(): SaveLoadBalancerProfileOperation {
  const operation = useContext(SaveLoadBalancerProfileContext);
  if (operation === null)
    throw new Error(
      'SaveLoadBalancerProfileProvider is missing from the component tree.',
    );
  return operation;
}

export type ListProvidersOperation = SessionProviderReads['listProviders'];
const ListProvidersContext = createContext<ListProvidersOperation | null>(null);
export const ListProvidersProvider = ListProvidersContext.Provider;
export function useListProviders(): ListProvidersOperation {
  const operation = useContext(ListProvidersContext);
  if (operation === null)
    throw new Error(
      'ListProvidersProvider is missing from the component tree.',
    );
  return operation;
}

export type GetActiveProviderNameOperation =
  SessionProviderReads['getActiveProviderName'];
const GetActiveProviderNameContext =
  createContext<GetActiveProviderNameOperation | null>(null);
export type HasActiveProviderOperation = Agent['hasActiveProvider'];
const HasActiveProviderContext =
  createContext<HasActiveProviderOperation | null>(null);
export const GetActiveProviderNameProvider =
  GetActiveProviderNameContext.Provider;
export function useGetActiveProviderName(): GetActiveProviderNameOperation {
  const operation = useContext(GetActiveProviderNameContext);
  if (operation === null)
    throw new Error(
      'GetActiveProviderNameProvider is missing from the component tree.',
    );
  return operation;
}
export const HasActiveProviderProvider = HasActiveProviderContext.Provider;
export function useHasActiveProvider(): HasActiveProviderOperation {
  const operation = useContext(HasActiveProviderContext);
  if (operation === null)
    throw new Error(
      'HasActiveProviderProvider is missing from the component tree.',
    );
  return operation;
}

export type ListAvailableModelsOperation =
  SessionProviderReads['listAvailableModels'];
const ListAvailableModelsContext =
  createContext<ListAvailableModelsOperation | null>(null);
export const ListAvailableModelsProvider = ListAvailableModelsContext.Provider;
export function useListAvailableModels(): ListAvailableModelsOperation {
  const operation = useContext(ListAvailableModelsContext);
  if (operation === null)
    throw new Error(
      'ListAvailableModelsProvider is missing from the component tree.',
    );
  return operation;
}

export type GetActiveModelNameOperation =
  SessionProviderReads['getActiveModelName'];
const GetActiveModelNameContext =
  createContext<GetActiveModelNameOperation | null>(null);
export const GetActiveModelNameProvider = GetActiveModelNameContext.Provider;
export function useGetActiveModelName(): GetActiveModelNameOperation {
  const operation = useContext(GetActiveModelNameContext);
  if (operation === null)
    throw new Error(
      'GetActiveModelNameProvider is missing from the component tree.',
    );
  return operation;
}

export type ProviderStatusOperation = SessionProviderReads['providerStatus'];
const ProviderStatusContext = createContext<ProviderStatusOperation | null>(
  null,
);
export const ProviderStatusProvider = ProviderStatusContext.Provider;
export function useProviderStatus(): ProviderStatusOperation {
  const operation = useContext(ProviderStatusContext);
  if (operation === null)
    throw new Error(
      'ProviderStatusProvider is missing from the component tree.',
    );
  return operation;
}

export type GetUnallowedParametersForActiveModelOperation =
  SessionProviderReads['getUnallowedParametersForActiveModel'];
const GetUnallowedParametersForActiveModelContext =
  createContext<GetUnallowedParametersForActiveModelOperation | null>(null);
export const GetUnallowedParametersForActiveModelProvider =
  GetUnallowedParametersForActiveModelContext.Provider;
export function useGetUnallowedParametersForActiveModel(): GetUnallowedParametersForActiveModelOperation {
  const operation = useContext(GetUnallowedParametersForActiveModelContext);
  if (operation === null)
    throw new Error(
      'GetUnallowedParametersForActiveModelProvider is missing from the component tree.',
    );
  return operation;
}

export type GetActiveProviderMetricsOperation =
  SessionProviderReads['getActiveProviderMetrics'];
const GetActiveProviderMetricsContext =
  createContext<GetActiveProviderMetricsOperation | null>(null);
export const GetActiveProviderMetricsProvider =
  GetActiveProviderMetricsContext.Provider;
export function useGetActiveProviderMetrics(): GetActiveProviderMetricsOperation {
  const operation = useContext(GetActiveProviderMetricsContext);
  if (operation === null)
    throw new Error(
      'GetActiveProviderMetricsProvider is missing from the component tree.',
    );
  return operation;
}

export type GetSessionTokenUsageOperation =
  SessionProviderReads['getSessionTokenUsage'];
const GetSessionTokenUsageContext =
  createContext<GetSessionTokenUsageOperation | null>(null);
export const GetSessionTokenUsageProvider =
  GetSessionTokenUsageContext.Provider;
export function useGetSessionTokenUsage(): GetSessionTokenUsageOperation {
  const operation = useContext(GetSessionTokenUsageContext);
  if (operation === null)
    throw new Error(
      'GetSessionTokenUsageProvider is missing from the component tree.',
    );
  return operation;
}

export type GetEphemeralSettingsOperation = () => Readonly<
  Record<string, unknown>
>;
const GetEphemeralSettingsContext =
  createContext<GetEphemeralSettingsOperation | null>(null);
export const GetEphemeralSettingsProvider =
  GetEphemeralSettingsContext.Provider;
export function useGetEphemeralSettings(): GetEphemeralSettingsOperation {
  const operation = useContext(GetEphemeralSettingsContext);
  if (operation === null)
    throw new Error(
      'GetEphemeralSettingsProvider is missing from the component tree.',
    );
  return operation;
}

export type SetEphemeralSettingOperation = (
  key: string,
  value: unknown,
) => void;
const SetEphemeralSettingContext =
  createContext<SetEphemeralSettingOperation | null>(null);
export const SetEphemeralSettingProvider = SetEphemeralSettingContext.Provider;
export function useSetEphemeralSetting(): SetEphemeralSettingOperation {
  const operation = useContext(SetEphemeralSettingContext);
  if (operation === null)
    throw new Error(
      'SetEphemeralSettingProvider is missing from the component tree.',
    );
  return operation;
}

export type GetActiveToolFormatStateOperation = () => ReturnType<
  Agent['toolFormat']['getState']
>;
const GetActiveToolFormatStateContext =
  createContext<GetActiveToolFormatStateOperation | null>(null);
export const GetActiveToolFormatStateProvider =
  GetActiveToolFormatStateContext.Provider;
export function useGetActiveToolFormatState(): GetActiveToolFormatStateOperation {
  const operation = useContext(GetActiveToolFormatStateContext);
  if (operation === null)
    throw new Error(
      'GetActiveToolFormatStateProvider is missing from the component tree.',
    );
  return operation;
}

export type SetActiveToolFormatOverrideOperation = (
  format: Parameters<Agent['toolFormat']['setOverride']>[0],
) => ReturnType<Agent['toolFormat']['setOverride']>;
const SetActiveToolFormatOverrideContext =
  createContext<SetActiveToolFormatOverrideOperation | null>(null);
export const SetActiveToolFormatOverrideProvider =
  SetActiveToolFormatOverrideContext.Provider;
export function useSetActiveToolFormatOverride(): SetActiveToolFormatOverrideOperation {
  const operation = useContext(SetActiveToolFormatOverrideContext);
  if (operation === null)
    throw new Error(
      'SetActiveToolFormatOverrideProvider is missing from the component tree.',
    );
  return operation;
}

export type GetEphemeralSettingOperation = (key: string) => unknown;
const GetEphemeralSettingContext =
  createContext<GetEphemeralSettingOperation | null>(null);
export const GetEphemeralSettingProvider = GetEphemeralSettingContext.Provider;
export function useGetEphemeralSetting(): GetEphemeralSettingOperation {
  const operation = useContext(GetEphemeralSettingContext);
  if (operation === null)
    throw new Error(
      'GetEphemeralSettingProvider is missing from the component tree.',
    );
  return operation;
}

export type GetSessionSettingOperation = (key: string) => unknown;
const GetSessionSettingContext =
  createContext<GetSessionSettingOperation | null>(null);
export const GetSessionSettingProvider = GetSessionSettingContext.Provider;
export function useGetSessionSetting(): GetSessionSettingOperation {
  const operation = useContext(GetSessionSettingContext);
  if (operation === null)
    throw new Error(
      'GetSessionSettingProvider is missing from the component tree.',
    );
  return operation;
}

export type SetSessionSettingOperation = (key: string, value: unknown) => void;
const SetSessionSettingContext =
  createContext<SetSessionSettingOperation | null>(null);
export const SetSessionSettingProvider = SetSessionSettingContext.Provider;
export function useSetSessionSetting(): SetSessionSettingOperation {
  const operation = useContext(SetSessionSettingContext);
  if (operation === null)
    throw new Error(
      'SetSessionSettingProvider is missing from the component tree.',
    );
  return operation;
}

export type ClearSessionSettingOperation = (key: string) => void;
const ClearSessionSettingContext =
  createContext<ClearSessionSettingOperation | null>(null);
export const ClearSessionSettingProvider = ClearSessionSettingContext.Provider;
export function useClearSessionSetting(): ClearSessionSettingOperation {
  const operation = useContext(ClearSessionSettingContext);
  if (operation === null)
    throw new Error(
      'ClearSessionSettingProvider is missing from the component tree.',
    );
  return operation;
}

export type SetActiveModelOperation = (
  model: string,
) => Promise<ModelChangeResult>;
const SetActiveModelContext = createContext<SetActiveModelOperation | null>(
  null,
);
export const SetActiveModelProvider = SetActiveModelContext.Provider;
export function useSetActiveModel(): SetActiveModelOperation {
  const operation = useContext(SetActiveModelContext);
  if (operation === null)
    throw new Error(
      'SetActiveModelProvider is missing from the component tree.',
    );
  return operation;
}

export type GetActiveModelParamsOperation =
  SessionProviderReads['getActiveModelParams'];
const GetActiveModelParamsContext =
  createContext<GetActiveModelParamsOperation | null>(null);
export const GetActiveModelParamsProvider =
  GetActiveModelParamsContext.Provider;
export function useGetActiveModelParams(): GetActiveModelParamsOperation {
  const operation = useContext(GetActiveModelParamsContext);
  if (operation === null)
    throw new Error(
      'GetActiveModelParamsProvider is missing from the component tree.',
    );
  return operation;
}

export type SetActiveModelParamOperation = (
  key: string,
  value: unknown,
) => void;
const SetActiveModelParamContext =
  createContext<SetActiveModelParamOperation | null>(null);
export const SetActiveModelParamProvider = SetActiveModelParamContext.Provider;
export function useSetActiveModelParam(): SetActiveModelParamOperation {
  const operation = useContext(SetActiveModelParamContext);
  if (operation === null)
    throw new Error(
      'SetActiveModelParamProvider is missing from the component tree.',
    );
  return operation;
}

export type ClearActiveModelParamOperation = (key: string) => void;
const ClearActiveModelParamContext =
  createContext<ClearActiveModelParamOperation | null>(null);
export const ClearActiveModelParamProvider =
  ClearActiveModelParamContext.Provider;
export function useClearActiveModelParam(): ClearActiveModelParamOperation {
  const operation = useContext(ClearActiveModelParamContext);
  if (operation === null)
    throw new Error(
      'ClearActiveModelParamProvider is missing from the component tree.',
    );
  return operation;
}

export type UpdateActiveProviderApiKeyOperation = (
  key: string | null,
) => Promise<ApiKeyUpdateResult>;
const UpdateActiveProviderApiKeyContext =
  createContext<UpdateActiveProviderApiKeyOperation | null>(null);
export const UpdateActiveProviderApiKeyProvider =
  UpdateActiveProviderApiKeyContext.Provider;
export function useUpdateActiveProviderApiKey(): UpdateActiveProviderApiKeyOperation {
  const operation = useContext(UpdateActiveProviderApiKeyContext);
  if (operation === null)
    throw new Error(
      'UpdateActiveProviderApiKeyProvider is missing from the component tree.',
    );
  return operation;
}

export type GetWorkspaceDirectoriesOperation = () => readonly string[];
const GetWorkspaceDirectoriesContext =
  createContext<GetWorkspaceDirectoriesOperation | null>(null);
export const GetWorkspaceDirectoriesProvider =
  GetWorkspaceDirectoriesContext.Provider;
export function useGetWorkspaceDirectories(): GetWorkspaceDirectoriesOperation {
  const operation = useContext(GetWorkspaceDirectoriesContext);
  if (operation === null)
    throw new Error(
      'GetWorkspaceDirectoriesProvider is missing from the component tree.',
    );
  return operation;
}

export type GetDefaultProfileNameOperation = () => string | null;
const GetDefaultProfileNameContext =
  createContext<GetDefaultProfileNameOperation | null>(null);
export const GetDefaultProfileNameProvider =
  GetDefaultProfileNameContext.Provider;
export function useGetDefaultProfileName(): GetDefaultProfileNameOperation {
  const operation = useContext(GetDefaultProfileNameContext);
  if (operation === null)
    throw new Error(
      'GetDefaultProfileNameProvider is missing from the component tree.',
    );
  return operation;
}

export type GetOpenAIProviderInfoOperation = () => ReturnType<
  SessionProviderReads['readOpenAIInfo']
>;
const GetOpenAIProviderInfoContext =
  createContext<GetOpenAIProviderInfoOperation | null>(null);
export const GetOpenAIProviderInfoProvider =
  GetOpenAIProviderInfoContext.Provider;
export function useGetOpenAIProviderInfo(): GetOpenAIProviderInfoOperation {
  const operation = useContext(GetOpenAIProviderInfoContext);
  if (operation === null)
    throw new Error(
      'GetOpenAIProviderInfoProvider is missing from the component tree.',
    );
  return operation;
}

export type GetActiveProfileNameOperation = Agent['getActiveProfileName'];
const GetActiveProfileNameContext =
  createContext<GetActiveProfileNameOperation | null>(null);
export const GetActiveProfileNameProvider =
  GetActiveProfileNameContext.Provider;
export function useGetActiveProfileName(): GetActiveProfileNameOperation {
  const operation = useContext(GetActiveProfileNameContext);
  if (operation === null)
    throw new Error(
      'GetActiveProfileNameProvider is missing from the component tree.',
    );
  return operation;
}

export type SetDefaultProfileNameOperation = Agent['setDefaultProfileName'];
const SetDefaultProfileNameContext =
  createContext<SetDefaultProfileNameOperation | null>(null);
export const SetDefaultProfileNameProvider =
  SetDefaultProfileNameContext.Provider;
export function useSetDefaultProfileName(): SetDefaultProfileNameOperation {
  const operation = useContext(SetDefaultProfileNameContext);
  if (operation === null)
    throw new Error(
      'SetDefaultProfileNameProvider is missing from the component tree.',
    );
  return operation;
}

export type GetRuntimeDiagnosticsSnapshotOperation =
  Agent['getRuntimeDiagnosticsSnapshot'];
const GetRuntimeDiagnosticsSnapshotContext =
  createContext<GetRuntimeDiagnosticsSnapshotOperation | null>(null);
export const GetRuntimeDiagnosticsSnapshotProvider =
  GetRuntimeDiagnosticsSnapshotContext.Provider;
export function useGetRuntimeDiagnosticsSnapshot(): GetRuntimeDiagnosticsSnapshotOperation {
  const operation = useContext(GetRuntimeDiagnosticsSnapshotContext);
  if (operation === null)
    throw new Error(
      'GetRuntimeDiagnosticsSnapshotProvider is missing from the component tree.',
    );
  return operation;
}

export type SaveProfileSnapshotOperation = Agent['saveProfileSnapshot'];
const SaveProfileSnapshotContext =
  createContext<SaveProfileSnapshotOperation | null>(null);
export const SaveProfileSnapshotProvider = SaveProfileSnapshotContext.Provider;
export function useSaveProfileSnapshot(): SaveProfileSnapshotOperation {
  const operation = useContext(SaveProfileSnapshotContext);
  if (operation === null)
    throw new Error(
      'SaveProfileSnapshotProvider is missing from the component tree.',
    );
  return operation;
}

export type DeleteProfileByNameOperation = Agent['deleteProfileByName'];
const DeleteProfileByNameContext =
  createContext<DeleteProfileByNameOperation | null>(null);
export const DeleteProfileByNameProvider = DeleteProfileByNameContext.Provider;
export function useDeleteProfileByName(): DeleteProfileByNameOperation {
  const operation = useContext(DeleteProfileByNameContext);
  if (operation === null)
    throw new Error(
      'DeleteProfileByNameProvider is missing from the component tree.',
    );
  return operation;
}

export type FetchOperation = NetworkFetch;
const FetchContext = createContext<FetchOperation | null>(null);
export const FetchProvider = FetchContext.Provider;
export function useFetch(): FetchOperation {
  const operation = useContext(FetchContext);
  if (operation === null)
    throw new Error('FetchProvider is missing from the component tree.');
  return operation;
}

export type SetProviderOperation = Agent['setProvider'];
const SetProviderContext = createContext<SetProviderOperation | null>(null);
export const SetProviderProvider = SetProviderContext.Provider;
export function useSetProvider(): SetProviderOperation {
  const operation = useContext(SetProviderContext);
  if (operation === null)
    throw new Error('SetProviderProvider is missing from the component tree.');
  return operation;
}

export type LoadProfileByNameOperation = (
  name: string,
) => ReturnType<Agent['profiles']['load']>;
const LoadProfileByNameContext =
  createContext<LoadProfileByNameOperation | null>(null);
export const LoadProfileByNameProvider = LoadProfileByNameContext.Provider;
export function useLoadProfileByName(): LoadProfileByNameOperation {
  const operation = useContext(LoadProfileByNameContext);
  if (operation === null)
    throw new Error(
      'LoadProfileByNameProvider is missing from the component tree.',
    );
  return operation;
}

export type UpdateActiveProviderBaseUrlOperation = (
  url: string | null,
) => Promise<BaseUrlUpdateResult>;
const UpdateActiveProviderBaseUrlContext =
  createContext<UpdateActiveProviderBaseUrlOperation | null>(null);
export const UpdateActiveProviderBaseUrlProvider =
  UpdateActiveProviderBaseUrlContext.Provider;
export function useUpdateActiveProviderBaseUrl(): UpdateActiveProviderBaseUrlOperation {
  const operation = useContext(UpdateActiveProviderBaseUrlContext);
  if (operation === null)
    throw new Error(
      'UpdateActiveProviderBaseUrlProvider is missing from the component tree.',
    );
  return operation;
}
