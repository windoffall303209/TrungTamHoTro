"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, GraduationCap, LoaderCircle, MailCheck, PencilLine, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { clearAccountSetup, readAccountSetup, saveAccountSetup, type AccountSetupState } from "@/lib/account-setup";
import { ApiError, apiRequest } from "@/lib/api-client";
import { LanguageSwitcher } from "@/shared/layout/language-switcher";

const fieldClass = "mt-1.5 min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all duration-150 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/50 shadow-2xs";
const alertClass = "rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-rose-700 dark:text-rose-300";
const primaryButtonClass = "flex min-h-10 w-full shrink-0 whitespace-nowrap items-center justify-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 active:bg-sky-700 px-4 text-xs sm:text-sm font-semibold text-white shadow-xs focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:opacity-45 disabled:cursor-not-allowed transition-all duration-150";
const linkButtonClass = "inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 disabled:opacity-50 transition-colors";

interface OtpResult { challengeId: string; email: string; expiresInSeconds: number; resendAfterSeconds: number }

/** Nhận diện lỗi phiên xác thực hết hạn để đưa người dùng về đăng nhập lại bằng mật khẩu tạm. */
function isSetupExpired(error: unknown): boolean {
  if (!(error instanceof ApiError) || typeof error.details !== "object" || error.details === null) return false;
  return (error.details as Record<string, unknown>).code === "ACCOUNT_SETUP_EXPIRED";
}

