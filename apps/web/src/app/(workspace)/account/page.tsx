"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Laptop, RefreshCw, Save, ShieldCheck, Smartphone, Trash2, UserRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Field, StatusBadge, inputClass } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { AccountProfile, AccountSession } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";

const emptyProfile: AccountProfile = { id: "", displayName: "", email: "", phone: "", timezone: "Asia/Bangkok", locale: "vi-VN", status: "ACTIVE", createdAt: "" };

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

  const otherSessions = useMemo(() => sessions.filter((item) => !item.current), [sessions]);

  return <div className="workspace-enter mx-auto max-w-6xl px-4 py-8 md:px-7 md:py-10">
    <PageHeader eyebrow="Tài khoản" title="Hồ sơ & bảo mật" description="Quản lý thông tin hiển thị, mật khẩu và các thiết bị đang đăng nhập vào Wind EDU." actions={<Button loading={loading} onClick={() => void load()} variant="secondary"><RefreshCw size={16} />Làm mới</Button>} />

    <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <form className="content-panel p-5 md:p-7" onSubmit={saveProfile}>
        <div className="flex items-start gap-3"><UserRound className="mt-0.5 text-[#c75b39]" size={22} /><div><h2 className="section-title">Thông tin cá nhân</h2><p className="mt-1 text-sm leading-6 text-[#516274]">Thông tin dùng để nhận diện bạn trong lớp học, diễn đàn và báo cáo.</p></div></div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Họ và tên"><input className={inputClass} disabled={loading} maxLength={150} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} required value={profile.displayName} /></Field>
          <Field label="Email đăng nhập"><input className={inputClass} disabled readOnly value={profile.email} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[#657789]">Đổi email cần quy trình xác minh riêng.</span></Field>
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><Laptop className="mt-0.5 text-[#c75b39]" size={22} /><div><h2 className="section-title">Thiết bị đăng nhập</h2><p className="mt-1 text-sm leading-6 text-[#516274]">Kiểm tra và đóng ngay những phiên bạn không nhận ra.</p></div></div><Button disabled={!otherSessions.length} onClick={() => void revokeOthers()} variant="secondary"><Trash2 size={16} />Đóng mọi phiên khác</Button></div>
      <div className="mt-6 divide-y divide-[#d5dfe2] border-y border-[#a9bac1]">
        {sessions.map((item) => { const device = deviceName(item.userAgent); const Icon = device.mobile ? Smartphone : Laptop; return <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between" key={item.id}><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eee8dc] text-[#516274]"><Icon size={18} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{device.label}</p>{item.current ? <span className="rounded-full bg-[#27685f]/10 px-2.5 py-1 text-[11px] font-extrabold text-[#1f574f]">Phiên hiện tại</span> : null}</div><p className="mt-1 text-xs leading-5 text-[#657789]">IP {item.ipAddress} · hoạt động {new Date(item.lastSeenAt).toLocaleString("vi-VN")}</p><p className="text-xs leading-5 text-[#657789]">Hết hạn {new Date(item.expiresAt).toLocaleString("vi-VN")}</p></div></div>{!item.current ? <Button aria-label={`Thu hồi phiên ${device.label}`} onClick={() => void revoke(item.id)} variant="ghost"><Trash2 size={15} />Thu hồi</Button> : null}</div>; })}
        {!sessions.length && !loading ? <p className="empty-copy">Không có phiên đăng nhập đang hoạt động.</p> : null}
      </div>
    </section>
  </div>;
}
