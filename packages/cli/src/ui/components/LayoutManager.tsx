import React from 'react'

interface LayoutManagerProps {
  children: React.ReactNode
}

export const LayoutManager: React.FC<LayoutManagerProps> = ({ children }) => (
  <>{children}</>
)