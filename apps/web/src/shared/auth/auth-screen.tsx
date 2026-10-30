"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { saveAccountSetup } from "@/lib/account-setup";
import { ApiError } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { LanguageSwitcher } from "@/shared/layout/language-switcher";
import { ThemeToggle } from "@/shared/layout/theme-toggle";

const fieldClass =
  "mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-3.5 text-sm text-slate-900 dark:text-slate-100 outline-none transition placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 shadow-2xs";

/** Màn hình đăng nhập phong cách Sky Blue hiện đại, tinh gọn và tối ưu trải nghiệm. */
export function AuthScreen() {
  const router = useRouter();
  const { authenticated, authLoading, completeMfa, login } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [mfaValue, setMfaValue] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  useEffect(() => {
    if (!authLoading && authenticated) router.replace("/dashboard");
  }, [authenticated, authLoading, router]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("verified") !== "1") return;
    window.queueMicrotask(() =>
      setNotice("Tài khoản đã được xác thực. Hãy đăng nhập lại bằng tài khoản và mật khẩu mới."),
    );
  }, []);

  /** Gửi biểu mẫu đăng nhập và điều phối các nhánh MFA hoặc thiết lập tài khoản. */
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (challengeToken) {
        await completeMfa(challengeToken, mfaValue, rememberMe, useRecoveryCode);
      } else {
        const result = await login({ username, password, rememberMe });
        if (result.requiresMfa && result.challengeToken) {
          setChallengeToken(result.challengeToken);
          return;
        }
        if (result.accountSetup) {
          saveAccountSetup(result.accountSetup);
          router.replace("/verify-account");
          return;
        }
      }
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details =
          typeof caught.details === "object" && caught.details !== null
            ? (caught.details as Record<string, unknown>)
            : {};
        if (details.code === "EMAIL_VERIFICATION_REQUIRED" && typeof details.verificationId === "string") {
          const pendingEmail = typeof details.email === "string" ? details.email : "";
          router.replace(
            `/verify-email?verificationId=${encodeURIComponent(details.verificationId)}&email=${encodeURIComponent(
              pendingEmail,
            )}`,
          );
          return;
        }
        setError(caught.message);
      } else {
        setError("Không thể kết nối hệ thống. Hãy thử lại.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--text-main)] lg:grid lg:grid-cols-[minmax(22rem,0.85fr)_minmax(34rem,1.15fr)]">
      {/* Cột trái: Giới thiệu thương hiệu màu xanh da trời sang trọng */}
      <section className="relative hidden overflow-hidden bg-[#070e1c] px-12 py-10 text-slate-100 lg:flex lg:flex-col lg:justify-between border-r border-slate-800">
        <div className="absolute -left-20 -top-20 size-80 rounded-full bg-sky-500/15 blur-3xl pointer-events-none" />
        <div className="absolute right-0 bottom-1/4 size-96 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

        <Link className="relative inline-flex items-center gap-3" href="/login">
          <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-tr from-sky-600 to-cyan-500 text-white font-bold shadow-md shadow-sky-600/30">
            <GraduationCap size={20} />
          </span>
          <span>
            <strong className="block text-lg font-bold text-white tracking-tight">Wind EDU</strong>
            <small className="text-sky-400 text-xs font-semibold">Nền tảng Giảng dạy & Học tập Số</small>
          </span>
        </Link>

        <div className="relative max-w-lg py-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-950/70 border border-sky-800/80 text-sky-300 text-xs font-semibold mb-4">
            <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
            Hệ sinh thái Giáo dục Trực tuyến
          </div>
          <h1 className="text-3xl font-extrabold leading-snug tracking-tight text-white">
            Một tài khoản,<br />
            kết nối toàn diện dạy và học.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Kho học liệu thông minh, đề thi tự động tạo bằng AI, phòng học trực tuyến và diễn đàn thảo luận tập trung.
          </p>

          <div className="mt-8 space-y-3.5 border-t border-slate-800/80 pt-6 text-xs text-slate-300">
            <p className="flex items-center gap-2.5">
              <BookOpenCheck className="text-sky-400 shrink-0" size={16} />
              Dữ liệu học tập và đề thi AI xuyên suốt các vai trò
            </p>
            <p className="flex items-center gap-2.5">
              <ShieldCheck className="text-sky-400 shrink-0" size={16} />
              Bảo mật đa tầng với xác thực hai bước và phân quyền chặt chẽ
            </p>
          </div>
        </div>

        <p className="relative text-xs text-slate-500">
          Wind EDU · Thiết kế Tối giản Hiện đại · Theme Sky Blue
        </p>
      </section>

      {/* Cột phải: Form đăng nhập */}
      <section className="relative flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="absolute right-5 top-5 z-20 flex items-center gap-2 sm:right-8 sm:top-8">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>

        <div className="w-full max-w-[28rem]">
          <Link className="mb-8 inline-flex items-center gap-2.5 font-bold lg:hidden" href="/login">
            <span className="grid size-9 place-items-center rounded-lg bg-sky-600 text-white">
              <GraduationCap size={18} />
            </span>
            <span className="text-lg font-bold">Wind EDU</span>
          </Link>

          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {challengeToken ? "Xác thực hai bước" : "Đăng nhập hệ thống"}
          </h2>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {challengeToken
              ? "Nhập mã từ ứng dụng xác thực để hoàn tất đăng nhập."
              : "Chào mừng bạn quay lại. Hãy nhập thông tin để truy cập không gian làm việc."}
          </p>

          {notice && !challengeToken ? (
            <p
              className="mt-5 rounded-lg border border-sky-200 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-950/40 px-3.5 py-2.5 text-xs font-semibold text-sky-800 dark:text-sky-300"
              role="status"
            >
              {notice}
            </p>
          ) : null}

          <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
            {challengeToken ? (
              <>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  {useRecoveryCode ? "Mã khôi phục" : "Mã xác thực"}
                  <span className="relative block">
                    <input
                      autoComplete="one-time-code"
                      autoFocus
                      className={`${fieldClass} pr-10 font-mono tracking-widest`}
                      inputMode={useRecoveryCode ? "text" : "numeric"}
                      maxLength={useRecoveryCode ? 11 : 6}
                      onChange={(event) => setMfaValue(event.target.value.toUpperCase())}
                      placeholder={useRecoveryCode ? "ABCDE-12345" : "000000"}
                      required
                      value={mfaValue}
                    />
                    <KeyRound
                      className="absolute right-3.5 top-[calc(50%+0.2rem)] -translate-y-1/2 text-slate-400"
                      size={16}
                    />
                  </span>
                </label>
                <button
                  className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                  onClick={() => {
                    setUseRecoveryCode((value) => !value);
                    setMfaValue("");
                  }}
                  type="button"
                >
                  {useRecoveryCode ? "Dùng mã từ ứng dụng xác thực" : "Dùng mã khôi phục"}
                </button>
              </>
            ) : (
              <>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Tài khoản
                  <input
                    autoCapitalize="none"
                    autoComplete="username"
                    className={fieldClass}
                    maxLength={191}
                    minLength={4}
                    onChange={(event) => setUsername(event.target.value.toLowerCase())}
                    placeholder="admin@wind.edu.vn"
                    required
                    spellCheck={false}
                    value={username}
                  />
                  <span className="mt-1 block text-[11px] font-normal text-slate-400">
                    Đăng nhập bằng tên tài khoản hoặc địa chỉ email.
                  </span>
                </label>

                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Mật khẩu
                  <span className="relative block">
                    <input
                      autoComplete="current-password"
                      className={`${fieldClass} pr-10`}
                      minLength={8}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Tối thiểu 8 ký tự"
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <button
                      aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      className="absolute right-2 top-[calc(50%+0.2rem)] -translate-y-1/2 grid size-7 place-items-center rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      onClick={() => setShowPassword((value) => !value)}
                      type="button"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </span>
                </label>

                <div className="flex items-center justify-between gap-4 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                    <input
                      checked={rememberMe}
                      className="size-3.5 rounded border-slate-300 dark:border-slate-700 accent-sky-600"
                      onChange={(event) => setRememberMe(event.target.checked)}
                      type="checkbox"
                    />
                    Duy trì đăng nhập
                  </label>
                  <Link
                    className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                    href="/forgot-password"
                  >
                    Quên mật khẩu?
                  </Link>
                </div>
              </>
            )}

            {error ? (
              <div
                className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs font-semibold text-rose-700 dark:text-rose-400"
                role="alert"
              >
                <p>{error}</p>
              </div>
            ) : null}

            <button
              className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 px-4 text-xs sm:text-sm font-semibold text-white shadow-xs shadow-sky-600/20 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting}
              type="submit"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="animate-spin" size={16} />
                  Đang xử lý…
                </>
              ) : (
                <>
                  {challengeToken ? "Xác nhận mã" : "Đăng nhập"}
                  <ArrowRight size={15} />
                </>
              )}
            </button>

            {challengeToken ? (
              <button
                className="mx-auto mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                onClick={() => {
                  setChallengeToken("");
                  setMfaValue("");
                }}
                type="button"
              >
                <ArrowLeft size={13} />
                Quay lại đăng nhập
              </button>
            ) : null}
          </form>

          {!challengeToken ? (
            <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              Tài khoản do quản trị viên hoặc trung tâm cấp. Liên hệ quản lý nếu chưa có tài khoản.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
