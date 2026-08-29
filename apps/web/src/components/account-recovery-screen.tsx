"use client";

import { ArrowLeft, CheckCircle2, GraduationCap, LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

const fieldClass = "mt-2 min-h-12 w-full rounded-xl border border-[#a9bac1] bg-[#fffdfa] px-4 text-base text-[#102a43] outline-none transition placeholder:text-[#80909b] focus:border-[#c75b39] focus:ring-3 focus:ring-[#c75b39]/15";

export function AccountRecoveryScreen({ mode }: { mode: "forgot" | "reset" | "verify" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(mode === "verify");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "verify") return;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) { window.queueMicrotask(() => { setError("Liên kết xác minh không có token hợp lệ."); setLoading(false); }); return; }
    apiRequest<{ verified: true }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => setDone(true)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Không thể xác minh email."))
      .finally(() => setLoading(false));
  }, [mode]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault(); setError("");
    if (mode === "reset" && password !== confirmPassword) { setError("Mật khẩu xác nhận chưa trùng khớp."); return; }
    setLoading(true);
    try {
      if (mode === "forgot") await apiRequest("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      else {
        const token = new URLSearchParams(window.location.search).get("token") ?? "";
        await apiRequest("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword: password }) });
      }
      setDone(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể xử lý yêu cầu."); }
    finally { setLoading(false); }
  }

  const title = mode === "forgot" ? "Khôi phục tài khoản" : mode === "reset" ? "Đặt mật khẩu mới" : "Xác minh email";
  const description = mode === "forgot" ? "Nhập email đăng nhập. Hệ thống sẽ gửi liên kết có hiệu lực trong 30 phút." : mode === "reset" ? "Mật khẩu mới sẽ đóng toàn bộ phiên đăng nhập cũ." : "Hệ thống đang kiểm tra liên kết xác minh một lần.";
  return <main className="grid min-h-screen place-items-center bg-[#f7f4ed] px-5 py-10 text-[#102a43]">
    <section className="w-full max-w-[31rem] border-y border-[#a9bac1] bg-[#fffdfa]/75 px-5 py-8 sm:px-8">
      <Link className="mb-9 inline-flex items-center gap-2 font-bold" href="/login"><GraduationCap className="text-[#c75b39]" size={24} />Wind EDU</Link>
      {done ? <div aria-live="polite"><CheckCircle2 className="text-[#27685f]" size={34} /><h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">{mode === "forgot" ? "Hãy kiểm tra hộp thư" : mode === "reset" ? "Đã đổi mật khẩu" : "Email đã được xác minh"}</h1><p className="mt-3 text-sm leading-6 text-[#516274]">{mode === "forgot" ? "Nếu tài khoản tồn tại, email hướng dẫn đã được gửi. Thông báo này không tiết lộ email có trong hệ thống hay không." : "Bạn có thể quay lại đăng nhập và tiếp tục sử dụng Wind EDU."}</p><Link className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#102a43] px-5 text-sm font-bold text-white" href="/login"><ArrowLeft size={16} />Về trang đăng nhập</Link></div> : <>
        <MailCheck className="text-[#c75b39]" size={32} /><h1 className="mt-5 text-3xl font-bold tracking-[-0.03em]">{title}</h1><p className="mt-3 text-sm leading-6 text-[#516274]">{description}</p>
        {mode !== "verify" ? <form className="mt-7 space-y-5" onSubmit={(event) => void submit(event)}>
          {mode === "forgot" ? <label className="block text-sm font-bold">Email<input autoComplete="email" className={fieldClass} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label> : <><label className="block text-sm font-bold">Mật khẩu mới<input autoComplete="new-password" className={fieldClass} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label><label className="block text-sm font-bold">Nhập lại mật khẩu<input autoComplete="new-password" className={fieldClass} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label><p className="text-xs leading-5 text-[#657789]">Dùng từ 8–128 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</p></>}
          {error ? <p className="border-y border-[#a84343]/35 bg-[#f4dddd]/45 px-4 py-3 text-sm font-semibold text-[#873737]" role="alert">{error}</p> : null}
          <button className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#102a43] px-5 text-sm font-bold text-white disabled:opacity-60" disabled={loading} type="submit">{loading ? <><LoaderCircle className="animate-spin" size={17} />Đang xử lý…</> : mode === "forgot" ? "Gửi liên kết khôi phục" : "Lưu mật khẩu mới"}</button>
        </form> : <div className="mt-7" aria-live="polite">{loading ? <p className="flex items-center gap-2 text-sm font-semibold"><LoaderCircle className="animate-spin" size={18} />Đang xác minh…</p> : error ? <p className="border-y border-[#a84343]/35 bg-[#f4dddd]/45 px-4 py-3 text-sm font-semibold text-[#873737]" role="alert">{error}</p> : null}</div>}
        <Link className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#516274]" href="/login"><ArrowLeft size={15} />Quay lại đăng nhập</Link>
      </>}
    </section>
  </main>;
}
