import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { apiFetch, setAuthToken } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "budkoszt_auth_token";
const EMERGENT_AUTH_URL = "https://auth.emergentagent.com/";

type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
  company_name?: string;
  nip?: string;
  address?: string;
  phone?: string;
};

type Status = "loading" | "authed" | "guest";

type AuthCtx = {
  user: User | null;
  status: Status;
  loginEmail: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, company: string) => Promise<void>;
  loginGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};

const Ctx = createContext<AuthCtx | null>(null);

async function saveToken(token: string) {
  setAuthToken(token);
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {}
  } else {
    await storage.secureSet(TOKEN_KEY, token);
  }
}

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
  return storage.secureGet(TOKEN_KEY, null);
}

async function clearToken() {
  setAuthToken(null);
  if (Platform.OS === "web") {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {}
  } else {
    await storage.secureRemove(TOKEN_KEY);
  }
}

function extractSessionId(url: string): string | null {
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const processed = useRef<Set<string>>(new Set());

  const exchangeSession = useCallback(async (sessionId: string) => {
    if (processed.current.has(sessionId)) return;
    processed.current.add(sessionId);
    const res = await apiFetch<{ session_token: string; user: User }>("/auth/session", {
      method: "POST",
      body: { session_id: sessionId },
    });
    await saveToken(res.session_token);
    setUserState(res.user);
    setStatus("authed");
  }, []);

  // Initial load + web session_id handling
  useEffect(() => {
    (async () => {
      // Web: process session_id from URL first
      if (Platform.OS === "web") {
        const href = window.location.href;
        const sid = extractSessionId(href);
        if (sid) {
          try {
            await exchangeSession(sid);
            const clean = window.location.origin + window.location.pathname;
            window.history.replaceState(window.history.state, "", clean);
            return;
          } catch {
            // fall through to token check
          }
        }
      } else {
        const initial = await Linking.getInitialURL();
        if (initial) {
          const sid = extractSessionId(initial);
          if (sid) {
            try {
              await exchangeSession(sid);
              return;
            } catch {}
          }
        }
      }

      const token = await readToken();
      if (!token) {
        setStatus("guest");
        return;
      }
      setAuthToken(token);
      try {
        const res = await apiFetch<{ user: User }>("/auth/me");
        setUserState(res.user);
        setStatus("authed");
      } catch {
        await clearToken();
        setStatus("guest");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile hot deep links
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) exchangeSession(sid).catch(() => {});
    });
    return () => sub.remove();
  }, [exchangeSession]);

  const loginEmail = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await saveToken(res.token);
    setUserState(res.user);
    setStatus("authed");
  }, []);

  const register = useCallback(async (email: string, password: string, name: string, company: string) => {
    const res = await apiFetch<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: { email, password, name, company_name: company },
    });
    await saveToken(res.token);
    setUserState(res.user);
    setStatus("authed");
  }, []);

  const loginGoogle = useCallback(async () => {
    if (Platform.OS === "web") {
      const redirect = window.location.origin + "/";
      window.location.href = `${EMERGENT_AUTH_URL}?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirectUrl = Linking.createURL("");
    const authUrl = `${EMERGENT_AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let sid: string | null = null;
    if (result.type === "success" && result.url) sid = extractSessionId(result.url);
    if (!sid) {
      const initial = await Linking.getInitialURL();
      if (initial) sid = extractSessionId(initial);
    }
    if (sid) await exchangeSession(sid);
  }, [exchangeSession]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {}
    await clearToken();
    setUserState(null);
    setStatus("guest");
  }, []);

  const setUser = useCallback((u: User) => setUserState(u), []);

  return (
    <Ctx.Provider value={{ user, status, loginEmail, register, loginGoogle, logout, setUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
