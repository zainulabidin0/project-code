"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const ACCESS_KEY = "af_access_token";

type User = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
};

type AuthContextValue = {
  accessToken: string | null;
  user: User | null;
  setSession: (accessToken: string, user: User) => void;
  clearSession: () => void;
  refreshAccess: () => Promise<boolean>;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem(ACCESS_KEY);
    const u = sessionStorage.getItem("af_user");
    if (t) setAccessToken(t);
    if (u) {
      try {
        setUser(JSON.parse(u) as User);
      } catch {
        /* ignore */
      }
    }
    setHydrated(true);
  }, []);

  const setSession = useCallback((token: string, u: User) => {
    sessionStorage.setItem(ACCESS_KEY, token);
    sessionStorage.setItem("af_user", JSON.stringify(u));
    setAccessToken(token);
    setUser(u);
  }, []);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(ACCESS_KEY);
    sessionStorage.removeItem("af_user");
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshAccess = useCallback(async (): Promise<boolean> => {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const j = (await res.json()) as {
      data?: { accessToken?: string };
    };
    const t = j.data?.accessToken;
    if (!t) return false;
    sessionStorage.setItem(ACCESS_KEY, t);
    setAccessToken(t);
    return true;
  }, []);

  const authorizedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      let token = accessToken ?? sessionStorage.getItem(ACCESS_KEY);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      let res = await fetch(input, { ...init, headers, credentials: "include" });
      if (res.status === 401) {
        const ok = await refreshAccess();
        if (ok) {
          token = sessionStorage.getItem(ACCESS_KEY);
          const h2 = new Headers(init?.headers);
          if (token) h2.set("Authorization", `Bearer ${token}`);
          res = await fetch(input, { ...init, headers: h2, credentials: "include" });
        }
      }
      return res;
    },
    [accessToken, refreshAccess]
  );

  const value = useMemo(
    () => ({
      accessToken: hydrated ? accessToken : null,
      user: hydrated ? user : null,
      setSession,
      clearSession,
      refreshAccess,
      authorizedFetch,
    }),
    [
      accessToken,
      user,
      hydrated,
      setSession,
      clearSession,
      refreshAccess,
      authorizedFetch,
    ]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
