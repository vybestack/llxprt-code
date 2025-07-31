/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SERVICE_NAME = 'llxprt-code';

export const EVENT_USER_PROMPT = 'llxprt_code.user_prompt';
export const EVENT_TOOL_CALL = 'llxprt_code.tool_call';
export const EVENT_API_REQUEST = 'llxprt_code.api_request';
export const EVENT_API_ERROR = 'llxprt_code.api_error';
export const EVENT_API_RESPONSE = 'llxprt_code.api_response';
export const EVENT_CLI_CONFIG = 'llxprt_code.config';
export const EVENT_FLASH_FALLBACK = 'llxprt_code.flash_fallback';
export const EVENT_NEXT_SPEAKER_CHECK = 'llxprt_code.next_speaker_check';
export const EVENT_SLASH_COMMAND = 'llxprt_code.slash_command';

export const METRIC_TOOL_CALL_COUNT = 'llxprt_code.tool.call.count';
export const METRIC_TOOL_CALL_LATENCY = 'llxprt_code.tool.call.latency';
export const METRIC_API_REQUEST_COUNT = 'llxprt_code.api.request.count';
export const METRIC_API_REQUEST_LATENCY = 'llxprt_code.api.request.latency';
export const METRIC_TOKEN_USAGE = 'llxprt_code.token.usage';
export const METRIC_SESSION_COUNT = 'llxprt_code.session.count';
export const METRIC_FILE_OPERATION_COUNT = 'llxprt_code.file.operation.count';
