/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApprovalMode,
  DebugLogger,
  debugLogger,
} from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:config:approvalMode');

export interface ApprovalModeInput {
  cliApprovalMode: string | undefined;
  cliYolo: boolean | undefined;
  disableYoloMode: boolean | undefined;
  secureModeEnabled: boolean | undefined;
  trustedFolder: boolean;
}

/**
 * Resolves the approval mode from CLI args, settings, and trust status.
 * Throws if YOLO mode is requested but disabled by admin.
 */
export function resolveApprovalMode(input: ApprovalModeInput): ApprovalMode {
  const {
    cliApprovalMode,
    cliYolo,
    disableYoloMode,
    secureModeEnabled,
    trustedFolder,
  } = input;

  let approvalMode: ApprovalMode;

  if (cliApprovalMode) {
    switch (cliApprovalMode) {
      case 'yolo':
        approvalMode = ApprovalMode.YOLO;
        break;
      case 'auto_edit':
        approvalMode = ApprovalMode.AUTO_EDIT;
        break;
      case 'default':
        approvalMode = ApprovalMode.DEFAULT;
        break;
      default:
        throw new Error(
          `Invalid approval mode: ${cliApprovalMode}. Valid values are: yolo, auto_edit, default`,
        );
    }
  } else {
    approvalMode = cliYolo || false ? ApprovalMode.YOLO : ApprovalMode.DEFAULT;
  }

  if (disableYoloMode || secureModeEnabled) {
    if (approvalMode === ApprovalMode.YOLO) {
      if (secureModeEnabled) {
        logger.error('YOLO mode is disabled by "secureModeEnabled" setting.');
      } else {
        logger.error('YOLO mode is disabled by the "disableYoloMode" setting.');
      }
      throw new Error(
        'Cannot start in YOLO mode since it is disabled by your admin',
      );
    }
  } else if (approvalMode === ApprovalMode.YOLO) {
    debugLogger.warn(
      'YOLO mode is enabled. All tool calls will be automatically approved.',
    );
  }

  if (!trustedFolder && approvalMode !== ApprovalMode.DEFAULT) {
    logger.log(
      `Approval mode overridden to "default" because the current folder is not trusted.`,
    );
    approvalMode = ApprovalMode.DEFAULT;
  }

  return approvalMode;
}
