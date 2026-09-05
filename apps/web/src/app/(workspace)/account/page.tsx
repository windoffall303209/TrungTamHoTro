"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { ArrowLeft, Camera, Copy, KeyRound, Laptop, MailCheck, RefreshCw, Save, ShieldCheck, Smartphone, Trash2, Upload, UserRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Field, StatusBadge, inputClass } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { AccountProfile, AccountSession } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";
import { UserAvatar } from "@/components/user-avatar";

const emptyProfile: AccountProfile = { id: "", username: "", displayName: "", email: "", phone: "", timezone: "Asia/Bangkok", locale: "vi-VN", avatarUrl: null, status: "ACTIVE", emailVerifiedAt: null, mfaEnabled: false, hasPassword: true, googleConnected: false, createdAt: "" };
const authenticatorApps = [
  { id: "google", name: "Google Authenticator", note: "Android và iOS" },
  { id: "microsoft", name: "Microsoft Authenticator", note: "Android và iOS" },
  { id: "1password", name: "1Password", note: "Máy tính và điện thoại" },
  { id: "other", name: "Ứng dụng TOTP khác", note: "Authy, Bitwarden và ứng dụng tương thích" },
] as const;

/** Rút gọn user-agent thành tên trình duyệt, nền tảng và loại thiết bị dễ đọc. */
function deviceName(userAgent: string): { label: string; mobile: boolean } {
  if (userAgent === "Thiết bị không xác định") return { label: userAgent, mobile: false };
  const mobile = /Android|iPhone|iPad/i.test(userAgent);
  const browser = /Edg/i.test(userAgent) ? "Microsoft Edge" : /Chrome/i.test(userAgent) ? "Google Chrome" : /Firefox/i.test(userAgent) ? "Firefox" : /Safari/i.test(userAgent) ? "Safari" : "Trình duyệt khác";
  const platform = /Windows/i.test(userAgent) ? "Windows" : /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iOS/iPadOS" : /Mac OS/i.test(userAgent) ? "macOS" : "Thiết bị khác";
  return { label: `${browser} · ${platform}`, mobile };
}

