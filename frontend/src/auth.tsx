import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, setToken, setUnauthorizedHandler } from "@/src/api";
import { deviceLabel, devicePlatform } from "@/src/device";
import { clearOffline, startSyncLoop } from "@/src/offline";
import { queryClient } from "@/src/query-client";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "session_token";
const USER_KEY = "cached_user";

export type User = {
  user_id: string;
  email: string;
  phone?: string;
  name?: string | null;
  picture?: string;
  role: "DEVELOPER" | "OWNER" | "EMPLOYEE" | null;
  employee_type: "FIELD_AGENT" | "ACCOUNTANT" | null;
  org_id: string | null;
  org: any;
  consent_at?: string;
  has_password?: boolean;
};

type Conflict = { phone: string; code?: string; password?: string; reset?: boolean };

type Ctx = {
  user: User | null | undefined;
  token: string | null | undefined;
  error: string | null;
  busy: boolean;
  requestOtp: (phone: string, channel?: "whatsapp") => Promise<"sms" | "whatsapp" | null>;
  verifyOtp: (phone: string, code: string, force?: boolean, reset?: boolean) => Promise<boolean>;
  startLogin: (phone: string) => Promise<"password" | "otp" | null>;
  loginPassword: (phone: string, password: string, force?: boolean) => Promise<boolean>;
  setPassword: (password: string) => Promise<boolean>;
  conflict: Conflict | null;
  confirmConflict: () => Promise<boolean>;
  dismissConflict: () => void;
  saveName: (name: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null | undefined>(undefined);
  const [token, setTokenState] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [conflict, setConflict] = useState<Conflict | null>(null);

  const clear = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(USER_KEY);
    await clearOffline();
    setToken(null);
    setTokenState(null);
    queryClient.clear();
    setUserState(null);
  }, []);

  // Wraps a call with busy/error state; returns true on success.
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e: any) {
      setError(e.message ?? "حدث خطأ");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clear();
    });
    // Boot the offline sync loop (NetInfo listener + periodic kick). Without
    // this, the queue only drains when the user manually taps "sync now" or
    // enqueues a new item — so a reconnect catch-up never happens by itself.
    const stopSync = startSyncLoop();
    (async () => {
      const t = await storage.secureGet(TOKEN_KEY, null);
      if (!t) return setUserState(null);
      setToken(String(t));
      setTokenState(String(t));
      try {
        const me = await api<User>("/auth/me");
        setUserState(me);
        storage.setItem(USER_KEY, me as any);
        // Trusted device: slide the session forward + record this device on every app open.
        api("/auth/touch", { method: "POST", body: { device: deviceLabel(), platform: devicePlatform() } }).catch(() => {});
      } catch (e: any) {
        // Offline / server unreachable: stay logged in with the last known profile (persistent login).
        // A real 401 (session revoked, e.g. account moved to another device) clears via the unauthorized handler.
        const cached = await storage.getItem<any>(USER_KEY, null);
        if (cached) setUserState(cached as User);
        else await clear();
        // Re-sync the real profile once the server is reachable again.
        setTimeout(() => api<User>("/auth/me").then(setUserState).catch(() => {}), 5000);
      }
    })();
    return () => {
      stopSync();
    };
  }, [clear]);

  // Resolves to the channel the code was sent on, or null on failure.
  const requestOtp = useCallback(
    async (phone: string, channel?: "whatsapp") => {
      let sent: "sms" | "whatsapp" | null = null;
      await run(async () => {
        const r = await api<{ channel: "sms" | "whatsapp" }>("/auth/otp/request", { method: "POST", body: { phone, channel } });
        sent = r.channel;
      });
      return sent;
    },
    [run],
  );

  // Shared session opener for SMS-code and password logins.
  const signIn = useCallback(
    (path: string, body: any, pending: Conflict, reset?: boolean) =>
      run(async () => {
        setConflict(null);
        let r: { session_token: string; user: User };
        try {
          r = await api(path, { method: "POST", body });
        } catch (e: any) {
          // Account is open on another device: ask before moving it here.
          if (String(e?.message).includes("DEVICE_CONFLICT")) {
            setConflict(pending);
            return;
          }
          throw e;
        }
        // Password reset: route back to the set-password step (server allows it for 15 min after an SMS login).
        if (reset) r.user = { ...r.user, has_password: false };
        await storage.setItem(USER_KEY, r.user as any);
        setToken(r.session_token);
        await storage.secureSet(TOKEN_KEY, r.session_token);
        setTokenState(r.session_token);
        setUserState(r.user);
        api("/auth/touch", { method: "POST", body: { device: deviceLabel(), platform: devicePlatform() } }).catch(() => {});
      }),
    [run],
  );

  const verifyOtp = useCallback(
    (phone: string, code: string, force?: boolean, reset?: boolean) =>
      signIn("/auth/otp/verify", { phone, code, force: !!force }, { phone, code, reset }, reset),
    [signIn],
  );

  const loginPassword = useCallback(
    (phone: string, password: string, force?: boolean) =>
      signIn("/auth/password/login", { phone, password, force: !!force }, { phone, password }),
    [signIn],
  );

  const confirmConflict = useCallback(async () => {
    if (!conflict) return false;
    return conflict.password ? loginPassword(conflict.phone, conflict.password, true) : verifyOtp(conflict.phone, conflict.code ?? "", true, conflict.reset);
  }, [conflict, loginPassword, verifyOtp]);

  // Resolves to how this number signs in: "password" (has one) or "otp" (code was just sent).
  const startLogin = useCallback(
    async (phone: string) => {
      let method: "password" | "otp" | null = null;
      await run(async () => {
        const r = await api<{ method: "password" | "otp" }>("/auth/start", { method: "POST", body: { phone } });
        method = r.method;
      });
      return method;
    },
    [run],
  );

  const setPassword = useCallback(
    (password: string) =>
      run(async () => {
        await api("/auth/password", { method: "POST", body: { password } });
        setUserState((u) => (u ? { ...u, has_password: true } : u));
      }),
    [run],
  );

  const saveName = useCallback(
    (name: string) =>
      run(async () => {
        const r = await api<{ name: string }>("/auth/name", { method: "POST", body: { name } });
        // Keep the saved name even if the profile refresh fails, so the name step never re-appears.
        setUserState((u) => (u ? { ...u, name: r.name } : u));
        try {
          setUserState(await api<User>("/auth/me"));
        } catch {}
      }),
    [run],
  );

  // Persist the latest profile so offline/slow boots never fall back to a stale (nameless) copy.
  useEffect(() => {
    if (user) storage.setItem(USER_KEY, user as any);
  }, [user]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await clear();
  }, [clear]);

  const refresh = useCallback(async () => {
    try {
      setUserState(await api<User>("/auth/me"));
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, error, busy, requestOtp, verifyOtp, startLogin, loginPassword, setPassword, conflict, confirmConflict, dismissConflict: () => setConflict(null), saveName, logout, setUser: setUserState, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function homeFor(u: User | null | undefined): string {
  // Phone accounts set their password and name on the login screen.
  if (!u || u.has_password === false || !u.name) return "login";
  if (!u.consent_at) return "consent";
  if (!u.role) return "activate";
  if (u.role === "DEVELOPER") return "dev";
  const org = u.org;
  // An expired trial falls back to the Free plan (not blocked); expired paid licences block.
  if (!org || org.status !== "ACTIVE" || (org.plan !== "TRIAL" && new Date(org.expires_at) < new Date())) return "blocked";
  if (u.role === "OWNER") return "owner";
  return u.employee_type === "ACCOUNTANT" ? "acct" : "dist";
}
