export { ModalShell, type ModalShellProps } from './ModalShell';
export { SearchSelectModal, type SearchSelectProps } from './SearchSelectModal';
export { AuthModal, type AuthOption } from './AuthModal';
export { ThemeModal } from './ThemeModal';
export { filterItems, type SearchItem } from './types';
export {
  ToolApprovalModal,
  type ToolApprovalModalProps,
  type ToolApprovalDetails,
  type ToolApprovalOutcome,
} from './ToolApprovalModal';

// Default auth options used by the auth dialog
import type { AuthOption } from './AuthModal';
export const AUTH_DEFAULTS: AuthOption[] = [
  { id: 'gemini', label: '1. Gemini (Google OAuth)', enabled: true },
  { id: 'qwen', label: '2. Qwen (OAuth)', enabled: true },
  { id: 'anthropic', label: '3. Anthropic Claude (OAuth)', enabled: true },
  { id: 'close', label: '4. Close', enabled: false },
];
