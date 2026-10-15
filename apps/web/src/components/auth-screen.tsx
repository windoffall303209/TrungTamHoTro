"use client";

import { ArrowLeft, ArrowRight, BookOpenCheck, Eye, EyeOff, GraduationCap, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { saveAccountSetup } from "@/lib/account-setup";
import { ApiError } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { LanguageSwitcher } from "@/components/language-switcher";

const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-4 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent)]/15";

/** Màn hình đăng nhập bằng tài khoản được cấp, gồm bước MFA/recovery khi tài khoản bật xác thực hai bước. */
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

  // Chuyển người đã có phiên ra dashboard để tránh quay lại form xác thực.
  useEffect(() => {
    if (!authLoading && authenticated) router.replace("/dashboard");
  }, [authenticated, authLoading, router]);

  // Báo xác thực thành công khi người dùng được chuyển về từ trang xác thực tài khoản.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("verified") !== "1") return;
    window.queueMicrotask(() => setNotice("Tài khoản đã được xác thực. Hãy đăng nhập lại bằng tài khoản và mật khẩu mới."));
  }, []);

  /** Điều phối đăng nhập hoặc bước MFA, chuyển tài khoản tạm hoặc tài khoản chờ xác minh email sang màn hình xác thực. */
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (challengeToken) await completeMfa(challengeToken, mfaValue, rememberMe, useRecoveryCode);
      else {
        const result = await login({ username, password, rememberMe });
        if (result.requiresMfa && result.challengeToken) { setChallengeToken(result.challengeToken); return; }
        // Tài khoản tạm chưa xác thực chưa có phiên đăng nhập; trang xác thực dùng mã phiên xác thực lưu theo thẻ.
        if (result.accountSetup) { saveAccountSetup(result.accountSetup); router.replace("/verify-account"); return; }
      }
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = typeof caught.details === "object" && caught.details !== null ? caught.details as Record<string, unknown> : {};
        if (details.code === "EMAIL_VERIFICATION_REQUIRED" && typeof details.verificationId === "string") {
          const pendingEmail = typeof details.email === "string" ? details.email : "";
          router.replace(`/verify-email?verificationId=${encodeURIComponent(details.verificationId)}&email=${encodeURIComponent(pendingEmail)}`);
          return;
        }
        setError(caught.message);
      } else setError("Không thể kết nối hệ thống. Hãy thử lại.");
    } finally { setSubmitting(false); }
  }

  return <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:grid-cols-[minmax(22rem,0.82fr)_minmax(34rem,1.18fr)]">
    <section className="relative hidden overflow-hidden bg-[var(--nav)] px-12 py-10 text-[var(--nav-text)] lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-x-0 top-[38%] border-t border-white/12" /><div className="absolute inset-x-0 top-[64%] border-t border-white/8" />
      <Link className="relative inline-flex items-center gap-3" href="/login"><span className="grid size-11 place-items-center rounded-xl bg-[var(--accent)]"><GraduationCap size={22} /></span><span><strong className="block text-lg">Wind EDU</strong><small className="text-[var(--nav-muted)]">Trung tâm hỗ trợ giảng dạy</small></span></Link>
      <div className="relative max-w-lg py-16"><h1 className="text-4xl font-bold leading-tight tracking-[-0.035em]">Một tài khoản,<br />toàn bộ hành trình dạy và học.</h1><p className="mt-6 max-w-md text-base leading-7 text-[var(--nav-muted)]">Học liệu, đề thi, diễn đàn và lớp học trực tuyến cùng vận hành trong một không gian có phân quyền rõ ràng.</p><div className="mt-10 space-y-4 border-t border-white/15 pt-7 text-sm font-semibold text-[var(--nav-muted)]"><p className="flex items-center gap-3"><BookOpenCheck className="text-[var(--accent)]" size={18} />Dữ liệu học tập xuyên suốt giữa các vai trò</p><p className="flex items-center gap-3"><ShieldCheck className="text-[var(--accent)]" size={18} />Phiên đăng nhập bảo mật và quyền truy cập tách biệt</p></div></div>
      <p className="relative text-xs text-[var(--nav-subtle)]">Wind EDU · Sổ giáo vụ số</p>
    </section>
    <section className="relative flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
      <div className="absolute right-5 top-5 z-20 sm:right-10 sm:top-8"><LanguageSwitcher /></div>
      <div className="w-full max-w-[30rem] animate-rise">
        <Link className="mb-10 inline-flex items-center gap-2 font-bold lg:hidden" href="/login"><GraduationCap className="text-[var(--accent)]" size={24} />Wind EDU</Link>
        <h1 className="text-[2rem] font-bold leading-tight tracking-[-0.03em]">{challengeToken ? "Xác thực hai bước" : "Chào mừng quay lại"}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{challengeToken ? "Nhập mã từ ứng dụng xác thực để hoàn tất đăng nhập." : "Đăng nhập để tiếp tục công việc trong trung tâm."}</p>
        {notice && !challengeToken ? <p className="mt-6 border-y border-[var(--success)]/30 bg-[var(--success-soft)]/55 px-4 py-3 text-sm font-semibold leading-6 text-[var(--success-deep)]" role="status">{notice}</p> : null}
        <form className="mt-8 space-y-5" onSubmit={(event) => void submit(event)}>
          {challengeToken ? <>
            <label className="block text-sm font-bold">{useRecoveryCode ? "Mã khôi phục" : "Mã xác thực"}<span className="relative block"><input autoComplete="one-time-code" autoFocus className={`${fieldClass} pr-12 font-mono tracking-[0.18em]`} inputMode={useRecoveryCode ? "text" : "numeric"} maxLength={useRecoveryCode ? 11 : 6} onChange={(event) => setMfaValue(event.target.value.toUpperCase())} placeholder={useRecoveryCode ? "ABCDE-12345" : "000000"} required value={mfaValue} /><KeyRound className="absolute right-4 top-[calc(50%+0.25rem)] -translate-y-1/2 text-[var(--ink-muted)]" size={18} /></span></label>
            <button className="text-link text-sm" onClick={() => { setUseRecoveryCode((value) => !value); setMfaValue(""); }} type="button">{useRecoveryCode ? "Dùng mã từ ứng dụng xác thực" : "Dùng mã khôi phục"}</button>
          </> : <>
            <label className="block text-sm font-bold">Tài khoản<input autoCapitalize="none" autoComplete="username" className={fieldClass} maxLength={191} minLength={4} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="admin@wind.edu.vn" required spellCheck={false} value={username} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--ink-muted)]">Tài khoản cũ đăng nhập bằng địa chỉ email.</span></label>
            <label className="block text-sm font-bold">Mật khẩu<span className="relative block"><input autoComplete="current-password" className={`${fieldClass} pr-12`} minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-1 top-[calc(50%+0.25rem)] grid size-11 -translate-y-1/2 place-items-center rounded-lg text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
            <div className="flex items-center justify-between gap-4"><label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-[var(--ink-soft)]"><input checked={rememberMe} className="size-4 accent-[var(--accent)]" onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />Duy trì đăng nhập</label><Link className="text-link text-sm" href="/forgot-password">Quên mật khẩu?</Link></div>
          </>}
          {error ? <div className="border-y border-[var(--danger)]/35 bg-[var(--danger-soft)]/45 px-4 py-3 text-sm font-semibold leading-6 text-[var(--danger-deep)]" role="alert"><p>{error}</p></div> : null}
          <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--action)] px-5 text-sm font-bold text-[var(--action-ink)] transition hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? <><LoaderCircle className="animate-spin" size={18} />Đang xử lý…</> : <>{challengeToken ? "Xác nhận" : "Đăng nhập"}<ArrowRight size={17} /></>}</button>
          {challengeToken ? <button className="mx-auto flex items-center gap-2 text-sm font-bold text-[var(--ink-soft)]" onClick={() => { setChallengeToken(""); setMfaValue(""); }} type="button"><ArrowLeft size={15} />Quay lại đăng nhập</button> : null}
        </form>
        {!challengeToken ? <p className="mt-7 text-center text-xs leading-5 text-[var(--ink-muted)]">Tài khoản do quản trị hệ thống hoặc quản lý trung tâm cấp. Hãy liên hệ trung tâm nếu bạn chưa có tài khoản.</p> : null}
      </div>
    </section>
  </main>;
}
