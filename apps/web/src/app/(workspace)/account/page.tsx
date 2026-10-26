"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Copy,
  KeyRound,
  Laptop,
  MailCheck,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button, Field, StatusBadge, inputClass } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { AccountProfile, AccountSession } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";
import { UserAvatar } from "@/components/user-avatar";
import { useI18n } from "@/providers/i18n-provider";
import { activeLocale } from "@/i18n/runtime";

const emptyProfile: AccountProfile = {
  id: "",
  username: "",
  displayName: "",
  email: null,
  phone: "",
  timezone: "Asia/Bangkok",
  locale: "vi-VN",
  avatarUrl: null,
  status: "ACTIVE",
  emailVerifiedAt: null,
  mfaEnabled: false,
  hasPassword: true,
  createdAt: "",
};

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
  const browser = /Edg/i.test(userAgent)
    ? "Microsoft Edge"
    : /Chrome/i.test(userAgent)
    ? "Google Chrome"
    : /Firefox/i.test(userAgent)
    ? "Firefox"
    : /Safari/i.test(userAgent)
    ? "Safari"
    : "Trình duyệt khác";
  const platform = /Windows/i.test(userAgent)
    ? "Windows"
    : /Android/i.test(userAgent)
    ? "Android"
    : /iPhone|iPad/i.test(userAgent)
    ? "iOS/iPadOS"
    : /Mac OS/i.test(userAgent)
    ? "macOS"
    : "Thiết bị khác";
  return { label: `${browser} · ${platform}`, mobile };
}

