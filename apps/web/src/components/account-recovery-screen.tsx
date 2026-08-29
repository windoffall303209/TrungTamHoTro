"use client";

import { ArrowLeft, CheckCircle2, GraduationCap, LoaderCircle, MailCheck, RefreshCw } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-[#a9bac1] bg-[#fffdfa] px-4 text-base text-[#102a43] outline-none transition placeholder:text-[#80909b] focus:border-[#c75b39] focus:ring-3 focus:ring-[#c75b39]/15";

function announceVerification(verificationId: string): void {
  const message = { verificationId, verifiedAt: new Date().toISOString() };
  localStorage.setItem("wind-edu:email-verified", JSON.stringify(message));
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("wind-edu:email-verification");
    channel.postMessage(message);
    channel.close();
  }
}

function maskedEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email || "email của bạn";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(name.length - 2, 5)))}@${domain}`;
}

export function AccountRecoveryScreen({ mode }: { mode: "forgot" | "reset" | "verify" }) {
  const [email, setEmail] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(mode === "verify");
  const [done, setDone] = useState(false);
  const [linkVerified, setLinkVerified] = useState(false);
  const [error, setError] = useState("");

  const finishVerification = useCallback((id: string, fromLink = false) => {
    announceVerification(id);
    setLinkVerified(fromLink);
    setDone(true);
    window.queueMicrotask(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (mode !== "verify") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";
    const id = params.get("verificationId") ?? "";
    const pendingEmail = params.get("email") ?? "";
    window.queueMicrotask(() => {
      setEmail(pendingEmail);
      setVerificationId(id);
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

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
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
        ? `Nhập mã 6 số đã gửi tới ${maskedEmail(email)} hoặc mở liên kết xác minh trong email.`
        : "Hệ thống đang kiểm tra liên kết xác minh một lần.";

  return <main className="grid min-h-screen place-items-center bg-[#f7f4ed] px-5 py-10 text-[#102a43]">
    <section className="w-full max-w-[31rem] border-y border-[#a9bac1] bg-[#fffdfa]/75 px-5 py-8 sm:px-8">
      <Link className="mb-9 inline-flex items-center gap-2 font-bold" href="/login"><GraduationCap className="text-[#c75b39]" size={24} />Wind EDU</Link>
      {done ? <div aria-live="polite">
        <CheckCircle2 className="text-[#27685f]" size={34} />
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">{mode === "forgot" ? "Hãy kiểm tra hộp thư" : mode === "reset" ? "Đã đổi mật khẩu" : "Email đã được xác minh"}</h1>
        <p className="mt-3 text-sm leading-6 text-[#516274]">{mode === "forgot"
          ? "Nếu tài khoản tồn tại, email hướng dẫn đã được gửi. Thông báo này không tiết lộ email có trong hệ thống hay không."
          : mode === "verify" && linkVerified
            ? "Trang xác minh ban đầu sẽ tự cập nhật. Bạn có thể đóng trang này và quay lại để đăng nhập."
            : "Bạn có thể quay lại đăng nhập và tiếp tục sử dụng Wind EDU."}</p>
        <Link className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#102a43] px-5 text-sm font-bold text-white" href="/login"><ArrowLeft size={16} />Về trang đăng nhập</Link>
      </div> : <>
        <MailCheck className="text-[#c75b39]" size={32} />
        <h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[#516274]">{description}</p>
        {mode !== "verify" || verificationId ? <form className="mt-7 space-y-5" onSubmit={(event) => void submit(event)}>
          {mode === "forgot" ? <label className="block text-sm font-bold">Email tài khoản<input autoComplete="email" className={fieldClass} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label> : null}
          {mode === "reset" ? <>
            <label className="block text-sm font-bold">Mật khẩu mới<input autoComplete="new-password" className={fieldClass} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
            <label className="block text-sm font-bold">Nhập lại mật khẩu<input autoComplete="new-password" className={fieldClass} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
            <p className="text-xs leading-5 text-[#657789]">Dùng từ 8–128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</p>
          </> : null}
          {mode === "verify" ? <>
            <label className="block text-sm font-bold">Mã xác minh 6 số<input autoComplete="one-time-code" autoFocus className={`${fieldClass} text-center font-mono text-xl font-bold tracking-[0.32em]`} inputMode="numeric" maxLength={6} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required value={verificationCode} /></label>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-5 text-[#657789]"><span>Không nhận được mã?</span><button className="inline-flex min-h-10 items-center gap-2 font-bold text-[#102a43] underline decoration-[#c75b39] underline-offset-4 disabled:opacity-50" disabled={loading || !email} onClick={() => void resendCode()} type="button"><RefreshCw size={14} />Gửi mã mới</button></div>
          </> : null}
          {error ? <p className="border-y border-[#a84343]/35 bg-[#f4dddd]/45 px-4 py-3 text-sm font-semibold text-[#873737]" role="alert">{error}</p> : null}
          <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#102a43] px-5 text-sm font-bold text-white disabled:opacity-60" disabled={loading || (mode === "verify" && !/^\d{6}$/.test(verificationCode))} type="submit">{loading ? <><LoaderCircle className="animate-spin" size={17} />Đang xử lý…</> : mode === "forgot" ? "Gửi liên kết khôi phục" : mode === "reset" ? "Lưu mật khẩu mới" : "Xác minh email"}</button>
        </form> : <div className="mt-7" aria-live="polite">{loading ? <p className="flex items-center gap-2 text-sm font-semibold"><LoaderCircle className="animate-spin" size={18} />Đang xác minh…</p> : error ? <p className="border-y border-[#a84343]/35 bg-[#f4dddd]/45 px-4 py-3 text-sm font-semibold text-[#873737]" role="alert">{error}</p> : null}</div>}
        <Link className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#516274]" href="/login"><ArrowLeft size={15} />Quay lại đăng nhập</Link>
      </>}
    </section>
  </main>;
}
