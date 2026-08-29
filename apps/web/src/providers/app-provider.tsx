"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode, SessionData } from "@/lib/app-types";

const emptySession: SessionData = {
  sessionId: "", user: { id: "", username: "", name: "", email: "", roleName: "" }, roleCode: "LEARNER", permissions: [], availableRoles: [],
};

interface ToastState { id: number; message: string; tone: "success" | "error" | "info" }
interface LoginInput { username: string; password: string; rememberMe: boolean }
interface RegisterInput { username: string; displayName: string; email: string; password: string }
export interface RegistrationResult { verificationRequired: true; verificationId: string; email: string; verificationEmailSent: boolean }
interface AppContextValue {
  session: SessionData;
  authenticated: boolean;
  authLoading: boolean;
  login: (input: LoginInput) => Promise<{ requiresMfa: boolean; challengeToken?: string }>;
  register: (input: RegisterInput) => Promise<RegistrationResult>;
  completeMfa: (challengeToken: string, value: string, rememberMe: boolean, recovery?: boolean) => Promise<void>;
  completeGoogleMfa: (value: string, recovery?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  setRole: (role: RoleCode) => Promise<void>;
  refreshSession: () => Promise<boolean>;
  notify: (message: string, tone?: ToastState["tone"]) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionData>(emptySession);
  const [authLoading, setAuthLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try { setSession(await apiRequest<SessionData>("/auth/session")); return true; }
    catch { setSession(emptySession); return false; }
    finally { setAuthLoading(false); }
  }, []);

  useEffect(() => { window.queueMicrotask(() => void refreshSession()); }, [refreshSession]);
  useEffect(() => {
    const clearExpiredSession = () => setSession(emptySession);
    window.addEventListener("wind-edu:unauthorized", clearExpiredSession);
    return () => window.removeEventListener("wind-edu:unauthorized", clearExpiredSession);
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const result = await apiRequest<SessionData | { requiresMfa: true; challengeToken: string }>("/auth/login", { method: "POST", body: JSON.stringify(input) });
    if ("requiresMfa" in result) return { requiresMfa: true, challengeToken: result.challengeToken };
    setSession(result);
    return { requiresMfa: false };
  }, []);
  const register = useCallback(async (input: RegisterInput) => {
    return apiRequest<RegistrationResult>("/auth/register", { method: "POST", body: JSON.stringify(input) });
  }, []);
  const completeMfa = useCallback(async (challengeToken: string, value: string, rememberMe: boolean, recovery = false) => {
    const path = recovery ? "/auth/mfa/recovery" : "/auth/mfa/verify";
    const body = recovery ? { challengeToken, recoveryCode: value, rememberMe } : { challengeToken, code: value, rememberMe };
    setSession(await apiRequest<SessionData>(path, { method: "POST", body: JSON.stringify(body) }));
  }, []);
  const completeGoogleMfa = useCallback(async (value: string, recovery = false) => {
    const path = recovery ? "/auth/google/mfa/recovery" : "/auth/google/mfa/verify";
    const body = recovery ? { recoveryCode: value } : { code: value };
    setSession(await apiRequest<SessionData>(path, { method: "POST", body: JSON.stringify(body) }));
  }, []);
  const logout = useCallback(async () => {
    try { await apiRequest<void>("/auth/logout", { method: "POST" }); } finally { setSession(emptySession); }
  }, []);
  const setRole = useCallback(async (role: RoleCode) => {
    setSession(await apiRequest<SessionData>("/auth/session", { roleCode: role }));
  }, []);
  const notify = useCallback((message: string, tone: ToastState["tone"] = "success") => {
    const next = { id: Date.now(), message, tone };
    setToast(next);
    window.setTimeout(() => setToast((current) => current?.id === next.id ? null : current), 3600);
  }, []);

  const value = useMemo(() => ({ session, authenticated: Boolean(session.sessionId), authLoading, login, register, completeMfa, completeGoogleMfa, logout, setRole, refreshSession, notify }), [authLoading, completeGoogleMfa, completeMfa, login, logout, notify, refreshSession, register, session, setRole]);
  return <AppContext.Provider value={value}>{children}{toast ? <div aria-live={toast.tone === "error" ? "assertive" : "polite"} className={`fixed bottom-5 left-5 right-5 z-[80] max-w-sm animate-toast rounded-xl px-4 py-3 text-sm font-semibold shadow-xl sm:left-auto ${toast.tone === "error" ? "bg-rose-600 text-white" : toast.tone === "info" ? "bg-slate-900 text-white" : "bg-emerald-600 text-white"}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.message}</div> : null}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp phải được dùng bên trong AppProvider");
  return value;
}
