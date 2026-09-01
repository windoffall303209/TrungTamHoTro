"use client";

import { ArrowLeft, ArrowRight, BookOpenCheck, Check, Eye, EyeOff, GraduationCap, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, publicApiUrl } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-4 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent)]/15";

function GoogleMark() {
  return <svg aria-hidden="true" height="18" viewBox="0 0 18 18" width="18"><path d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.715v2.259h2.909c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4" /><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.036-3.714H.956v2.332A9 9 0 0 0 9 18Z" fill="#34A853" /><path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.167.282-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.008-2.332Z" fill="#FBBC05" /><path d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.463.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.008 2.332C4.672 5.165 6.656 3.58 9 3.58Z" fill="#EA4335" /></svg>;
}

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { authenticated, authLoading, completeGoogleMfa, completeMfa, login, register } = useApp();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [mfaValue, setMfaValue] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [pendingEmailConflict, setPendingEmailConflict] = useState(false);
  const [googleMfa, setGoogleMfa] = useState(false);

  useEffect(() => {
    if (!authLoading && authenticated) router.replace("/dashboard");
  }, [authenticated, authLoading, router]);
  useEffect(() => {
    if (mode !== "login") return;
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get("googleError");
    const messages: Record<string, string> = {
      cancelled: "Bạn đã hủy đăng nhập Google.",
      invalid_callback: "Google trả về yêu cầu đăng nhập không hợp lệ. Hãy thử lại.",
      account_conflict: "Email Google đang liên kết với một tài khoản khác. Hãy liên hệ quản trị viên.",
      account_blocked: "Tài khoản liên kết với Google đang bị khóa hoặc chưa được kích hoạt.",
      expired: "Phiên đăng nhập Google đã hết hạn. Hãy thử lại.",
      provider_failed: "Không thể kết nối Google lúc này. Hãy thử lại sau.",
    };
    window.queueMicrotask(() => {
      if (googleError) setError(messages[googleError] ?? messages.provider_failed!);
      if (params.get("googleMfa") === "1") { setGoogleMfa(true); setChallengeToken("google-cookie"); }
    });
  }, [mode]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setPendingEmailConflict(false);
    if (mode === "register" && password !== confirmPassword) { setError("Mật khẩu xác nhận chưa trùng khớp."); return; }
    setSubmitting(true);
    try {
      if (challengeToken) {
        if (googleMfa) await completeGoogleMfa(mfaValue, useRecoveryCode);
        else await completeMfa(challengeToken, mfaValue, rememberMe, useRecoveryCode);
      } else if (mode === "login") {
        const result = await login({ username, password, rememberMe });
        if (result.requiresMfa && result.challengeToken) { setChallengeToken(result.challengeToken); return; }
      } else {
        const result = await register({ username, displayName, email, password });
        router.replace(`/verify-email?verificationId=${encodeURIComponent(result.verificationId)}&email=${encodeURIComponent(result.email)}`);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (caught) {
      if (caught instanceof ApiError) {
        const details = typeof caught.details === "object" && caught.details !== null ? caught.details as Record<string, unknown> : {};
        setPendingEmailConflict(details.code === "EMAIL_PENDING_VERIFICATION");
        if (details.code === "EMAIL_VERIFICATION_REQUIRED" && typeof details.verificationId === "string") {
          const pendingEmail = typeof details.email === "string" ? details.email : "";
          router.replace(`/verify-email?verificationId=${encodeURIComponent(details.verificationId)}&email=${encodeURIComponent(pendingEmail)}`);
          return;
        }
        setError(caught.message);
      } else setError("Không thể kết nối hệ thống. Hãy thử lại.");
    } finally { setSubmitting(false); }
  }

  const registering = mode === "register";
  return <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:grid-cols-[minmax(22rem,0.82fr)_minmax(34rem,1.18fr)]">
    <section className="relative hidden overflow-hidden bg-[var(--nav)] px-12 py-10 text-[var(--nav-text)] lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-x-0 top-[38%] border-t border-white/12" /><div className="absolute inset-x-0 top-[64%] border-t border-white/8" />
      <Link className="relative inline-flex items-center gap-3" href="/login"><span className="grid size-11 place-items-center rounded-xl bg-[var(--accent)]"><GraduationCap size={22} /></span><span><strong className="block text-lg">Wind EDU</strong><small className="text-[var(--nav-muted)]">Trung tâm hỗ trợ giảng dạy</small></span></Link>
      <div className="relative max-w-lg py-16"><h1 className="text-4xl font-bold leading-tight tracking-[-0.035em]">Một tài khoản,<br />toàn bộ hành trình dạy và học.</h1><p className="mt-6 max-w-md text-base leading-7 text-[var(--nav-muted)]">Học liệu, đề thi, diễn đàn và lớp học trực tuyến cùng vận hành trong một không gian có phân quyền rõ ràng.</p><div className="mt-10 space-y-4 border-t border-white/15 pt-7 text-sm font-semibold text-[var(--nav-muted)]"><p className="flex items-center gap-3"><BookOpenCheck className="text-[var(--accent)]" size={18} />Dữ liệu học tập xuyên suốt giữa các vai trò</p><p className="flex items-center gap-3"><ShieldCheck className="text-[var(--accent)]" size={18} />Phiên đăng nhập bảo mật và quyền truy cập tách biệt</p></div></div>
      <p className="relative text-xs text-[var(--nav-subtle)]">Wind EDU · Sổ giáo vụ số</p>
    </section>
    <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
      <div className="w-full max-w-[30rem] animate-rise">
        <Link className="mb-10 inline-flex items-center gap-2 font-bold lg:hidden" href="/login"><GraduationCap className="text-[var(--accent)]" size={24} />Wind EDU</Link>
        <h1 className="text-[2rem] font-bold leading-tight tracking-[-0.03em]">{challengeToken ? "Xác thực hai bước" : registering ? "Tạo tài khoản học viên" : "Chào mừng quay lại"}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{challengeToken ? "Nhập mã từ ứng dụng xác thực để hoàn tất đăng nhập." : registering ? "Bắt đầu học tập và tham gia lớp trên Wind EDU." : "Đăng nhập để tiếp tục công việc trong trung tâm."}</p>
        <form className="mt-8 space-y-5" onSubmit={(event) => void submit(event)}>
          {challengeToken ? <>
            <label className="block text-sm font-bold">{useRecoveryCode ? "Mã khôi phục" : "Mã xác thực"}<span className="relative block"><input autoComplete="one-time-code" autoFocus className={`${fieldClass} pr-12 font-mono tracking-[0.18em]`} inputMode={useRecoveryCode ? "text" : "numeric"} maxLength={useRecoveryCode ? 11 : 6} onChange={(event) => setMfaValue(event.target.value.toUpperCase())} placeholder={useRecoveryCode ? "ABCDE-12345" : "000000"} required value={mfaValue} /><KeyRound className="absolute right-4 top-[calc(50%+0.25rem)] -translate-y-1/2 text-[var(--ink-muted)]" size={18} /></span></label>
            <button className="text-link text-sm" onClick={() => { setUseRecoveryCode((value) => !value); setMfaValue(""); }} type="button">{useRecoveryCode ? "Dùng mã từ ứng dụng xác thực" : "Dùng mã khôi phục"}</button>
          </> : <>
            {registering ? <label className="block text-sm font-bold">Họ và tên<input autoComplete="name" className={fieldClass} minLength={2} onChange={(event) => setDisplayName(event.target.value)} placeholder="Nguyễn Văn An" required value={displayName} /></label> : null}
            <label className="block text-sm font-bold">Tài khoản<input autoCapitalize="none" autoComplete="username" className={fieldClass} maxLength={registering ? 32 : 191} minLength={4} onChange={(event) => setUsername(event.target.value.toLowerCase())} pattern={registering ? "[A-Za-z0-9][A-Za-z0-9._\\-]{3,31}" : undefined} placeholder={registering ? "nguyenvanan" : "admin@wind.edu.vn"} required spellCheck={false} value={username} />{registering ? <span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--ink-muted)]">Dùng để đăng nhập. Có 4–32 ký tự, gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.</span> : <span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--ink-muted)]">Tài khoản cũ đăng nhập bằng địa chỉ email.</span>}</label>
            {registering ? <label className="block text-sm font-bold">Email xác minh<input autoComplete="email" className={fieldClass} onChange={(event) => setEmail(event.target.value)} placeholder="ten@wind.edu.vn" required type="email" value={email} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--ink-muted)]">Hệ thống sẽ gửi mã 6 số và liên kết xác minh tới địa chỉ này.</span></label> : null}
            <label className="block text-sm font-bold">Mật khẩu<span className="relative block"><input autoComplete={registering ? "new-password" : "current-password"} className={`${fieldClass} pr-12`} minLength={8} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-1 top-[calc(50%+0.25rem)] grid size-11 -translate-y-1/2 place-items-center rounded-lg text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
            {registering ? <><label className="block text-sm font-bold">Xác nhận mật khẩu<input autoComplete="new-password" className={fieldClass} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type={showPassword ? "text" : "password"} value={confirmPassword} /></label><div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-[var(--ink-soft)]"><span className="flex items-center gap-1.5"><Check size={13} />Chữ hoa và chữ thường</span><span className="flex items-center gap-1.5"><Check size={13} />Số và ký tự đặc biệt</span></div></> : <div className="flex items-center justify-between gap-4"><label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-[var(--ink-soft)]"><input checked={rememberMe} className="size-4 accent-[var(--accent)]" onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" />Duy trì đăng nhập</label><Link className="text-link text-sm" href="/forgot-password">Quên mật khẩu?</Link></div>}
          </>}
          {error ? <div className="border-y border-[var(--danger)]/35 bg-[var(--danger-soft)]/45 px-4 py-3 text-sm font-semibold leading-6 text-[var(--danger-deep)]" role="alert"><p>{error}</p>{pendingEmailConflict ? <div className="mt-3 flex flex-wrap gap-3"><Link className="rounded-lg bg-[var(--action)] px-3 py-2 text-xs font-bold text-[var(--action-ink)]" href="/login">Tiếp tục xác minh tài khoản hiện có</Link><button className="rounded-lg border border-[var(--danger)]/35 px-3 py-2 text-xs font-bold" onClick={() => { setEmail(""); setError(""); setPendingEmailConflict(false); }} type="button">Dùng email khác</button></div> : null}</div> : null}
          <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--action)] px-5 text-sm font-bold text-[var(--action-ink)] transition hover:bg-[var(--action-hover)] disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} type="submit">{submitting ? <><LoaderCircle className="animate-spin" size={18} />Đang xử lý…</> : <>{challengeToken ? "Xác nhận" : registering ? "Tạo tài khoản" : "Đăng nhập"}<ArrowRight size={17} /></>}</button>
          {!challengeToken ? <><div className="flex items-center gap-4" aria-hidden="true"><span className="h-px flex-1 bg-[var(--rule)]" /><span className="text-xs font-semibold text-[var(--ink-muted)]">hoặc</span><span className="h-px flex-1 bg-[var(--rule)]" /></div><a className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-5 text-sm font-bold text-[var(--ink)] transition hover:border-[var(--rule-strong)] hover:bg-[var(--canvas)] focus:outline-none focus:ring-3 focus:ring-[var(--accent)]/20" href={publicApiUrl(`/auth/google/start?rememberMe=${rememberMe ? "true" : "false"}`)}><GoogleMark />Tiếp tục với Google</a><p className="text-center text-xs leading-5 text-[var(--ink-muted)]">Google xác nhận email tự động; tài khoản mới không cần tạo mật khẩu.</p></> : null}
          {challengeToken ? <button className="mx-auto flex items-center gap-2 text-sm font-bold text-[var(--ink-soft)]" onClick={() => { setChallengeToken(""); setGoogleMfa(false); setMfaValue(""); }} type="button"><ArrowLeft size={15} />Quay lại đăng nhập</button> : null}
        </form>
        {!challengeToken ? <><p className="mt-7 text-center text-sm text-[var(--ink-soft)]">{registering ? "Đã có tài khoản?" : "Bạn là học viên mới?"} <Link className="text-link ml-1" href={registering ? "/login" : "/register"}>{registering ? "Đăng nhập" : "Tạo tài khoản"}</Link></p>{!registering ? <p className="mt-4 text-center text-xs leading-5 text-[var(--ink-muted)]">Tài khoản quản trị, quản lý trung tâm và giảng viên do quản trị viên cấp.</p> : null}</> : null}
      </div>
    </section>
  </main>;
}
