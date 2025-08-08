/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Semantic color tokens that provide meaningful color abstractions
 * for different UI purposes. These tokens map to actual colors
 * based on the active theme.
 */
export interface SemanticColors {
  /**
   * Colors for text content at different hierarchy levels
   */
  text: {
    /** Primary text color for main content */
    primary: string;
    /** Secondary text color for less important content */
    secondary: string;
    /** Accent text color for highlighted or interactive content */
    accent: string;
  };

  /**
   * Colors for status indicators and feedback
   */
  status: {
    /** Color for successful states and positive feedback */
    success: string;
    /** Color for warning states and cautionary messages */
    warning: string;
    /** Color for error states and critical issues */
    error: string;
  };

  /**
   * Colors for background surfaces
   */
  background: {
    /** Primary background color for main surfaces */
    primary: string;
    /** Secondary background color for secondary surfaces */
    secondary: string;
  };

  /**
   * Colors for borders and dividers
   */
  border: {
    /** Default border color for general use */
    default: string;
    /** Border color for focused or active elements */
    focused: string;
  };
}
