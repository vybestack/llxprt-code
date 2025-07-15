import React from 'react';
import { LayoutManager } from '../components/LayoutManager.js';

interface UIStateShellProps {
  children: React.ReactNode;
}

export const UIStateShell: React.FC<UIStateShellProps> = ({ children }) => (
  <LayoutManager>{children}</LayoutManager>
);
