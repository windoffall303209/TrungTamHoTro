"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Laptop, MailCheck, RefreshCw, Save, ShieldCheck, Smartphone, Trash2, UserRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Field, StatusBadge, inputClass } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { AccountProfile, AccountSession } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";

const emptyProfile: AccountProfile = { id: "", displayName: "", email: "", phone: "", timezone: "Asia/Bangkok", locale: "vi-VN", status: "ACTIVE", emailVerifiedAt: null, mfaEnabled: false, createdAt: "" };

function deviceName(userAgent: string): { label: string; mobile: boolean } {
  if (userAgent === "Thiết bị không xác định") return { label: userAgent, mobile: false };
  const mobile = /Android|iPhone|iPad/i.test(userAgent);
  const browser = /Edg/i.test(userAgent) ? "Microsoft Edge" : /Chrome/i.test(userAgent) ? "Google Chrome" : /Firefox/i.test(userAgent) ? "Firefox" : /Safari/i.test(userAgent) ? "Safari" : "Trình duyệt khác";
  const platform = /Windows/i.test(userAgent) ? "Windows" : /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iOS/iPadOS" : /Mac OS/i.test(userAgent) ? "macOS" : "Thiết bị khác";
  return { label: `${browser} · ${platform}`, mobile };
}

export default function AccountPage() {
  const { notify, refreshSession } = useApp();
  const [profile, setProfile] = useState<AccountProfile>(emptyProfile);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileData, sessionData] = await Promise.all([
        apiRequest<AccountProfile>("/account/profile"),
        apiRequest<AccountSession[]>("/account/sessions"),
      ]);
      setProfile(profileData);
      setSessions(sessionData);
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể tải thông tin tài khoản.", "error"); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { window.queueMicrotask(() => void load()); }, [load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      setProfile(await apiRequest<AccountProfile>("/account/profile", { method: "PATCH", body: JSON.stringify({ displayName: profile.displayName, phone: profile.phone, timezone: profile.timezone, locale: profile.locale }) }));
      await refreshSession(); notify("Đã cập nhật hồ sơ cá nhân.");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể cập nhật hồ sơ.", "error"); }
    finally { setSaving(false); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) { notify("Xác nhận mật khẩu mới chưa khớp.", "error"); return; }
    setPasswordSaving(true);
    try {
      const result = await apiRequest<{ revokedSessions: number }>("/account/password", { method: "PATCH", body: JSON.stringify({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword }) });
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      notify(`Đã đổi mật khẩu và đóng ${result.revokedSessions} phiên khác.`); await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể đổi mật khẩu.", "error"); }
    finally { setPasswordSaving(false); }
  }

  async function revoke(sessionId: string) {
    try { await apiRequest<void>(`/account/sessions/${sessionId}`, { method: "DELETE" }); setSessions((items) => items.filter((item) => item.id !== sessionId)); notify("Đã thu hồi phiên đăng nhập."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể thu hồi phiên.", "error"); }
  }

  async function revokeOthers() {
    try { const result = await apiRequest<{ revokedSessions: number }>("/account/sessions/revoke-others", { method: "POST" }); notify(`Đã đóng ${result.revokedSessions} phiên khác.`); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể đóng các phiên khác.", "error"); }
  }

  async function resendVerification() {
    try { const result = await apiRequest<{ sent: boolean }>("/account/verification-email", { method: "POST" }); notify(result.sent ? "Đã gửi lại email xác minh." : "Email đã được xác minh.", "info"); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể gửi email xác minh.", "error"); }
  }

  async function startMfa() {
    try { setMfaSetup(await apiRequest<{ secret: string; otpauthUri: string }>("/account/mfa/setup", { method: "POST" })); setMfaCode(""); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể khởi tạo MFA.", "error"); }
  }

  async function confirmMfa() {
    try { const result = await apiRequest<{ recoveryCodes: string[] }>("/account/mfa/confirm", { method: "POST", body: JSON.stringify({ code: mfaCode }) }); setRecoveryCodes(result.recoveryCodes); setMfaSetup(null); setMfaCode(""); await load(); notify("Đã bật xác thực hai bước."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể bật MFA.", "error"); }
  }

  async function disableMfa() {
    try { await apiRequest("/account/mfa", { method: "DELETE", body: JSON.stringify({ password: mfaPassword, code: mfaCode }) }); setMfaPassword(""); setMfaCode(""); await load(); notify("Đã tắt xác thực hai bước.", "info"); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể tắt MFA.", "error"); }
  }

  const otherSessions = useMemo(() => sessions.filter((item) => !item.current), [sessions]);

  return <div className="workspace-enter mx-auto max-w-6xl px-4 py-8 md:px-7 md:py-10">
    <PageHeader eyebrow="Tài khoản" title="Hồ sơ & bảo mật" description="Quản lý thông tin hiển thị, mật khẩu và các thiết bị đang đăng nhập vào Wind EDU." actions={<Button loading={loading} onClick={() => void load()} variant="secondary"><RefreshCw size={16} />Làm mới</Button>} />

    <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <form className="content-panel p-5 md:p-7" onSubmit={saveProfile}>
        <div className="flex items-start gap-3"><UserRound className="mt-0.5 text-[#c75b39]" size={22} /><div><h2 className="section-title">Thông tin cá nhân</h2><p className="mt-1 text-sm leading-6 text-[#516274]">Thông tin dùng để nhận diện bạn trong lớp học, diễn đàn và báo cáo.</p></div></div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Họ và tên"><input className={inputClass} disabled={loading} maxLength={150} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} required value={profile.displayName} /></Field>
          <Field label="Email đăng nhập"><input className={inputClass} disabled readOnly value={profile.email} /><span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-normal leading-5 text-[#657789]">{profile.emailVerifiedAt ? <><MailCheck size={14} className="text-[#27685f]" />Đã xác minh</> : <>Chưa xác minh <button className="text-link font-bold" onClick={() => void resendVerification()} type="button">Gửi lại email</button></>}</span></Field>
          <Field label="Số điện thoại"><input className={inputClass} disabled={loading} inputMode="tel" maxLength={30} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="Ví dụ: 0901 234 567" value={profile.phone} /></Field>
          <Field label="Múi giờ"><select className={inputClass} disabled={loading} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })} value={profile.timezone}><option value="Asia/Bangkok">Bangkok (UTC+7)</option><option value="Asia/Ho_Chi_Minh">Hồ Chí Minh (UTC+7)</option><option value="UTC">UTC</option></select></Field>
          <Field label="Ngôn ngữ"><select className={inputClass} disabled={loading} onChange={(event) => setProfile({ ...profile, locale: event.target.value })} value={profile.locale}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option></select></Field>
          <div><p className="text-sm font-bold">Trạng thái tài khoản</p><div className="mt-3"><StatusBadge status={profile.status} /></div><p className="mt-2 text-xs text-[#657789]">Tham gia từ {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("vi-VN") : "—"}</p></div>
        </div>
        <div className="mt-7 flex justify-end"><Button loading={saving} type="submit"><Save size={16} />Lưu thay đổi</Button></div>
      </form>

      <form className="content-panel p-5 md:p-7" onSubmit={changePassword}>
        <div className="flex items-start gap-3"><KeyRound className="mt-0.5 text-[#c75b39]" size={22} /><div><h2 className="section-title">Đổi mật khẩu</h2><p className="mt-1 text-sm leading-6 text-[#516274]">Sau khi đổi, các phiên khác sẽ được đóng để bảo vệ tài khoản.</p></div></div>
        <div className="mt-6 space-y-5">
          <Field label="Mật khẩu hiện tại"><input autoComplete="current-password" className={inputClass} minLength={8} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} required type="password" value={passwords.currentPassword} /></Field>
          <Field label="Mật khẩu mới"><input autoComplete="new-password" className={inputClass} minLength={8} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} required type="password" value={passwords.newPassword} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[#657789]">Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</span></Field>
          <Field label="Nhập lại mật khẩu mới"><input autoComplete="new-password" className={inputClass} minLength={8} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} required type="password" value={passwords.confirmPassword} /></Field>
        </div>
        <div className="mt-7 flex justify-end"><Button loading={passwordSaving} type="submit"><ShieldCheck size={16} />Đổi mật khẩu</Button></div>
      </form>
    </div>

    <section className="content-panel mt-7 p-5 md:p-7">
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 text-[#c75b39]" size={22} /><div><h2 className="section-title">Xác thực hai bước</h2><p className="mt-1 text-sm leading-6 text-[#516274]">Bảo vệ tài khoản bằng mã 6 chữ số từ ứng dụng xác thực.</p></div></div>
      {!profile.mfaEnabled && !mfaSetup ? <div className="mt-6"><Button onClick={() => void startMfa()} variant="secondary"><KeyRound size={16} />Thiết lập MFA</Button></div> : null}
      {mfaSetup ? <div className="mt-6 grid gap-5 border-y border-[#d5dfe2] py-5 lg:grid-cols-[1fr_0.8fr]"><div><p className="text-sm font-bold">1. Thêm khóa vào ứng dụng xác thực</p><p className="mt-2 text-xs leading-5 text-[#657789]">Microsoft Authenticator, Google Authenticator hoặc ứng dụng tương thích TOTP.</p><div className="mt-3 flex items-center gap-2"><code className="min-w-0 break-all rounded-lg bg-[#eee8dc] px-3 py-2 text-sm font-bold tracking-[0.08em]">{mfaSetup.secret}</code><Button aria-label="Sao chép khóa MFA" onClick={() => void navigator.clipboard.writeText(mfaSetup.secret)} variant="ghost"><Copy size={15} /></Button></div></div><div><Field label="2. Nhập mã đang hiển thị"><input autoComplete="one-time-code" className={inputClass} inputMode="numeric" maxLength={6} onChange={(event) => setMfaCode(event.target.value)} placeholder="000000" value={mfaCode} /></Field><Button className="mt-3" disabled={!/^\d{6}$/.test(mfaCode)} onClick={() => void confirmMfa()}>Xác nhận và bật</Button></div></div> : null}
      {profile.mfaEnabled ? <div className="mt-6 grid gap-4 border-y border-[#d5dfe2] py-5 sm:grid-cols-2"><Field label="Mật khẩu hiện tại"><input autoComplete="current-password" className={inputClass} onChange={(event) => setMfaPassword(event.target.value)} type="password" value={mfaPassword} /></Field><Field label="Mã xác thực"><input autoComplete="one-time-code" className={inputClass} inputMode="numeric" maxLength={6} onChange={(event) => setMfaCode(event.target.value)} value={mfaCode} /></Field><div className="sm:col-span-2"><Button disabled={!mfaPassword || !/^\d{6}$/.test(mfaCode)} onClick={() => void disableMfa()} variant="danger">Tắt xác thực hai bước</Button></div></div> : null}
      {recoveryCodes.length ? <div className="mt-6 border-y border-[#d5dfe2] bg-[#eee8dc]/55 px-4 py-5"><h3 className="font-bold">Lưu mã khôi phục ngay</h3><p className="mt-1 text-xs leading-5 text-[#657789]">Mỗi mã chỉ dùng được một lần và sẽ không hiển thị lại.</p><div className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm font-bold sm:grid-cols-4">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><Button className="mt-4" onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))} variant="secondary"><Copy size={15} />Sao chép tất cả</Button></div> : null}
    </section>

    <section className="content-panel mt-7 p-5 md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><Laptop className="mt-0.5 text-[#c75b39]" size={22} /><div><h2 className="section-title">Thiết bị đăng nhập</h2><p className="mt-1 text-sm leading-6 text-[#516274]">Kiểm tra và đóng ngay những phiên bạn không nhận ra.</p></div></div><Button disabled={!otherSessions.length} onClick={() => void revokeOthers()} variant="secondary"><Trash2 size={16} />Đóng mọi phiên khác</Button></div>
      <div className="mt-6 divide-y divide-[#d5dfe2] border-y border-[#a9bac1]">
        {sessions.map((item) => { const device = deviceName(item.userAgent); const Icon = device.mobile ? Smartphone : Laptop; return <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between" key={item.id}><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eee8dc] text-[#516274]"><Icon size={18} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{device.label}</p>{item.current ? <span className="rounded-full bg-[#27685f]/10 px-2.5 py-1 text-[11px] font-extrabold text-[#1f574f]">Phiên hiện tại</span> : null}</div><p className="mt-1 text-xs leading-5 text-[#657789]">IP {item.ipAddress} · hoạt động {new Date(item.lastSeenAt).toLocaleString("vi-VN")}</p><p className="text-xs leading-5 text-[#657789]">Hết hạn {new Date(item.expiresAt).toLocaleString("vi-VN")}</p></div></div>{!item.current ? <Button aria-label={`Thu hồi phiên ${device.label}`} onClick={() => void revoke(item.id)} variant="ghost"><Trash2 size={15} />Thu hồi</Button> : null}</div>; })}
        {!sessions.length && !loading ? <p className="empty-copy">Không có phiên đăng nhập đang hoạt động.</p> : null}
      </div>
    </section>
  </div>;
}
