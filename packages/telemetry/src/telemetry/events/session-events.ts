/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TelemetryConfig } from '../../internal/interfaces.js';

export type { TelemetryConfig as Config };
type Config = TelemetryConfig;

export class StartSessionEvent {
  'event.name': 'cli_config';
  'event.timestamp': string;
  model: string;
  embedding_model: string | undefined;
  sandbox_enabled: boolean;
  core_tools_enabled: string;
  approval_mode: string;
  api_key_enabled: boolean;
  vertex_ai_enabled: boolean;
  debug_enabled: boolean;
  mcp_servers: string;
  telemetry_enabled: boolean;
  telemetry_log_user_prompts_enabled: boolean;
  file_filtering_respect_git_ignore: boolean;

  constructor(config: Config) {
    const generatorConfig = config.getContentGeneratorConfig();
    const mcpServers = config.getMcpServers();

    const useGemini =
      generatorConfig !== undefined &&
      (generatorConfig.apiKey?.length ?? 0) > 0 &&
      generatorConfig.vertexai !== true;
    const useVertex =
      generatorConfig !== undefined && generatorConfig.vertexai === true;

    this['event.name'] = 'cli_config';
    this['event.timestamp'] = new Date().toISOString();
    this.model = config.getModel();
    this.embedding_model = config.getEmbeddingModel();
    const sandboxConfig = config.getSandbox();
    this.sandbox_enabled =
      typeof sandboxConfig === 'string' || Boolean(sandboxConfig);
    this.core_tools_enabled = (config.getCoreTools() ?? []).join(',');
    this.approval_mode = config.getApprovalMode();
    this.api_key_enabled = useGemini || useVertex;
    this.vertex_ai_enabled = useVertex;
    this.debug_enabled = config.getDebugMode();
    this.mcp_servers = mcpServers ? Object.keys(mcpServers).join(',') : '';
    this.telemetry_enabled = config.getTelemetryEnabled();
    this.telemetry_log_user_prompts_enabled =
      config.getTelemetryLogPromptsEnabled();
    this.file_filtering_respect_git_ignore =
      config.getFileFilteringRespectGitIgnore();
  }
}

export class EndSessionEvent {
  'event.name': 'end_session';
  'event.timestamp': string;
  session_id?: string;

  constructor(config?: Config) {
    this['event.name'] = 'end_session';
    this['event.timestamp'] = new Date().toISOString();
    this.session_id = config?.getSessionId();
  }
}

export class UserPromptEvent {
  'event.name': 'user_prompt';
  'event.timestamp': string;
  prompt_length: number;
  prompt_id: string;
  prompt?: string;

  constructor(prompt_length: number, prompt_Id: string, prompt?: string) {
    this['event.name'] = 'user_prompt';
    this['event.timestamp'] = new Date().toISOString();
    this.prompt_length = prompt_length;
    this.prompt_id = prompt_Id;
    this.prompt = prompt;
  }
}
