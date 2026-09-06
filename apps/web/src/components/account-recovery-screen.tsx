"use client";

import { ArrowLeft, CheckCircle2, GraduationCap, LoaderCircle, MailCheck, PencilLine, RefreshCw } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { LanguageSwitcher } from "@/components/language-switcher";

const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-4 text-base text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent)]/15";

/** Phát trạng thái xác minh sang các tab bằng localStorage và BroadcastChannel. */
function announceVerification(verificationId: string): void {
  const message = { verificationId, verifiedAt: new Date().toISOString() };
  localStorage.setItem("wind-edu:email-verified", JSON.stringify(message));
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("wind-edu:email-verification");
    channel.postMessage(message);
    channel.close();
  }
}

/** Che phần tên email nhưng giữ domain để người dùng nhận biết hộp thư. */
function maskedEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email || "email của bạn";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(name.length - 2, 5)))}@${domain}`;
}

/** State machine dùng chung cho quên mật khẩu, đặt lại mật khẩu và xác minh/đổi email. */
export function AccountRecoveryScreen({ mode }: { mode: "forgot" | "reset" | "verify" }) {
  const [email, setEmail] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [loading, setLoading] = useState(mode === "verify");
  const [done, setDone] = useState(false);
  const [linkVerified, setLinkVerified] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /** Chốt giao diện xác minh và báo các tab khác dừng polling. */
  const finishVerification = useCallback((id: string, fromLink = false) => {
    announceVerification(id);
    setLinkVerified(fromLink);
    setDone(true);
    window.queueMicrotask(() => setLoading(false));
  }, []);

  // Link token được xử lý một lần; luồng mã số polling và nghe thông báo chéo tab theo best-effort.
  useEffect(() => {
    if (mode !== "verify") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";
    const id = params.get("verificationId") ?? "";
    const pendingEmail = params.get("email") ?? "";
    window.queueMicrotask(() => {
      setEmail(pendingEmail);
      setVerificationId(id);
      if (params.get("emailChanged") === "1") setNotice("Đã cập nhật email và gửi một mã xác minh mới.");
    });

    if (token) {
      apiRequest<{ verified: true; verificationId: string }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
        .then((result) => finishVerification(result.verificationId, true))
        .catch((caught: unknown) => { setError(caught instanceof Error ? caught.message : "Không thể xác minh email."); setLoading(false); });
      return;
    }
    if (!id) {
      window.queueMicrotask(() => {
        setError("Phiên xác minh không hợp lệ. Hãy đăng nhập lại để tiếp tục xác minh.");
        setLoading(false);
      });
      return;
    }
    window.queueMicrotask(() => setLoading(false));

    /** Thăm dò trạng thái challenge để tab hiện tại nhận biết xác minh hoàn tất ở tab khác. */
    const checkStatus = async () => {
      try {
        const result = await apiRequest<{ verified: boolean; expired: boolean }>(`/auth/verification-status?verificationId=${encodeURIComponent(id)}`);
        if (result.verified) finishVerification(id);
        else if (result.expired) setError("Mã xác minh đã hết hạn. Hãy yêu cầu gửi mã mới.");
      } catch {
        // Polling is best-effort; direct code submission still reports actionable errors.
      }
    };
    void checkStatus();
    const timer = window.setInterval(() => void checkStatus(), 3000);
    /** Nhận tín hiệu xác minh qua storage event giữa các tab cùng origin. */
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "wind-edu:email-verified" || !event.newValue) return;
      try {
        const message = JSON.parse(event.newValue) as { verificationId?: string };
        if (message.verificationId === id) finishVerification(id);
      } catch {
        // Ignore malformed cross-tab messages.
      }
    };
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("wind-edu:email-verification") : null;
    if (channel) channel.onmessage = (event: MessageEvent<{ verificationId?: string }>) => {
      if (event.data.verificationId === id) finishVerification(id);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [finishVerification, mode]);

  /** Điều phối submit theo mode và thay URL khi đổi sang phiên xác minh email mới. */
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    setNotice("");
    if (mode === "reset" && password !== confirmPassword) {
      setError("Mật khẩu xác nhận chưa trùng khớp.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "forgot") {
        await apiRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
        setDone(true);
      } else if (mode === "reset") {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        await apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword: password }) });
        setDone(true);
      } else if (editingEmail) {
        const result = await apiRequest<{ verificationRequired: true; verificationId: string; email: string; verificationEmailSent: boolean }>("/auth/verification-email/change", {
          method: "POST",
          body: JSON.stringify({ verificationId, newEmail, password: currentPassword }),
        });
        const url = new URL(window.location.href);
        url.searchParams.delete("token");
        url.searchParams.set("verificationId", result.verificationId);
        url.searchParams.set("email", result.email);
        url.searchParams.set("emailChanged", "1");
        window.location.replace(url.toString());
        return;
      } else {
        const result = await apiRequest<{ verified: true; verificationId: string }>("/auth/verify-email/code", {
          method: "POST",
          body: JSON.stringify({ verificationId, code: verificationCode }),
        });
        finishVerification(result.verificationId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể xử lý yêu cầu.");
    } finally {
      setLoading(false);
    }
  }

  /** Gửi lại mã; nếu server xoay verificationId thì thay URL để state/polling dùng id mới. */
  async function resendCode(): Promise<void> {
    if (!email || !verificationId) return;
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ accepted: true; verificationId?: string }>("/auth/verification-email/resend", {
        method: "POST",
        body: JSON.stringify({ identifier: email, verificationId }),
      });
      if (result.verificationId) {
        const url = new URL(window.location.href);
        url.searchParams.set("verificationId", result.verificationId);
        window.location.replace(url.toString());
        return;
      }
      setVerificationCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể gửi lại mã xác minh.");
    } finally {
      setLoading(false);
    }
  }

  const title = mode === "forgot" ? "Khôi phục tài khoản" : mode === "reset" ? "Đặt mật khẩu mới" : "Xác minh email";
  const description = mode === "forgot"
    ? "Nhập email đã liên kết với tài khoản. Hệ thống sẽ gửi liên kết có hiệu lực trong 30 phút."
    : mode === "reset"
      ? "Mật khẩu mới sẽ đóng toàn bộ phiên đăng nhập cũ."
      : verificationId
        ? "Nhập mã 6 số hoặc mở liên kết xác minh trong email. Trang này tự cập nhật khi liên kết được mở ở thẻ khác."
        : "Hệ thống đang kiểm tra liên kết xác minh một lần.";

  const submitDisabled = loading || (mode === "verify" && (editingEmail
    ? !newEmail || currentPassword.length < 8
    : !/^\d{6}$/.test(verificationCode)));

  return <main className="relative grid min-h-screen place-items-center bg-[var(--canvas)] px-5 py-10 text-[var(--ink)]">
    <div className="absolute right-5 top-5 sm:right-10 sm:top-8"><LanguageSwitcher /></div>
    <section className="w-full max-w-[31rem] border-y border-[var(--rule-strong)] bg-[var(--surface)]/75 px-5 py-8 sm:px-8">
      <Link className="mb-9 inline-flex items-center gap-2 font-bold" href="/login"><GraduationCap className="text-[var(--accent)]" size={24} />Wind EDU</Link>
      {done ? <div aria-live="polite">
        <CheckCircle2 className="text-[var(--success)]" size={34} />
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">{mode === "forgot" ? "Hãy kiểm tra hộp thư" : mode === "reset" ? "Đã đổi mật khẩu" : "Email đã được xác minh"}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{mode === "forgot"
          ? "Nếu tài khoản tồn tại, email hướng dẫn đã được gửi. Thông báo này không tiết lộ email có trong hệ thống hay không."
          : mode === "verify" && linkVerified
            ? "Trang xác minh ban đầu sẽ tự cập nhật. Bạn có thể đóng trang này và quay lại để đăng nhập."
            : "Bạn có thể quay lại đăng nhập và tiếp tục sử dụng Wind EDU."}</p>
        <Link className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--action)] px-5 text-sm font-bold text-[var(--action-ink)]" href="/login"><ArrowLeft size={16} />Về trang đăng nhập</Link>
      </div> : <>
        <MailCheck className="text-[var(--accent)]" size={32} />
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{description}</p>
        {notice ? <p className="mt-5 border-y border-[var(--success)]/30 bg-[var(--success-soft)]/55 px-4 py-3 text-sm font-semibold text-[var(--success-deep)]" role="status">{notice}</p> : null}
        {mode !== "verify" || verificationId ? <form className="mt-7 space-y-5" onSubmit={(event) => void submit(event)}>
          {mode === "forgot" ? <label className="block text-sm font-bold">Email tài khoản<input autoComplete="email" className={fieldClass} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label> : null}
          {mode === "reset" ? <>
            <label className="block text-sm font-bold">Mật khẩu mới<input autoComplete="new-password" className={fieldClass} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
            <label className="block text-sm font-bold">Nhập lại mật khẩu<input autoComplete="new-password" className={fieldClass} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
            <p className="text-xs leading-5 text-[var(--ink-muted)]">Dùng từ 8–128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</p>
          </> : null}
          {mode === "verify" ? editingEmail ? <>
            <div className="border-y border-[var(--rule-strong)] bg-[var(--canvas)]/70 px-4 py-4">
              <p className="text-sm font-bold">Đổi email xác minh</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Mật khẩu giúp bảo vệ tài khoản nếu liên kết xác minh bị lộ. Mã và liên kết cũ sẽ ngừng hoạt động.</p>
            </div>
            <label className="block text-sm font-bold">Email mới<input autoComplete="email" autoFocus className={fieldClass} maxLength={191} onChange={(event) => setNewEmail(event.target.value)} placeholder="email-moi@example.com" required type="email" value={newEmail} /></label>
            <label className="block text-sm font-bold">Mật khẩu hiện tại<input autoComplete="current-password" className={fieldClass} minLength={8} onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
          </> : <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--rule-strong)] py-3">
              <span className="text-xs leading-5 text-[var(--ink-muted)]">Mã được gửi tới<br /><strong className="text-sm text-[var(--ink)]">{maskedEmail(email)}</strong></span>
              <button className="inline-flex min-h-10 items-center gap-2 text-xs font-bold text-[var(--ink)] underline decoration-[var(--accent)] underline-offset-4" onClick={() => { setEditingEmail(true); setNewEmail(email); setCurrentPassword(""); setVerificationCode(""); setError(""); setNotice(""); }} type="button"><PencilLine size={14} />Đổi email xác thực</button>
            </div>
            <label className="block text-sm font-bold">Mã xác minh 6 số<input autoComplete="one-time-code" autoFocus className={`${fieldClass} text-center font-mono text-xl font-bold tracking-[0.32em]`} inputMode="numeric" maxLength={6} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required value={verificationCode} /></label>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-5 text-[var(--ink-muted)]"><span>Không nhận được mã?</span><button className="inline-flex min-h-10 items-center gap-2 font-bold text-[var(--ink)] underline decoration-[var(--accent)] underline-offset-4 disabled:opacity-50" disabled={loading || !email} onClick={() => void resendCode()} type="button"><RefreshCw size={14} />Gửi mã mới</button></div>
          </> : null}
          {error ? <p className="border-y border-[var(--danger)]/35 bg-[var(--danger-soft)]/45 px-4 py-3 text-sm font-semibold text-[var(--danger-deep)]" role="alert">{error}</p> : null}
          <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--action)] px-5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-60" disabled={submitDisabled} type="submit">{loading ? <><LoaderCircle className="animate-spin" size={17} />Đang xử lý…</> : mode === "forgot" ? "Gửi liên kết khôi phục" : mode === "reset" ? "Lưu mật khẩu mới" : editingEmail ? "Lưu và gửi mã mới" : "Xác minh email"}</button>
          {mode === "verify" && editingEmail ? <button className="mx-auto flex min-h-10 items-center gap-2 text-sm font-bold text-[var(--ink-soft)]" onClick={() => { setEditingEmail(false); setCurrentPassword(""); setError(""); }} type="button"><ArrowLeft size={15} />Hủy đổi email</button> : null}
        </form> : <div className="mt-7" aria-live="polite">{loading ? <p className="flex items-center gap-2 text-sm font-semibold"><LoaderCircle className="animate-spin" size={18} />Đang xác minh…</p> : error ? <p className="border-y border-[var(--danger)]/35 bg-[var(--danger-soft)]/45 px-4 py-3 text-sm font-semibold text-[var(--danger-deep)]" role="alert">{error}</p> : null}</div>}
        <Link className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[var(--ink-soft)]" href="/login"><ArrowLeft size={15} />Quay lại đăng nhập</Link>
      </>}
    </section>
  </main>;
}
