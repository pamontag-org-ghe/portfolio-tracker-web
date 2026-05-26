import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, loadStoredToken, setAuthToken } from '../api/client';

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = loadStoredToken();
    if (!stored) { setLoading(false); return; }
    setToken(stored);
    api.get('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => {
        setAuthToken(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    setAuthToken(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const res = await api.post('/auth/register', { email, password, displayName });
    setAuthToken(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, token, loading, login, register, logout }), [user, token, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
