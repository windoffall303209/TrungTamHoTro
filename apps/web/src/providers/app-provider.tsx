"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api-client";
import { clearSessionDrafts } from "@/lib/session-drafts";
import type { RoleCode, SessionData } from "@/lib/app-types";
import { isSupportedLocale } from "@/i18n/catalog";
import { useI18n } from "@/providers/i18n-provider";

const emptySession: SessionData = {
  sessionId: "", user: { id: "", username: "", name: "", email: "", roleName: "", avatarUrl: null }, roleCode: "LEARNER", permissions: [], availableRoles: [],
};

interface ToastState { id: number; message: string; tone: "success" | "error" | "info" }
interface LoginInput { username: string; password: string; rememberMe: boolean }
interface AppContextValue {
  session: SessionData;
  authenticated: boolean;
  authLoading: boolean;
  authError: string;
  login: (input: LoginInput) => Promise<{ requiresMfa: boolean; challengeToken?: string }>;
  completeMfa: (challengeToken: string, value: string, rememberMe: boolean, recovery?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  setRole: (role: RoleCode) => Promise<void>;
  refreshSession: () => Promise<boolean>;
  notify: (message: string, tone?: ToastState["tone"]) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Giữ phiên toàn ứng dụng, điều phối auth/MFA/role và cung cấp toast dùng chung. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const { setLocale } = useI18n();
  const [session, setSession] = useState<SessionData>(emptySession);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  /** Nhận phiên hợp lệ và áp tùy chọn ngôn ngữ đã lưu trong hồ sơ người dùng. */
  const adoptSession = useCallback((nextSession: SessionData) => {
    setAuthError("");
    setSession(nextSession);
    if (isSupportedLocale(nextSession.user.locale)) setLocale(nextSession.user.locale);
  }, [setLocale]);

  /** Chỉ hủy phiên khi server xác nhận hết quyền; lỗi mạng và giới hạn tần suất cho phép thử lại. */
  const refreshSession = useCallback(async (): Promise<boolean> => {
    setAuthLoading(true);
    setAuthError("");
    try { adoptSession(await apiRequest<SessionData>("/auth/session")); return true; }
    catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) setSession(emptySession);
      else setAuthError("Chưa kiểm tra được phiên làm việc. Vui lòng thử lại.");
      return false;
    }
    finally { setAuthLoading(false); }
  }, [adoptSession]);

  useEffect(() => { window.queueMicrotask(() => void refreshSession()); }, [refreshSession]);
  useEffect(() => {
    /** Xóa session cục bộ khi API phát tín hiệu phiên hết hạn từ tab hiện tại hoặc tab khác. */
    const clearExpiredSession = () => setSession(emptySession);
    window.addEventListener("wind-edu:unauthorized", clearExpiredSession);
    return () => window.removeEventListener("wind-edu:unauthorized", clearExpiredSession);
  }, []);

  /** Đăng nhập và tách kết quả cần MFA khỏi phiên hoàn chỉnh. */
  const login = useCallback(async (input: LoginInput) => {
    const result = await apiRequest<SessionData | { requiresMfa: true; challengeToken: string }>("/auth/login", { method: "POST", body: JSON.stringify(input) });
    if ("requiresMfa" in result) return { requiresMfa: true, challengeToken: result.challengeToken };
    adoptSession(result);
    return { requiresMfa: false };
  }, [adoptSession]);
  /** Hoàn tất MFA bằng TOTP hoặc recovery code và lưu phiên trả về. */
  const completeMfa = useCallback(async (challengeToken: string, value: string, rememberMe: boolean, recovery = false) => {
    const path = recovery ? "/auth/mfa/recovery" : "/auth/mfa/verify";
    const body = recovery ? { challengeToken, recoveryCode: value, rememberMe } : { challengeToken, code: value, rememberMe };
    adoptSession(await apiRequest<SessionData>(path, { method: "POST", body: JSON.stringify(body) }));
  }, [adoptSession]);
  /** Thu hồi phiên server và luôn xóa state client kể cả request thất bại. */
  const logout = useCallback(async () => {
    try { await apiRequest<void>("/auth/logout", { method: "POST" }); } finally { clearSessionDrafts(); setSession(emptySession); }
  }, []);
  /** Yêu cầu server ánh xạ lại phiên theo vai trò được người dùng chọn. */
  const setRole = useCallback(async (role: RoleCode) => {
    adoptSession(await apiRequest<SessionData>("/auth/session", { roleCode: role }));
  }, [adoptSession]);
  /** Hiển thị toast có id để timer cũ không đóng nhầm thông báo mới. */
  const notify = useCallback((message: string, tone: ToastState["tone"] = "success") => {
    const next = { id: Date.now(), message, tone };
    setToast(next);
    window.setTimeout(() => setToast((current) => current?.id === next.id ? null : current), 3600);
  }, []);

  const value = useMemo(() => ({ session, authenticated: Boolean(session.sessionId), authLoading, authError, login, completeMfa, logout, setRole, refreshSession, notify }), [authError, authLoading, completeMfa, login, logout, notify, refreshSession, session, setRole]);
  return <AppContext.Provider value={value}>{children}{toast ? <div aria-live={toast.tone === "error" ? "assertive" : "polite"} className={`fixed bottom-5 left-5 right-5 z-[80] max-w-sm animate-toast rounded-xl px-4 py-3 text-sm font-semibold shadow-xl sm:left-auto ${toast.tone === "error" ? "bg-[var(--danger-fill)] text-[var(--status-on-fill)]" : toast.tone === "info" ? "bg-[var(--action)] text-[var(--action-ink)]" : "bg-[var(--success-fill)] text-[var(--status-on-fill)]"}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.message}</div> : null}</AppContext.Provider>;
}

/** Truy cập AppContext và báo lỗi sớm nếu component nằm ngoài provider. */
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp phải được dùng bên trong AppProvider");
  return value;
}
