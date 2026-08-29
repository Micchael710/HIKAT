import React, { createContext, useContext, useState, useCallback, useEffect } from "react"
import type { AdminUser } from "../types"
import { authService } from "../services/authService"

interface AuthContextValue {
  user: AdminUser | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  getAccessToken: () => string | null
  initiateOAuth: (provider: "GOOGLE" | "DISCORD") => Promise<void>
  handleOAuthCallback: (params: { code: string; codeVerifier: string; state: string; expectedState: string }) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(() => authService.getUser())
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Bootstrap session from sessionStorage
    authService.bootstrap().then((restored) => {
      if (restored) setUser(restored)
    })

    const unsubscribe = authService.subscribe((updatedUser) => {
      setUser(updatedUser)
    })
    return () => unsubscribe()
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const loggedUser = await authService.login(email, password)
      setUser(loggedUser)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    setIsLoading(true)
    try {
      await authService.logout()
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const getAccessToken = useCallback(() => {
    return authService.getAccessToken()
  }, [])

  const initiateOAuth = useCallback(async (provider: "GOOGLE" | "DISCORD") => {
    const { authUrl, codeVerifier, state } = await authService.initiateOAuth(provider)
    sessionStorage.setItem("hikat_oauth_verifier", codeVerifier)
    sessionStorage.setItem("hikat_oauth_state", state)
    sessionStorage.setItem("hikat_oauth_provider", provider)
    window.location.href = authUrl
  }, [])

  const handleOAuthCallback = useCallback(async (params: {
    code: string
    codeVerifier: string
    state: string
    expectedState: string
  }) => {
    setIsLoading(true)
    try {
      const loggedUser = await authService.handleOAuthCallback(params)
      setUser(loggedUser)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        getAccessToken,
        initiateOAuth,
        handleOAuthCallback,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return ctx
}
