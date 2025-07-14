import React from 'react'

interface UIStateShellProps {
  children: React.ReactNode
}

export const UIStateShell: React.FC<UIStateShellProps> = ({ children }) => (
  <>{children}</>
)