/** Hai bước xác thực tài khoản được cấp: nhập email, rồi nhập OTP cùng tài khoản và mật khẩu mới. */
export function AccountSetupScreen() {
  const router = useRouter();
  const [setup, setSetup] = useState<AccountSetupState | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Khôi phục trạng thái của thẻ hiện tại khi tải lại trang; không có trạng thái thì phải đăng nhập lại.
  useEffect(() => {
    window.queueMicrotask(() => {
      const stored = readAccountSetup();
      setSetup(stored);
      setEmail(stored?.email ?? "");
      setUsername(stored?.username ?? "");
      setNow(Date.now());
      setReady(true);
    });
  }, []);

  const resendAt = setup?.resendAvailableAt ?? 0;
  // Đếm ngược thời gian chờ trước khi được nhận mã OTP mới.
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resendAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  /** Ghi trạng thái mới vào state và sessionStorage của thẻ hiện tại. */
  function updateSetup(next: AccountSetupState): void {
    saveAccountSetup(next);
    setSetup(next);
  }

  /** Hiển thị lỗi; phiên xác thực hết hạn thì xóa trạng thái để hướng dẫn đăng nhập lại. */
  function showError(caught: unknown, fallback: string): void {
    if (isSetupExpired(caught)) {
      clearAccountSetup();
      setSetup(null);
    }
    setError(caught instanceof Error ? caught.message : fallback);
  }

  /** Gửi mã OTP tới email; dùng chung cho bước nhập email và nút nhận mã mới. */
  async function requestOtp(targetEmail: string): Promise<boolean> {
    if (!setup) return false;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<OtpResult>("/auth/account-setup/otp", { method: "POST", body: JSON.stringify({ setupToken: setup.setupToken, email: targetEmail }) });
      const sentAt = Date.now();
      setNow(sentAt);
      updateSetup({ ...setup, email: result.email, challengeId: result.challengeId, resendAvailableAt: sentAt + result.resendAfterSeconds * 1000 });
      setCode("");
      return true;
    } catch (caught) {
      showError(caught, "Không gửi được mã OTP. Hãy thử lại.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  /** Bước 1: xác nhận email, gửi mã OTP rồi chuyển sang bước 2. */
  async function submitEmail(event: FormEvent): Promise<void> {
    event.preventDefault();
    await requestOtp(email);
  }

  /** Gửi lại mã OTP tới cùng email khi mã cũ hết hạn hoặc chưa nhận được. */
  async function resendOtp(): Promise<void> {
    if (setup?.email && await requestOtp(setup.email)) setNotice("Đã gửi mã OTP mới tới email của bạn.");
  }

  /** Quay lại bước 1 để nhập email khác; thời gian chờ gửi mã vẫn được giữ. */
  function changeEmail(): void {
    if (!setup) return;
    updateSetup({ setupToken: setup.setupToken, username: setup.username, resendAvailableAt: setup.resendAvailableAt });
    setCode("");
    setError("");
    setNotice("");
  }

  /** Bước 2: kiểm tra mật khẩu nhập lại, hoàn tất xác thực rồi về trang đăng nhập. */
  async function submitSetup(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!setup?.challengeId || !setup.email) return;
    setError("");
    setNotice("");
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận chưa trùng khớp.");
      return;
    }
    setLoading(true);
    try {
      await apiRequest("/auth/account-setup/complete", {
        method: "POST",
        body: JSON.stringify({ setupToken: setup.setupToken, challengeId: setup.challengeId, email: setup.email, code, username, newPassword: password }),
      });
      clearAccountSetup();
      router.replace("/login?verified=1");
    } catch (caught) {
      showError(caught, "Không thể hoàn tất xác thực. Hãy thử lại.");
      setLoading(false);
    }
  }

  const step = setup?.challengeId && setup.email ? 2 : 1;

  return <main className="relative grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-10 text-[var(--ink)]">
    <div className="absolute right-5 top-5 z-20 sm:right-10 sm:top-8"><LanguageSwitcher /></div>
    <section className="w-full max-w-[31rem] border-y border-[var(--rule-strong)] bg-[var(--surface)]/75 px-5 py-8 sm:px-8">
      <Link className="mb-9 inline-flex items-center gap-2 font-bold" href="/login"><GraduationCap className="text-[var(--accent)]" size={24} />Wind EDU</Link>
      {!ready ? <p aria-live="polite" className="flex items-center gap-2 text-sm font-semibold"><LoaderCircle className="animate-spin" size={18} />Đang tải…</p> : !setup ? <div aria-live="polite">
        <ShieldCheck className="text-[var(--accent)]" size={32} />
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">Xác thực tài khoản</h1>
        {error ? <p className={`mt-5 ${alertClass}`} role="alert">{error}</p> : <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">Phiên xác thực không còn hiệu lực. Hãy đăng nhập lại bằng tài khoản và mật khẩu tạm thời để tiếp tục.</p>}
        <Link className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--action)] px-5 text-sm font-bold text-[var(--action-ink)]" href="/login"><ArrowLeft size={16} />Về trang đăng nhập</Link>
      </div> : <>
        {step === 1 ? <ShieldCheck className="text-[var(--accent)]" size={32} /> : <MailCheck className="text-[var(--accent)]" size={32} />}
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{step === 1 ? "Bước 1/2" : "Bước 2/2"}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em]">{step === 1 ? "Xác thực tài khoản" : "Hoàn tất xác thực"}</h1>
        {step === 1 ? <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">Tài khoản của bạn chưa được xác thực. Nhập email của bạn để nhận mã OTP.</p> : null}
        {notice ? <p className="mt-5 border-y border-[var(--success)]/30 bg-[var(--success-soft)]/55 px-4 py-3 text-sm font-semibold text-[var(--success-deep)]" role="status">{notice}</p> : null}
        {step === 1 ? <form className="mt-7 space-y-5" onSubmit={(event) => void submitEmail(event)}>
          <label className="block text-sm font-bold">Email<input autoComplete="email" autoFocus className={fieldClass} maxLength={191} onChange={(event) => setEmail(event.target.value)} placeholder="ten@example.com" required type="email" value={email} /></label>
          {error ? <p className={alertClass} role="alert">{error}</p> : null}
          <button className={primaryButtonClass} disabled={loading || resendSeconds > 0} type="submit">{loading ? <><LoaderCircle className="animate-spin" size={17} />Đang xử lý…</> : <>Xác nhận{resendSeconds > 0 ? ` (${resendSeconds}s)` : null}<ArrowRight size={17} /></>}</button>
        </form> : <form className="mt-7 space-y-5" onSubmit={(event) => void submitSetup(event)}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--rule-strong)] py-3">
            <span className="text-xs leading-5 text-[var(--ink-muted)]">Mã OTP đã được gửi tới<br /><strong className="text-sm text-[var(--ink)]">{setup.email}</strong></span>
            <button className={linkButtonClass} disabled={loading} onClick={changeEmail} type="button"><PencilLine size={14} />Đổi email</button>
          </div>
          <label className="block text-sm font-bold">Tài khoản<input autoCapitalize="none" autoComplete="username" className={fieldClass} maxLength={32} minLength={4} onChange={(event) => setUsername(event.target.value.toLowerCase())} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{3,31}" required spellCheck={false} value={username} /></label>
          <label className="block text-sm font-bold">Mật khẩu mới<span className="relative block"><input autoComplete="new-password" className={`${fieldClass} pr-12`} maxLength={128} minLength={8} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-1 top-[calc(50%+0.25rem)] grid size-11 -translate-y-1/2 place-items-center rounded-lg text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          <label className="block text-sm font-bold">Nhập lại mật khẩu mới<input autoComplete="new-password" className={fieldClass} maxLength={128} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={confirmPassword} /></label>
          <p className="text-xs leading-5 text-[var(--ink-muted)]">Dùng từ 8–128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</p>
          <label className="block text-sm font-bold">Mã OTP<input autoComplete="one-time-code" className={`${fieldClass} text-center font-mono text-xl font-bold tracking-[0.32em]`} inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required value={code} /></label>
          <div className="flex justify-end"><button className={linkButtonClass} disabled={loading || resendSeconds > 0} onClick={() => void resendOtp()} type="button"><RefreshCw size={14} />Nhận mã OTP mới{resendSeconds > 0 ? ` (${resendSeconds}s)` : null}</button></div>
          {error ? <p className={alertClass} role="alert">{error}</p> : null}
          <button className={primaryButtonClass} disabled={loading || !/^\d{6}$/.test(code)} type="submit">{loading ? <><LoaderCircle className="animate-spin" size={17} />Đang xử lý…</> : <>Hoàn tất xác thực<ArrowRight size={17} /></>}</button>
        </form>}
        <Link className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[var(--ink-soft)]" href="/login"><ArrowLeft size={15} />Quay lại đăng nhập</Link>
      </>}
    </section>
  </main>;
}
