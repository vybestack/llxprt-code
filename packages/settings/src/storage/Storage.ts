/**
 * @plan PLAN-20260609-ISSUE1590.P06
 *
 * Storage now lives in the leaf package @vybestack/llxprt-code-storage.
 * This module re-exports it so existing @vybestack/llxprt-code-settings
 * consumers continue to work unchanged.
 */

export * from '@vybestack/llxprt-code-storage/config/storage.js';
