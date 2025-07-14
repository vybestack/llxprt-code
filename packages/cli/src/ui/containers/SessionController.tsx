import React, { createContext, useContext, useReducer, useMemo } from 'react'

// Stub session state
interface SessionState {
  sessionId: string | null
}

// Stub action types
type SessionAction = 
  | { type: 'SET_SESSION_ID'; payload: string }
  | { type: 'CLEAR_SESSION' }

// Stub reducer
const sessionReducer = (state: SessionState, action: SessionAction): SessionState => {
  switch (action.type) {
    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.payload }
    case 'CLEAR_SESSION':
      return { ...state, sessionId: null }
    default:
      return state
  }
}

// Context type
interface SessionContextType {
  state: SessionState
  dispatch: React.Dispatch<SessionAction>
}

// Create context
const SessionContext = createContext<SessionContextType | undefined>(undefined)

// Provider component
interface SessionControllerProps {
  children: React.ReactNode
}

export const SessionController: React.FC<SessionControllerProps> = ({ children }) => {
  const [state, dispatch] = useReducer(sessionReducer, { sessionId: null })
  
  const contextValue = useMemo(() => ({ state, dispatch }), [state, dispatch])

  return (
    <SessionContext.Provider value={contextValue}>
      {children}
    </SessionContext.Provider>
  )
}

// Custom hook for using session context
export const useSession = () => {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within SessionController')
  }
  return context
}