/** Nội dung chính của trang tài khoản, hỗ trợ tách riêng 2 tab: Thông tin cá nhân và Bảo mật */
function AccountContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "security" ? "security" : "profile";
  const [activeTab, setActiveTab] = useState<"profile" | "security">(initialTab);

  const { notify, refreshSession } = useApp();
  const { formatDateTime, locale, setLocale, t } = useI18n();

  const [profile, setProfile] = useState<AccountProfile>(emptyProfile);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Avatar upload states
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");

  // Password change states
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwords, setPasswords] = useState({ newPassword: "", confirmPassword: "" });
  const [passwordEmail, setPasswordEmail] = useState("");
  const [passwordOtp, setPasswordOtp] = useState<{ challengeId: string; email: string } | null>(null);
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordResendAt, setPasswordResendAt] = useState(0);
  const [clock, setClock] = useState(0);

  // 2FA / MFA states
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [authenticatorApp, setAuthenticatorApp] = useState<(typeof authenticatorApps)[number]["id"]>("google");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaDisableStep, setMfaDisableStep] = useState<"idle" | "password" | "code">("idle");
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");
  const [mfaDisableChallenge, setMfaDisableChallenge] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  // Đồng bộ tab từ URL param khi URL thay đổi
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "security") {
      setActiveTab("security");
    } else if (tabParam === "profile") {
      setActiveTab("profile");
    }
  }, [searchParams]);

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
      if (profileData.email) setPasswordEmail(profileData.email);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể tải thông tin tài khoản.", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    window.queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => {
    if (!mfaSetup) return;
    let active = true;
    QRCode.toDataURL(mfaSetup.otpauthUri, {
      width: 232,
      margin: 1,
      color: { dark: "var(--ink)", light: "var(--surface)" },
      errorCorrectionLevel: "M",
    })
      .then((value) => {
        if (active) setMfaQrCode(value);
      })
      .catch(() => {
        if (active) notify("Không thể tạo mã QR. Bạn vẫn có thể nhập khóa thiết lập thủ công.", "error");
      });
    return () => {
      active = false;
    };
  }, [mfaSetup, notify]);

  useEffect(() => {
    if (passwordResendAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setClock(current);
      if (current >= passwordResendAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [passwordResendAt]);

  const passwordResendSeconds = Math.max(0, Math.ceil((passwordResendAt - clock) / 1000));

  /** Lưu thông tin hồ sơ cá nhân */
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await apiRequest<AccountProfile>("/account/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: profile.displayName,
          phone: profile.phone,
          timezone: profile.timezone,
          locale: profile.locale,
        }),
      });
      setProfile(updated);
      await refreshSession();
      notify("Đã cập nhật thông tin cá nhân thành công.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật hồ sơ.", "error");
    } finally {
      setSaving(false);
    }
  }

  /** Chọn ảnh từ máy tính cá nhân để chuẩn bị đổi avatar */
  function selectAvatar(file: File | null) {
    if (!file) return;
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  /** Lưu ảnh avatar mới lên hệ thống */
  async function saveAvatar() {
    if (!avatarFile) return;
    setAvatarSaving(true);
    try {
      const formData = new FormData();
      formData.append("avatar", avatarFile);
      const result = await apiRequest<{ avatarUrl: string }>("/account/avatar", {
        method: "POST",
        body: formData,
      });
      setProfile((prev) => ({ ...prev, avatarUrl: result.avatarUrl }));
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview("");
      await refreshSession();
      notify("Đã cập nhật ảnh đại diện mới.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể tải lên ảnh đại diện.", "error");
    } finally {
      setAvatarSaving(false);
    }
  }

  /** Xóa ảnh avatar hiện tại */
  async function removeAvatar() {
    setAvatarSaving(true);
    try {
      await apiRequest("/account/avatar", { method: "DELETE" });
      setProfile((prev) => ({ ...prev, avatarUrl: null }));
      setAvatarFile(null);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview("");
      await refreshSession();
      notify("Đã xóa ảnh đại diện.", "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể xóa ảnh đại diện.", "error");
    } finally {
      setAvatarSaving(false);
    }
  }

  /** Gửi yêu cầu OTP để đổi mật khẩu */
  async function submitPasswordEmail(event: FormEvent) {
    event.preventDefault();
    setPasswordSaving(true);
    try {
      const challenge = await apiRequest<{ challengeId: string; email: string }>("/account/password/challenge", {
        method: "POST",
        body: JSON.stringify({ email: passwordEmail }),
      });
      setPasswordOtp(challenge);
      setPasswordResendAt(Date.now() + 60000);
      notify("Mã xác thực OTP đã được gửi đến email của bạn.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể gửi mã xác thực.", "error");
    } finally {
      setPasswordSaving(false);
    }
  }

  /** Hoàn tất đổi mật khẩu */
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      notify("Mật khẩu xác nhận không khớp.", "error");
      return;
    }
    setPasswordSaving(true);
    try {
      await apiRequest("/account/password", {
        method: "PUT",
        body: JSON.stringify({
          challengeId: passwordOtp?.challengeId,
          code: passwordCode,
          newPassword: passwords.newPassword,
        }),
      });
      setPasswords({ newPassword: "", confirmPassword: "" });
      setPasswordCode("");
      setPasswordOtp(null);
      notify("Đổi mật khẩu thành công. Các phiên khác đã được đóng.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể đổi mật khẩu.", "error");
    } finally {
      setPasswordSaving(false);
    }
  }

  /** Bắt đầu thiết lập TOTP */
  async function startMfa() {
    try {
      setMfaSetup(await apiRequest<{ secret: string; otpauthUri: string }>("/account/mfa/setup", { method: "POST", body: "{}" }));
      setMfaCode("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể khởi tạo MFA.", "error");
    }
  }

  /** Xác nhận mã TOTP và bật MFA */
  async function confirmMfa() {
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>("/account/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });
      setRecoveryCodes(result.recoveryCodes);
      setMfaSetup(null);
      setMfaCode("");
      await load();
      notify("Đã bật xác thực hai bước.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể bật MFA.", "error");
    }
  }

  /** Xác minh mật khẩu để tắt MFA */
  async function startDisableMfa(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await apiRequest<{ challengeToken: string; expiresInSeconds: number }>(
        "/account/mfa/disable-challenge",
        { method: "POST", body: JSON.stringify({ password: mfaDisablePassword }) }
      );
      setMfaDisableChallenge(result.challengeToken);
      setMfaDisablePassword("");
      setMfaCode("");
      setMfaDisableStep("code");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể xác minh danh tính.", "error");
    }
  }

  /** Vô hiệu hóa MFA */
  async function disableMfa(event: FormEvent) {
    event.preventDefault();
    try {
      await apiRequest("/account/mfa", {
        method: "DELETE",
        body: JSON.stringify({ challengeToken: mfaDisableChallenge, code: mfaCode }),
      });
      setMfaDisableChallenge("");
      setMfaCode("");
      setMfaDisableStep("idle");
      await load();
      notify("Đã tắt xác thực hai bước.", "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể tắt MFA.", "error");
    }
  }

  /** Thu hồi phiên đăng nhập */
  async function revoke(sessionId: string) {
    try {
      await apiRequest(`/account/sessions/${sessionId}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      notify("Đã thu hồi phiên đăng nhập thành công.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể thu hồi phiên.", "error");
    }
  }

  /** Đóng toàn bộ phiên khác */
  async function revokeOthers() {
    try {
      await apiRequest("/account/sessions", { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.current));
      notify("Đã đăng xuất khỏi mọi thiết bị khác.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể đóng các phiên khác.", "error");
    }
  }

  const otherSessions = useMemo(() => sessions.filter((item) => !item.current), [sessions]);

  return (
    <div className="workspace-enter mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8 space-y-6">
      {/* Tiêu đề trang tài khoản */}
      <PageHeader
        eyebrow="Tài khoản cá nhân"
        title={activeTab === "profile" ? "Thông tin cá nhân" : "Bảo mật tài khoản"}
        description={
          activeTab === "profile"
            ? "Quản lý ảnh đại diện, họ tên và thông tin liên hệ hiển thị trong hệ thống."
            : "Quản lý mật khẩu, phương thức xác thực hai bước (2FA) và các phiên đăng nhập."
        }
        actions={
          <Button loading={loading} onClick={() => void load()} variant="secondary">
            <RefreshCw size={15} />
            Làm mới dữ liệu
          </Button>
        }
      />

      {/* THANH CHUYỂN ĐỔI 2 PHÂN HỆ: THÔNG TIN CÁ NHÂN VÀ BẢO MẬT */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === "profile"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <UserRound size={17} />
          <span>Thông tin cá nhân</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("security")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === "security"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <ShieldCheck size={17} />
          <span>Bảo mật</span>
        </button>
      </div>

      {/* ================= TAB 1: THÔNG TIN CÁ NHÂN ================= */}
      {activeTab === "profile" && (
        <form
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs space-y-6"
          onSubmit={saveProfile}
        >
          {/* Khối Ảnh Đại Diện Người Dùng */}
          <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60">
            <UserAvatar
              avatarUrl={avatarPreview || profile.avatarUrl}
              className="size-24 text-2xl ring-4 ring-blue-500/20"
              name={profile.displayName || "Người dùng"}
              priority
            />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Ảnh đại diện</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Hỗ trợ định dạng PNG, JPEG hoặc WebP; dung lượng tối đa 3 MB.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-xs font-bold text-slate-800 dark:text-slate-200 hover:border-blue-500 transition-colors shadow-2xs">
                  <Camera size={15} />
                  <span>{profile.avatarUrl ? "Chọn ảnh khác" : "Tải ảnh lên"}</span>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(event) => selectAvatar(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>

                {avatarFile && (
                  <Button loading={avatarSaving} onClick={() => void saveAvatar()} type="button">
                    <Upload size={15} />
                    Lưu ảnh
                  </Button>
                )}

                {profile.avatarUrl && (
                  <Button
                    disabled={avatarSaving}
                    onClick={() => void removeAvatar()}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 size={15} className="text-rose-500" />
                    Xóa ảnh
                  </Button>
                )}
              </div>
              {avatarFile && (
                <p className="mt-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                  Đã chọn: {avatarFile.name}
                </p>
              )}
            </div>
          </div>

          {/* Các trường nhập liệu thông tin cá nhân */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Họ và tên">
              <input
                className={inputClass}
                disabled={loading}
                maxLength={150}
                onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
                required
                value={profile.displayName}
              />
            </Field>

            <Field label="Tên tài khoản đăng nhập">
              <input className={inputClass} disabled readOnly value={profile.username} />
              <span className="mt-1 block text-xs text-slate-400">Tên định danh cố định không thể sửa.</span>
            </Field>

            <Field label="Địa chỉ Email">
              <input className={inputClass} disabled readOnly value={profile.email ?? ""} />
              <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                {profile.emailVerifiedAt ? (
                  <>
                    <MailCheck size={14} className="text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Đã xác minh</span>
                  </>
                ) : (
                  <span>Chưa xác minh</span>
                )}
              </span>
            </Field>

            <Field label="Số điện thoại">
              <input
                className={inputClass}
                disabled={loading}
                inputMode="tel"
                maxLength={30}
                onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
                placeholder="Ví dụ: 0901 234 567"
                value={profile.phone}
              />
            </Field>

            <Field label="Múi giờ">
              <select
                className={inputClass}
                disabled={loading}
                onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}
                value={profile.timezone}
              >
                <option value="Asia/Bangkok">Hồ Chí Minh, Bangkok (UTC+7)</option>
                <option value="UTC">Giờ Quốc tế (UTC)</option>
              </select>
            </Field>

            <Field label="Ngôn ngữ hiển thị">
              <select
                className={inputClass}
                disabled={loading}
                onChange={(event) => {
                  const nextLocale = event.target.value === "en-US" ? "en-US" : "vi-VN";
                  setProfile({ ...profile, locale: nextLocale });
                  setLocale(nextLocale);
                }}
                value={profile.locale || locale}
              >
                <option value="vi-VN">Tiếng Việt</option>
                <option value="en-US">English</option>
              </select>
            </Field>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-xs text-slate-400">
                Tham gia hệ thống từ:{" "}
                <strong className="text-slate-700 dark:text-slate-300">
                  {profile.createdAt ? formatDateTime(profile.createdAt) : "—"}
                </strong>
              </p>
            </div>
            <Button loading={saving} type="submit">
              <Save size={16} />
              Lưu thay đổi
            </Button>
          </div>
        </form>
      )}

      {/* ================= TAB 2: BẢO MẬT ================= */}
      {activeTab === "security" && (
        <div className="space-y-6">
          {/* Phân vùng 1: Đổi mật khẩu */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
            <div className="flex items-start gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="size-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                <KeyRound size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Đổi mật khẩu</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Sau khi đổi mật khẩu, các phiên đăng nhập khác sẽ được đóng để bảo vệ tài khoản.
                </p>
              </div>
            </div>

            <form
              className="mt-5 space-y-4 max-w-xl"
              onSubmit={(e) => void (passwordOtp ? changePassword(e) : submitPasswordEmail(e))}
            >
              {!passwordOtp ? (
                <>
                  <Field label="Email xác thực để nhận mã OTP">
                    <input
                      autoComplete="email"
                      className={inputClass}
                      maxLength={191}
                      onChange={(e) => setPasswordEmail(e.target.value)}
                      required
                      type="email"
                      value={passwordEmail}
                    />
                  </Field>
                  <Button
                    disabled={passwordSaving || passwordResendSeconds > 0}
                    loading={passwordSaving}
                    type="submit"
                  >
                    <MailCheck size={16} />
                    Gửi mã OTP xác nhận{passwordResendSeconds > 0 ? ` (${passwordResendSeconds}s)` : null}
                  </Button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200">
                    Mã xác thực 6 số đã được gửi tới: <strong>{passwordOtp.email}</strong>
                  </div>

                  <Field label="Mật khẩu mới">
                    <input
                      autoComplete="new-password"
                      className={inputClass}
                      minLength={8}
                      onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                      required
                      type="password"
                      value={passwords.newPassword}
                    />
                    <span className="mt-1 block text-[11px] text-slate-400">
                      Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số.
                    </span>
                  </Field>

                  <Field label="Nhập lại mật khẩu mới">
                    <input
                      autoComplete="new-password"
                      className={inputClass}
                      minLength={8}
                      onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
                      required
                      type="password"
                      value={passwords.confirmPassword}
                    />
                  </Field>

                  <Field label="Mã OTP 6 số">
                    <input
                      autoComplete="one-time-code"
                      className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(e) => setPasswordCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      required
                      value={passwordCode}
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button disabled={passwordSaving || !/^\d{6}$/.test(passwordCode)} loading={passwordSaving} type="submit">
                      <ShieldCheck size={16} />
                      Xác nhận đổi mật khẩu
                    </Button>
                    <Button
                      disabled={passwordSaving}
                      onClick={() => {
                        setPasswordOtp(null);
                        setPasswordCode("");
                      }}
                      type="button"
                      variant="ghost"
                    >
                      Hủy
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </section>

          {/* Phân vùng 2: Xác thực hai bước (2FA) */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="size-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Xác thực hai bước (2FA)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Bảo vệ tài khoản bằng mã bảo mật 6 số từ Google Authenticator hoặc ứng dụng TOTP.
                  </p>
                </div>
              </div>

              {profile.mfaEnabled && mfaDisableStep === "idle" && (
                <Button onClick={() => setMfaDisableStep("password")} variant="danger">
                  Tắt xác thực hai bước
                </Button>
              )}
            </div>

            {!profile.mfaEnabled && !mfaSetup && (
              <div className="mt-5 flex flex-col items-start gap-3">
                <p className="text-xs text-slate-500">
                  Tăng cường an toàn tối đa cho dữ liệu học tập và thông tin cá nhân.
                </p>
                <Button onClick={() => void startMfa()} variant="secondary">
                  <KeyRound size={15} />
                  Kích hoạt xác thực 2 bước ngay
                </Button>
              </div>
            )}

            {/* Form cài đặt quét mã QR 2FA */}
            {mfaSetup && (
              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
                  <div className="flex flex-col items-center">
                    <p className="self-start text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                      1. Quét mã QR
                    </p>
                    <div className="size-48 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white grid place-items-center">
                      {mfaQrCode ? (
                        <Image alt="Mã QR TOTP" height={180} src={mfaQrCode} unoptimized width={180} />
                      ) : (
                        <RefreshCw className="animate-spin text-slate-400" size={24} />
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      2. Nhập mã từ ứng dụng xác thực
                    </p>
                    <div className="max-w-xs space-y-3">
                      <Field label="Mã xác thực 6 số">
                        <input
                          autoComplete="one-time-code"
                          className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`}
                          inputMode="numeric"
                          maxLength={6}
                          onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="000000"
                          value={mfaCode}
                        />
                      </Field>
                      <div className="flex gap-2">
                        <Button disabled={!/^\d{6}$/.test(mfaCode)} onClick={() => void confirmMfa()}>
                          Xác nhận & Bật
                        </Button>
                        <Button
                          onClick={() => {
                            setMfaSetup(null);
                            setMfaCode("");
                          }}
                          variant="ghost"
                        >
                          Hủy
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bước tắt 2FA */}
            {profile.mfaEnabled && mfaDisableStep === "password" && (
              <form className="mt-5 max-w-md space-y-4" onSubmit={(e) => void startDisableMfa(e)}>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nhập mật khẩu hiện tại của bạn để tiến hành tắt 2FA:
                </p>
                <Field label="Mật khẩu hiện tại">
                  <input
                    autoComplete="current-password"
                    autoFocus
                    className={inputClass}
                    minLength={8}
                    onChange={(e) => setMfaDisablePassword(e.target.value)}
                    required
                    type="password"
                    value={mfaDisablePassword}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button disabled={!mfaDisablePassword} type="submit">
                    Tiếp tục
                  </Button>
                  <Button onClick={() => setMfaDisableStep("idle")} variant="ghost">
                    Hủy
                  </Button>
                </div>
              </form>
            )}

            {profile.mfaEnabled && mfaDisableStep === "code" && (
              <form className="mt-5 max-w-md space-y-4" onSubmit={(e) => void disableMfa(e)}>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nhập mã 6 số từ ứng dụng xác thực để hoàn tất:
                </p>
                <Field label="Mã xác thực 6 số">
                  <input
                    autoComplete="one-time-code"
                    autoFocus
                    className={`${inputClass} text-center font-mono text-lg font-bold tracking-[0.3em]`}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                    value={mfaCode}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button disabled={!/^\d{6}$/.test(mfaCode)} type="submit" variant="danger">
                    Xác nhận tắt 2FA
                  </Button>
                  <Button onClick={() => setMfaDisableStep("idle")} variant="ghost">
                    Hủy
                  </Button>
                </div>
              </form>
            )}
          </section>

          {/* Phân vùng 3: Thiết bị và Phiên đăng nhập */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div className="size-9 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 grid place-items-center shrink-0">
                  <Laptop size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Thiết bị đăng nhập ({sessions.length})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Kiểm tra và quản lý các thiết bị đang đăng nhập vào tài khoản của bạn.
                  </p>
                </div>
              </div>

              {otherSessions.length > 0 && (
                <Button onClick={() => void revokeOthers()} variant="secondary">
                  <Trash2 size={15} />
                  Đóng mọi phiên khác
                </Button>
              )}
            </div>

            <div className="mt-4 space-y-2.5">
              {sessions.map((item) => {
                const device = deviceName(item.userAgent);
                const Icon = device.mobile ? Smartphone : Laptop;
                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-9 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 grid place-items-center text-slate-600 dark:text-slate-200 shrink-0">
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {device.label}
                          </strong>
                          {item.current && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold border border-emerald-300 dark:border-emerald-800">
                              Phiên hiện tại
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          IP: {item.ipAddress} · Hoạt động {new Date(item.lastSeenAt).toLocaleString(activeLocale())}
                        </p>
                      </div>
                    </div>

                    {!item.current && (
                      <Button onClick={() => void revoke(item.id)} variant="ghost">
                        <Trash2 size={14} className="text-rose-500" />
                        Đăng xuất phiên này
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** Component AccountPage bọc trong Suspense để hỗ trợ Next.js useSearchParams an toàn */
export default function AccountPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm font-semibold text-slate-500">Đang tải hồ sơ tài khoản...</div>}>
      <AccountContent />
    </Suspense>
  );
}
