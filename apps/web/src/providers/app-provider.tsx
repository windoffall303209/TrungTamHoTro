"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode, SessionData } from "@/lib/app-types";

const fallbackSessions: Record<RoleCode, SessionData> = {
  SYSTEM_ADMIN: { user: { id: "usr-admin", name: "Wind Of Fall", email: "admin@wind.edu.vn", roleName: "Quản trị hệ thống" }, roleCode: "SYSTEM_ADMIN", permissions: ["user:view", "user:create", "user:update", "user:suspend", "role:view", "role:update", "system:configure"] },
  CENTER_MANAGER: { user: { id: "usr-manager", name: "Nguyễn Minh Anh", email: "manager@wind.edu.vn", roleName: "Quản lý trung tâm" }, roleCode: "CENTER_MANAGER", permissions: ["course:view", "course:manage", "class:view", "class:manage", "report:view"] },
  INSTRUCTOR: { user: { id: "usr-instructor", name: "Trần Thu Hà", email: "instructor@wind.edu.vn", roleName: "Giảng viên" }, roleCode: "INSTRUCTOR", permissions: ["class:view", "material:view", "material:manage", "question:view", "question:manage", "exam:view", "exam:manage", "forum:view", "forum:post", "session:view", "session:manage"] },
  LEARNER: { user: { id: "usr-learner", name: "Lê Hoàng Nam", email: "learner@wind.edu.vn", roleName: "Học viên" }, roleCode: "LEARNER", permissions: ["class:view", "material:view", "exam:view", "forum:view", "forum:post", "session:view", "support:create"] },
};

interface ToastState { id: number; message: string; tone: "success" | "error" | "info" }

interface AppContextValue {
  session: SessionData;
  setRole: (role: RoleCode) => void;
  notify: (message: string, tone?: ToastState["tone"]) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionData>(fallbackSessions.SYSTEM_ADMIN);
  const [toast, setToast] = useState<ToastState | null>(null);

  const setRole = useCallback((role: RoleCode) => {
    setSession(fallbackSessions[role]);
    window.localStorage.setItem("wind-edu-role", role);
    void apiRequest<SessionData>("/auth/session", { roleCode: role })
      .then(setSession)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("wind-edu-role") as RoleCode | null;
    if (stored && stored in fallbackSessions) window.queueMicrotask(() => setRole(stored));
  }, [setRole]);

  const notify = useCallback((message: string, tone: ToastState["tone"] = "success") => {
    const next = { id: Date.now(), message, tone };
    setToast(next);
    window.setTimeout(() => setToast((current) => current?.id === next.id ? null : current), 3600);
  }, []);

  const value = useMemo(() => ({ session, setRole, notify }), [notify, session, setRole]);

  return (
    <AppContext.Provider value={value}>
      {children}
      {toast ? (
        <div aria-live="polite" className={`fixed bottom-5 right-5 z-[80] max-w-sm animate-toast rounded-xl px-4 py-3 text-sm font-semibold shadow-xl ${
          toast.tone === "error" ? "bg-rose-600 text-white" : toast.tone === "info" ? "bg-slate-900 text-white" : "bg-emerald-600 text-white"
        }`} role="status">{toast.message}</div>
      ) : null}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp phải được dùng bên trong AppProvider");
  return value;
}
