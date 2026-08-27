"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode, SessionData } from "@/lib/app-types";

const emptySession: SessionData = {
  sessionId: "", user: { id: "", name: "", email: "", roleName: "" }, roleCode: "LEARNER", permissions: [], availableRoles: [],
};

interface ToastState { id: number; message: string; tone: "success" | "error" | "info" }
interface LoginInput { email: string; password: string; rememberMe: boolean }
interface RegisterInput { displayName: string; email: string; password: string }
interface AppContextValue {
  session: SessionData;
  authenticated: boolean;
  authLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
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
    setSession(await apiRequest<SessionData>("/auth/login", { method: "POST", body: JSON.stringify(input) }));
  }, []);
  const register = useCallback(async (input: RegisterInput) => {
    setSession(await apiRequest<SessionData>("/auth/register", { method: "POST", body: JSON.stringify(input) }));
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

  const value = useMemo(() => ({ session, authenticated: Boolean(session.sessionId), authLoading, login, register, logout, setRole, refreshSession, notify }), [authLoading, login, logout, notify, refreshSession, register, session, setRole]);
  return <AppContext.Provider value={value}>{children}{toast ? <div aria-live={toast.tone === "error" ? "assertive" : "polite"} className={`fixed bottom-5 left-5 right-5 z-[80] max-w-sm animate-toast rounded-xl px-4 py-3 text-sm font-semibold shadow-xl sm:left-auto ${toast.tone === "error" ? "bg-rose-600 text-white" : toast.tone === "info" ? "bg-slate-900 text-white" : "bg-emerald-600 text-white"}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.message}</div> : null}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp phải được dùng bên trong AppProvider");
  return value;
}