/** Điều phối hồ sơ, avatar, mật khẩu, MFA và các phiên đăng nhập của tài khoản hiện tại. */
export default function AccountPage() {
  const { notify, refreshSession } = useApp();
  const [profile, setProfile] = useState<AccountProfile>(emptyProfile);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [passwordChallenge, setPasswordChallenge] = useState<{ id: string; email: string } | null>(null);
  const [passwordEmailCode, setPasswordEmailCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaSetupChallenge, setMfaSetupChallenge] = useState<{ id: string; email: string } | null>(null);
  const [mfaSetupEmailCode, setMfaSetupEmailCode] = useState("");
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [authenticatorApp, setAuthenticatorApp] = useState<(typeof authenticatorApps)[number]["id"]>("google");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaDisableStep, setMfaDisableStep] = useState<"idle" | "password" | "email" | "code">("idle");
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");
  const [mfaDisableEmailChallenge, setMfaDisableEmailChallenge] = useState<{ id: string; email: string } | null>(null);
  const [mfaDisableEmailCode, setMfaDisableEmailCode] = useState("");
  const [mfaDisableChallenge, setMfaDisableChallenge] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  /** Nạp song song hồ sơ và phiên đăng nhập để đồng bộ toàn bộ màn hình bảo mật. */
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

  // Hoãn lần nạp đầu sang microtask để tránh cập nhật state đồng bộ ngay trong effect.
  useEffect(() => { window.queueMicrotask(() => void load()); }, [load]);
  // Thu hồi object URL khi đổi ảnh xem trước hoặc rời trang để tránh rò rỉ bộ nhớ.
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);
  // Sinh QR cục bộ từ URI TOTP; khóa bí mật không được gửi sang dịch vụ tạo QR bên ngoài.
  useEffect(() => {
    if (!mfaSetup) return;
    let active = true;
    QRCode.toDataURL(mfaSetup.otpauthUri, { width: 232, margin: 1, color: { dark: "var(--ink)", light: "var(--surface)" }, errorCorrectionLevel: "M" })
      .then((value) => { if (active) setMfaQrCode(value); })
      .catch(() => { if (active) notify("Không thể tạo mã QR. Bạn vẫn có thể nhập khóa thiết lập thủ công.", "error"); });
    return () => { active = false; };
  }, [mfaSetup, notify]);

  /** Chỉ cập nhật các trường hồ sơ được phép rồi làm mới session dùng chung trên header. */
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      setProfile(await apiRequest<AccountProfile>("/account/profile", { method: "PATCH", body: JSON.stringify({ displayName: profile.displayName, phone: profile.phone, timezone: profile.timezone, locale: profile.locale }) }));
      await refreshSession(); notify("Đã cập nhật hồ sơ cá nhân.");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể cập nhật hồ sơ.", "error"); }
    finally { setSaving(false); }
  }

  /** Kiểm tra định dạng/kích thước avatar ở client và tạo URL xem trước tạm thời. */
  function selectAvatar(file: File | null) {
    if (!file) { setAvatarFile(null); setAvatarPreview(""); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { notify("Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.", "error"); return; }
    if (file.size > 3 * 1024 * 1024) { notify("Ảnh đại diện không được vượt quá 3 MB.", "error"); return; }
    setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file));
  }

  /** Tải avatar dạng multipart lên API rồi đồng bộ lại hồ sơ và session toàn ứng dụng. */
  async function saveAvatar() {
    if (!avatarFile) return;
    setAvatarSaving(true);
    try {
      const body = new FormData(); body.append("file", avatarFile);
      setProfile(await apiRequest<AccountProfile>("/account/avatar", { method: "POST", body }));
      setAvatarFile(null); setAvatarPreview(""); await refreshSession(); notify("Đã cập nhật ảnh đại diện.");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể cập nhật ảnh đại diện.", "error"); }
    finally { setAvatarSaving(false); }
  }

  /** Xóa avatar trên máy chủ và đưa các vị trí hiển thị về chữ viết tắt mặc định. */
  async function removeAvatar() {
    setAvatarSaving(true);
    try {
      setProfile(await apiRequest<AccountProfile>("/account/avatar", { method: "DELETE" }));
      setAvatarFile(null); setAvatarPreview(""); await refreshSession(); notify("Đã xóa ảnh đại diện.", "info");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể xóa ảnh đại diện.", "error"); }
    finally { setAvatarSaving(false); }
  }

  /** Đổi/thiết lập mật khẩu bằng mật khẩu hiện tại hoặc email step-up với tài khoản Google. */
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) { notify("Xác nhận mật khẩu mới chưa khớp.", "error"); return; }
    setPasswordSaving(true);
    try {
      const body = profile.googleConnected
        ? { challengeId: passwordChallenge?.id, code: passwordEmailCode, newPassword: passwords.newPassword }
        : { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword };
      const result = await apiRequest<{ revokedSessions: number }>("/account/password", { method: "PATCH", body: JSON.stringify(body) });
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordChallenge(null); setPasswordEmailCode("");
      notify(`${profile.hasPassword ? "Đã đổi" : "Đã thiết lập"} mật khẩu và đóng ${result.revokedSessions} phiên khác.`); await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể đổi mật khẩu.", "error"); }
    finally { setPasswordSaving(false); }
  }

  /** Yêu cầu OTP email theo đúng mục đích của thao tác nhạy cảm. */
  async function requestSecurityCode(purpose: "PASSWORD_CHANGE" | "MFA_SETUP" | "MFA_DISABLE"): Promise<{ challengeId: string; email: string; sent: boolean }> {
    return apiRequest("/account/security-email-challenges", { method: "POST", body: JSON.stringify({ purpose }) });
  }

  /** Khởi tạo email step-up trước khi tài khoản Google đặt hoặc đổi mật khẩu. */
  async function requestPasswordCode() {
    try {
      const result = await requestSecurityCode("PASSWORD_CHANGE");
      setPasswordChallenge({ id: result.challengeId, email: result.email }); setPasswordEmailCode("");
      notify(result.sent ? `Đã gửi mã 6 số tới ${result.email}.` : "Mã vừa gửi vẫn còn hiệu lực.", "info");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể gửi mã bảo mật.", "error"); }
  }

  /** Thu hồi một phiên cụ thể và loại nó khỏi danh sách cục bộ sau khi API thành công. */
  async function revoke(sessionId: string) {
    try { await apiRequest<void>(`/account/sessions/${sessionId}`, { method: "DELETE" }); setSessions((items) => items.filter((item) => item.id !== sessionId)); notify("Đã thu hồi phiên đăng nhập."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể thu hồi phiên.", "error"); }
  }

  /** Đóng toàn bộ phiên khác, giữ nguyên phiên đang thao tác rồi nạp lại dữ liệu. */
  async function revokeOthers() {
    try { const result = await apiRequest<{ revokedSessions: number }>("/account/sessions/revoke-others", { method: "POST" }); notify(`Đã đóng ${result.revokedSessions} phiên khác.`); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể đóng các phiên khác.", "error"); }
  }

  /** Gửi lại email xác minh cho tài khoản chưa xác minh. */
  async function resendVerification() {
    try { const result = await apiRequest<{ sent: boolean }>("/account/verification-email", { method: "POST" }); notify(result.sent ? "Đã gửi lại email xác minh." : "Email đã được xác minh.", "info"); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể gửi email xác minh.", "error"); }
  }

  /** Bắt đầu thiết lập TOTP trực tiếp hoặc qua email step-up đối với tài khoản Google. */
  async function startMfa() {
    try {
      if (profile.googleConnected) {
        const result = await requestSecurityCode("MFA_SETUP");
        setMfaSetupChallenge({ id: result.challengeId, email: result.email }); setMfaSetupEmailCode("");
        notify(result.sent ? `Đã gửi mã 6 số tới ${result.email}.` : "Mã vừa gửi vẫn còn hiệu lực.", "info");
      } else setMfaSetup(await apiRequest<{ secret: string; otpauthUri: string }>("/account/mfa/setup", { method: "POST", body: "{}" }));
      setMfaCode("");
    }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể khởi tạo MFA.", "error"); }
  }

  /** Tiêu thụ OTP email để nhận bí mật TOTP và chuyển sang bước quét QR. */
  async function authorizeMfaSetup(event: FormEvent) {
    event.preventDefault();
    try {
      setMfaSetup(await apiRequest<{ secret: string; otpauthUri: string }>("/account/mfa/setup", { method: "POST", body: JSON.stringify({ challengeId: mfaSetupChallenge?.id, code: mfaSetupEmailCode }) }));
      setMfaSetupChallenge(null); setMfaSetupEmailCode(""); setMfaCode("");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể xác thực mã email.", "error"); }
  }

  /** Xác nhận mã TOTP đầu tiên, lưu mã khôi phục trả về và bật MFA. */
  async function confirmMfa() {
    try { const result = await apiRequest<{ recoveryCodes: string[] }>("/account/mfa/confirm", { method: "POST", body: JSON.stringify({ code: mfaCode }) }); setRecoveryCodes(result.recoveryCodes); setMfaSetup(null); setMfaCode(""); await load(); notify("Đã bật xác thực hai bước."); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể bật MFA.", "error"); }
  }

  /** Xác minh mật khẩu/OTP email để nhận challenge ngắn hạn cho thao tác tắt MFA. */
  async function startDisableMfa(event: FormEvent) {
    event.preventDefault();
    try {
      const body = profile.googleConnected ? { challengeId: mfaDisableEmailChallenge?.id, code: mfaDisableEmailCode } : { password: mfaDisablePassword };
      const result = await apiRequest<{ challengeToken: string; expiresInSeconds: number }>("/account/mfa/disable-challenge", { method: "POST", body: JSON.stringify(body) });
      setMfaDisableChallenge(result.challengeToken); setMfaDisablePassword(""); setMfaDisableEmailCode(""); setMfaCode(""); setMfaDisableStep("code");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể xác minh danh tính.", "error"); }
  }

  /** Mở nhánh email step-up khi tài khoản Google yêu cầu tắt MFA. */
  async function beginDisableMfa() {
    try {
      const result = await requestSecurityCode("MFA_DISABLE");
      setMfaDisableEmailChallenge({ id: result.challengeId, email: result.email }); setMfaDisableEmailCode(""); setMfaDisableStep("email");
      notify(result.sent ? `Đã gửi mã 6 số tới ${result.email}.` : "Mã vừa gửi vẫn còn hiệu lực.", "info");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể gửi mã bảo mật.", "error"); }
  }

  /** Kết hợp challenge đã cấp với mã TOTP hiện tại để vô hiệu hóa MFA. */
  async function disableMfa(event: FormEvent) {
    event.preventDefault();
    try { await apiRequest("/account/mfa", { method: "DELETE", body: JSON.stringify({ challengeToken: mfaDisableChallenge, code: mfaCode }) }); setMfaDisableChallenge(""); setMfaCode(""); setMfaDisableStep("idle"); await load(); notify("Đã tắt xác thực hai bước.", "info"); }
    catch (error) { notify(error instanceof Error ? error.message : "Không thể tắt MFA.", "error"); }
  }

  /** Hủy luồng tắt MFA và xóa toàn bộ dữ liệu xác minh nhạy cảm khỏi state. */
  function cancelDisableMfa() { setMfaDisableStep("idle"); setMfaDisablePassword(""); setMfaDisableEmailChallenge(null); setMfaDisableEmailCode(""); setMfaDisableChallenge(""); setMfaCode(""); }

  const otherSessions = useMemo(() => sessions.filter((item) => !item.current), [sessions]);

  return <div className="workspace-enter mx-auto max-w-6xl px-4 py-8 md:px-7 md:py-10">
    <PageHeader eyebrow="Tài khoản" title="Hồ sơ & bảo mật" description="Quản lý thông tin hiển thị, mật khẩu và các thiết bị đang đăng nhập vào Wind EDU." actions={<Button loading={loading} onClick={() => void load()} variant="secondary"><RefreshCw size={16} />Làm mới</Button>} />

    <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <form className="content-panel p-5 md:p-7" onSubmit={saveProfile}>
        <div className="flex items-start gap-3"><UserRound className="mt-0.5 text-[var(--accent)]" size={22} /><div><h2 className="section-title">Thông tin cá nhân</h2><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Thông tin dùng để nhận diện bạn trong lớp học, diễn đàn và báo cáo.</p></div></div>
        <div className="mt-6 flex flex-col gap-5 border-y border-[var(--rule)] py-5 sm:flex-row sm:items-center">
          <UserAvatar avatarUrl={avatarPreview || profile.avatarUrl} className="size-24 text-2xl" name={profile.displayName || "Người dùng"} priority />
          <div className="min-w-0 flex-1"><h3 className="font-bold">Ảnh đại diện</h3><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">PNG, JPEG hoặc WebP; tối đa 3 MB. Ảnh vuông sẽ hiển thị cân đối nhất.</p><div className="mt-3 flex flex-wrap gap-2"><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--ink)] hover:border-[var(--action)]"><Camera size={16} />{profile.avatarUrl ? "Chọn ảnh khác" : "Chọn ảnh"}<input accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => selectAvatar(event.target.files?.[0] ?? null)} type="file" /></label>{avatarFile ? <Button loading={avatarSaving} onClick={() => void saveAvatar()} type="button"><Upload size={16} />Lưu ảnh</Button> : null}{profile.avatarUrl ? <Button disabled={avatarSaving} onClick={() => void removeAvatar()} type="button" variant="ghost"><Trash2 size={15} />Xóa ảnh</Button> : null}</div>{avatarFile ? <p className="mt-2 truncate text-xs font-semibold text-[var(--ink-soft)]">Đã chọn: {avatarFile.name}</p> : null}</div>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Họ và tên"><input className={inputClass} disabled={loading} maxLength={150} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} required value={profile.displayName} /></Field>
          <Field label="Tài khoản"><input className={inputClass} disabled readOnly value={profile.username} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--ink-muted)]">Dùng để đăng nhập vào Wind EDU.</span></Field>
          <Field label="Email"><input className={inputClass} disabled readOnly value={profile.email} /><span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-normal leading-5 text-[var(--ink-muted)]">{profile.emailVerifiedAt ? <><MailCheck size={14} className="text-[var(--success)]" />Đã xác minh</> : <>Chưa xác minh <button className="text-link font-bold" onClick={() => void resendVerification()} type="button">Gửi lại email</button></>}</span></Field>
          <Field label="Phương thức đăng nhập"><input className={inputClass} disabled readOnly value={profile.googleConnected ? profile.hasPassword ? "Google và mật khẩu" : "Google" : "Tài khoản và mật khẩu"} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--ink-muted)]">{profile.googleConnected ? "Google đã xác minh quyền sở hữu email này." : "Tài khoản được bảo vệ bằng mật khẩu cục bộ."}</span></Field>
          <Field label="Số điện thoại"><input className={inputClass} disabled={loading} inputMode="tel" maxLength={30} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="Ví dụ: 0901 234 567" value={profile.phone} /></Field>
          <Field label="Múi giờ"><select className={inputClass} disabled={loading} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })} value={profile.timezone}><option value="Asia/Bangkok">Bangkok (UTC+7)</option><option value="Asia/Ho_Chi_Minh">Hồ Chí Minh (UTC+7)</option><option value="UTC">UTC</option></select></Field>
          <Field label="Ngôn ngữ"><select className={inputClass} disabled={loading} onChange={(event) => setProfile({ ...profile, locale: event.target.value })} value={profile.locale}><option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option></select></Field>
          <div><p className="text-sm font-bold">Trạng thái tài khoản</p><div className="mt-3"><StatusBadge status={profile.status} /></div><p className="mt-2 text-xs text-[var(--ink-muted)]">Tham gia từ {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("vi-VN") : "—"}</p></div>
        </div>
        <div className="mt-7 flex justify-end"><Button loading={saving} type="submit"><Save size={16} />Lưu thay đổi</Button></div>
      </form>

      <form className="content-panel p-5 md:p-7" onSubmit={changePassword}>
        <div className="flex items-start gap-3"><KeyRound className="mt-0.5 text-[var(--accent)]" size={22} /><div><h2 className="section-title">{profile.googleConnected && !profile.hasPassword ? "Thiết lập mật khẩu" : "Đổi mật khẩu"}</h2><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{profile.googleConnected ? "Mã 6 số gửi tới email Google thay cho mật khẩu hiện tại. Các phiên khác sẽ được đóng sau khi hoàn tất." : "Sau khi đổi, các phiên khác sẽ được đóng để bảo vệ tài khoản."}</p></div></div>
        {profile.googleConnected && !passwordChallenge ? <div className="mt-6 border-y border-[var(--rule)] py-5"><p className="text-sm font-semibold leading-6 text-[var(--ink-soft)]">Gửi mã bảo mật tới email đã xác minh để tiếp tục.</p><Button className="mt-3" onClick={() => void requestPasswordCode()} type="button" variant="secondary"><MailCheck size={16} />Gửi mã 6 số</Button></div> : <div className="mt-6 space-y-5">
          {profile.googleConnected ? <Field label="Mã xác thực email"><input autoComplete="one-time-code" autoFocus className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`} inputMode="numeric" maxLength={6} onChange={(event) => setPasswordEmailCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required value={passwordEmailCode} /><span className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs font-normal leading-5 text-[var(--ink-muted)]"><span>Đã gửi tới {passwordChallenge?.email}</span><button className="text-link font-bold" onClick={() => void requestPasswordCode()} type="button">Gửi mã mới</button></span></Field> : <Field label="Mật khẩu hiện tại"><input autoComplete="current-password" className={inputClass} minLength={8} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} required type="password" value={passwords.currentPassword} /></Field>}
          <Field label="Mật khẩu mới"><input autoComplete="new-password" className={inputClass} minLength={8} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} required type="password" value={passwords.newPassword} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--ink-muted)]">Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</span></Field>
          <Field label="Nhập lại mật khẩu mới"><input autoComplete="new-password" className={inputClass} minLength={8} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} required type="password" value={passwords.confirmPassword} /></Field>
        </div>}
        {!profile.googleConnected || passwordChallenge ? <div className="mt-7 flex justify-end"><Button disabled={profile.googleConnected && !/^\d{6}$/.test(passwordEmailCode)} loading={passwordSaving} type="submit"><ShieldCheck size={16} />{profile.hasPassword ? "Đổi mật khẩu" : "Thiết lập mật khẩu"}</Button></div> : null}
      </form>
    </div>

    <section className="content-panel mt-7 p-5 md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 text-[var(--accent)]" size={22} /><div><h2 className="section-title">Xác thực hai bước</h2><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Bảo vệ tài khoản bằng mã 6 chữ số từ ứng dụng xác thực.</p></div></div>{profile.mfaEnabled && mfaDisableStep === "idle" ? <Button onClick={() => profile.googleConnected ? void beginDisableMfa() : setMfaDisableStep("password")} variant="danger">Tắt xác thực hai bước</Button> : null}</div>
      {!profile.mfaEnabled && !mfaSetup && !mfaSetupChallenge ? <div className="mt-6 flex flex-col items-start gap-2 border-y border-[var(--rule)] py-5"><p className="text-sm font-semibold text-[var(--ink-soft)]">Mỗi lần đăng nhập, bạn sẽ cần thêm mã từ ứng dụng xác thực.</p><Button onClick={() => void startMfa()} variant="secondary"><KeyRound size={16} />Thiết lập xác thực hai bước</Button></div> : null}
      {!profile.mfaEnabled && mfaSetupChallenge ? <form className="mt-6 max-w-xl border-y border-[var(--rule)] py-5" onSubmit={authorizeMfaSetup}>
        <h3 className="font-bold">Xác minh email trước</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Mã bảo mật 6 số đã được gửi tới {mfaSetupChallenge.email}. Nhập mã để bắt đầu thiết lập ứng dụng xác thực.</p>
        <div className="mt-4 max-w-sm"><Field label="Mã xác thực email"><input autoComplete="one-time-code" autoFocus className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`} inputMode="numeric" maxLength={6} onChange={(event) => setMfaSetupEmailCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required value={mfaSetupEmailCode} /></Field></div>
        <div className="mt-4 flex flex-wrap gap-2"><Button disabled={!/^\d{6}$/.test(mfaSetupEmailCode)} type="submit">Xác minh và tiếp tục</Button><Button onClick={() => void startMfa()} type="button" variant="secondary"><MailCheck size={15} />Gửi mã mới</Button><Button onClick={() => { setMfaSetupChallenge(null); setMfaSetupEmailCode(""); }} type="button" variant="ghost">Hủy</Button></div>
      </form> : null}
      {mfaSetup ? <div className="mt-6 border-y border-[var(--rule)] py-6">
        <div className="grid gap-7 lg:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)]">
          <div className="flex flex-col items-center border-b border-[var(--rule)] pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-7">
            <p className="self-start text-sm font-bold">1. Quét mã QR</p>
            <div className="mt-4 grid min-h-[232px] w-[232px] place-items-center rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] p-2">{mfaQrCode ? <Image alt="Mã QR thiết lập xác thực hai bước" height={232} priority src={mfaQrCode} unoptimized width={232} /> : <RefreshCw className="animate-spin text-[var(--ink-muted)]" size={22} />}</div>
            <p className="mt-3 text-center text-xs leading-5 text-[var(--ink-muted)]">Mã QR chứa khóa TOTP dành riêng cho tài khoản. Không chia sẻ ảnh này.</p>
          </div>
          <div>
            <p className="text-sm font-bold">2. Chọn ứng dụng bạn đang dùng</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{authenticatorApps.map((app) => <button aria-pressed={authenticatorApp === app.id} className={`min-h-16 rounded-xl border px-4 py-3 text-left transition ${authenticatorApp === app.id ? "border-[var(--action)] bg-[var(--surface-muted)]" : "border-[var(--rule)] bg-[var(--surface)] hover:border-[var(--rule-strong)]"}`} key={app.id} onClick={() => setAuthenticatorApp(app.id)} type="button"><span className="block text-sm font-bold">{app.name}</span><span className="mt-1 block text-xs leading-5 text-[var(--ink-muted)]">{app.note}</span></button>)}</div>
            <ol className="mt-4 space-y-2 text-sm leading-6 text-[var(--ink-soft)]"><li><strong className="text-[var(--ink)]">a.</strong> Mở {authenticatorApps.find((app) => app.id === authenticatorApp)?.name}.</li><li><strong className="text-[var(--ink)]">b.</strong> Chọn thêm tài khoản rồi quét mã QR bên trái.</li><li><strong className="text-[var(--ink)]">c.</strong> Nhập mã 6 số ứng dụng vừa tạo vào bước dưới.</li></ol>
            <details className="mt-4 border-t border-[var(--rule)] pt-4"><summary className="cursor-pointer text-sm font-bold">Không quét được QR?</summary><div className="mt-3 flex items-center gap-2"><code className="min-w-0 break-all rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm font-bold tracking-[0.08em]">{mfaSetup.secret}</code><Button aria-label="Sao chép khóa thiết lập" onClick={() => void navigator.clipboard.writeText(mfaSetup.secret)} variant="ghost"><Copy size={15} /></Button></div></details>
            <div className="mt-5 max-w-sm"><Field label="3. Mã xác thực 6 số"><input autoComplete="one-time-code" className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`} inputMode="numeric" maxLength={6} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" value={mfaCode} /></Field><div className="mt-3 flex flex-wrap gap-2"><Button disabled={!/^\d{6}$/.test(mfaCode)} onClick={() => void confirmMfa()}>Xác nhận và bật</Button><Button onClick={() => { setMfaSetup(null); setMfaQrCode(""); setMfaCode(""); }} variant="ghost">Hủy</Button></div></div>
          </div>
        </div>
      </div> : null}
      {profile.mfaEnabled && mfaDisableStep === "password" ? <form className="mt-6 max-w-xl border-y border-[var(--rule)] py-5" onSubmit={(event) => void startDisableMfa(event)}><h3 className="font-bold">Xác nhận mật khẩu trước</h3><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Đây là bước 1/2. Mã xác thực chỉ được yêu cầu sau khi mật khẩu đúng.</p><div className="mt-4 max-w-sm"><Field label="Mật khẩu hiện tại"><input autoComplete="current-password" autoFocus className={inputClass} minLength={8} onChange={(event) => setMfaDisablePassword(event.target.value)} required type="password" value={mfaDisablePassword} /></Field></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!mfaDisablePassword} type="submit">Tiếp tục</Button><Button onClick={cancelDisableMfa} variant="ghost">Hủy</Button></div></form> : null}
      {profile.mfaEnabled && mfaDisableStep === "email" ? <form className="mt-6 max-w-xl border-y border-[var(--rule)] py-5" onSubmit={(event) => void startDisableMfa(event)}><h3 className="font-bold">Xác minh email trước</h3><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Bước 1/2. Nhập mã 6 số đã gửi tới {mfaDisableEmailChallenge?.email} để tiếp tục.</p><div className="mt-4 max-w-sm"><Field label="Mã xác thực email"><input autoComplete="one-time-code" autoFocus className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`} inputMode="numeric" maxLength={6} onChange={(event) => setMfaDisableEmailCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" required value={mfaDisableEmailCode} /></Field></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!/^\d{6}$/.test(mfaDisableEmailCode)} type="submit">Xác minh và tiếp tục</Button><Button onClick={() => void beginDisableMfa()} type="button" variant="secondary"><MailCheck size={15} />Gửi mã mới</Button><Button onClick={cancelDisableMfa} type="button" variant="ghost">Hủy</Button></div></form> : null}
      {profile.mfaEnabled && mfaDisableStep === "code" ? <form className="mt-6 max-w-xl border-y border-[var(--rule)] py-5" onSubmit={(event) => void disableMfa(event)}>{!profile.googleConnected ? <button className="mb-4 inline-flex min-h-10 items-center gap-2 text-sm font-bold text-[var(--ink-soft)]" onClick={() => { setMfaDisableStep("password"); setMfaCode(""); setMfaDisableChallenge(""); }} type="button"><ArrowLeft size={15} />Quay lại</button> : null}<h3 className="font-bold">Nhập mã xác thực</h3><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Bước 2/2. Mở ứng dụng xác thực và nhập mã 6 số hiện tại để tắt bảo vệ.</p><div className="mt-4 max-w-sm"><Field label="Mã xác thực 6 số"><input autoComplete="one-time-code" autoFocus className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`} inputMode="numeric" maxLength={6} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} value={mfaCode} /></Field></div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!/^\d{6}$/.test(mfaCode)} type="submit" variant="danger">Xác nhận tắt 2FA</Button><Button onClick={cancelDisableMfa} variant="ghost">Hủy</Button></div></form> : null}
      {recoveryCodes.length ? <div className="mt-6 border-y border-[var(--rule)] bg-[var(--surface-muted)]/55 px-4 py-5"><h3 className="font-bold">Lưu mã khôi phục ngay</h3><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Mỗi mã chỉ dùng được một lần và sẽ không hiển thị lại.</p><div className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm font-bold sm:grid-cols-4">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><Button className="mt-4" onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))} variant="secondary"><Copy size={15} />Sao chép tất cả</Button></div> : null}
    </section>

    <section className="content-panel mt-7 p-5 md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><Laptop className="mt-0.5 text-[var(--accent)]" size={22} /><div><h2 className="section-title">Thiết bị đăng nhập</h2><p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">Kiểm tra và đóng ngay những phiên bạn không nhận ra.</p></div></div><Button disabled={!otherSessions.length} onClick={() => void revokeOthers()} variant="secondary"><Trash2 size={16} />Đóng mọi phiên khác</Button></div>
      <div className="mt-6 divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
        {sessions.map((item) => { const device = deviceName(item.userAgent); const Icon = device.mobile ? Smartphone : Laptop; return <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between" key={item.id}><div className="flex min-w-0 items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--ink-soft)]"><Icon size={18} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{device.label}</p>{item.current ? <span className="rounded-full bg-[var(--success)]/10 px-2.5 py-1 text-[11px] font-extrabold text-[var(--success-deep)]">Phiên hiện tại</span> : null}</div><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">IP {item.ipAddress} · hoạt động {new Date(item.lastSeenAt).toLocaleString("vi-VN")}</p><p className="text-xs leading-5 text-[var(--ink-muted)]">Hết hạn {new Date(item.expiresAt).toLocaleString("vi-VN")}</p></div></div>{!item.current ? <Button aria-label={`Thu hồi phiên ${device.label}`} onClick={() => void revoke(item.id)} variant="ghost"><Trash2 size={15} />Thu hồi</Button> : null}</div>; })}
        {!sessions.length && !loading ? <p className="empty-copy">Không có phiên đăng nhập đang hoạt động.</p> : null}
      </div>
    </section>
  </div>;
}
