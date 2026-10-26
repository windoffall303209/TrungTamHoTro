"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api-client";
import { clearSessionDrafts } from "@/lib/session-drafts";
import type { RoleCode, SessionData } from "@/lib/app-types";
import { isSupportedLocale, LOCALE_STORAGE_KEY } from "@/i18n/catalog";
import { useI18n } from "@/providers/i18n-provider";

const emptySession: SessionData = {
  sessionId: "", user: { id: "", username: "", name: "", email: "", roleName: "", avatarUrl: null }, roleCode: "LEARNER", permissions: [], availableRoles: [],
};

interface ToastState { id: number; message: string; tone: "success" | "error" | "info" }
interface LoginInput { username: string; password: string; rememberMe: boolean }
interface AccountSetupStart { setupToken: string; username: string }
interface AppContextValue {
  session: SessionData;
  authenticated: boolean;
  authLoading: boolean;
  authError: string;
  login: (input: LoginInput) => Promise<{ requiresMfa: boolean; challengeToken?: string; accountSetup?: AccountSetupStart }>;
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
    const storedLocale = typeof window !== "undefined" ? window.localStorage.getItem(LOCALE_STORAGE_KEY) : null;
    if (isSupportedLocale(storedLocale)) {
      setLocale(storedLocale);
    } else if (isSupportedLocale(nextSession.user.locale)) {
      setLocale(nextSession.user.locale);
    }
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

  /** Đăng nhập và tách kết quả cần MFA hoặc cần xác thực tài khoản tạm khỏi phiên hoàn chỉnh. */
  const login = useCallback(async (input: LoginInput) => {
    const result = await apiRequest<SessionData | { requiresMfa: true; challengeToken: string } | ({ requiresAccountSetup: true } & AccountSetupStart)>("/auth/login", { method: "POST", body: JSON.stringify(input) });
    if ("requiresMfa" in result) return { requiresMfa: true, challengeToken: result.challengeToken };
    if ("requiresAccountSetup" in result) return { requiresMfa: false, accountSetup: { setupToken: result.setupToken, username: result.username } };
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
  return (
    <AppContext.Provider value={value}>
      {children}
      {toast ? (
        <aside
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          className="fixed top-5 right-5 z-[100000] w-[min(24rem,calc(100vw-2rem))] animate-slide-in-down rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-[#181922]/95 backdrop-blur-md p-4 shadow-2xl transition-all"
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <div className="flex items-start gap-3">
            <div
              className={`size-8 rounded-xl grid place-items-center shrink-0 ${
                toast.tone === "error"
                  ? "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400"
                  : toast.tone === "info"
                    ? "bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400"
                    : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
              }`}
            >
              {toast.tone === "error" ? (
                <AlertCircle size={18} />
              ) : toast.tone === "info" ? (
                <Info size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
            </div>

            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {toast.tone === "error"
                  ? "Cảnh báo / Lỗi"
                  : toast.tone === "info"
                    ? "Thông báo"
                    : "Thành công"}
              </p>
              <p className="mt-0.5 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                {toast.message}
              </p>
            </div>

            <button
              aria-label="Đóng thông báo"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              onClick={() => setToast(null)}
              type="button"
            >
              <X size={15} />
            </button>
          </div>
        </aside>
      ) : null}
    </AppContext.Provider>
  );
}

/** Truy cập AppContext và báo lỗi sớm nếu component nằm ngoài provider. */
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp phải được dùng bên trong AppProvider");
  return value;
}
