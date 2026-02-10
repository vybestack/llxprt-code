/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SubagentConfig } from '@vybestack/llxprt-code-core';

/**
 * Views available in the SubagentManagerDialog
 */
export enum SubagentView {
  MENU = 'menu',
  LIST = 'list',
  SHOW = 'show',
  EDIT = 'edit',
  CREATE = 'create',
  DELETE = 'delete',
  ATTACH_PROFILE = 'attach_profile',
}

/**
 * Focus modes for the list view
 */
export enum ListFocusMode {
  SEARCH = 'search',
  LIST = 'list',
}

/**
 * Creation wizard steps
 *
 * NOTE: Currently the wizard uses field-based navigation rather than
 * step-based navigation. This enum is retained for potential future
 * multi-step wizard implementation.
 */
export enum CreateStep {
  /** Single form view with all fields */
  FORM = 'form',
}

/**
 * Edit form field focus
 */
export enum EditField {
  SYSTEM_PROMPT = 'system_prompt',
  PROFILE = 'profile',
}

/**
 * Extended subagent info with profile details for display
 */
export interface SubagentInfo extends SubagentConfig {
  profileInfo?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * State for the SubagentManagerDialog
 */
export interface SubagentManagerState {
  currentView: SubagentView;
  selectedSubagent: SubagentInfo | null;
  navigationStack: SubagentView[];
  searchTerm: string;
  searchActive: boolean;
  selectedIndex: number;
  subagents: SubagentInfo[];
  profiles: string[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Props for SubagentManagerDialog
 */
export interface SubagentManagerDialogProps {
  onClose: () => void;
  initialView?: SubagentView;
  initialSubagentName?: string;
}

/**
 * Creation wizard state
 */
export interface CreateWizardState {
  currentStep: CreateStep;
  name: string;
  mode: 'auto' | 'manual';
  systemPrompt: string;
  selectedProfile: string;
  validationErrors: Record<string, string>;
}

/**
 * Edit form state
 */
export interface EditFormState {
  systemPrompt: string;
  selectedProfile: string;
  focusedField: EditField;
  isEditing: boolean;
  hasChanges: boolean;
}

/**
 * Menu action items
 */
export interface MenuAction {
  label: string;
  value: SubagentView;
  description: string;
}

/**
 * Default menu actions for the main menu
 */
export const MENU_ACTIONS: MenuAction[] = [
  {
    label: 'List Subagents',
    value: SubagentView.LIST,
    description: 'Show all available subagents',
  },
  {
    label: 'Create Subagent',
    value: SubagentView.CREATE,
    description: 'Create new subagent',
  },
];
