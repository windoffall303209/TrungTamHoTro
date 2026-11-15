"use client";

import { FormEvent, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import {
  Camera,
  Check,
  Copy,
  KeyRound,
  Laptop,
  MailCheck,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button, Field, Modal, inputClass } from "@/shared/ui/ui";
import { apiRequest } from "@/lib/api-client";
import type { AccountProfile, AccountSession } from "@/lib/app-types";
import { useApp } from "@/providers/app-provider";
import { UserAvatar } from "@/shared/ui/user-avatar";
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

/** Chuẩn hóa và kiểm tra định dạng cơ bản của địa chỉ email trước khi gửi yêu cầu OTP. */
function parseValidEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

/** Nội dung chính của trang tài khoản, hỗ trợ tách riêng 2 tab: Thông tin cá nhân và Bảo mật */
function AccountContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "security" ? "security" : "profile";
  const [activeTab, setActiveTab] = useState<"profile" | "security">(initialTab);

  const { notify, refreshSession } = useApp();
  const { formatDateTime, locale, setLocale } = useI18n();

  const [profile, setProfile] = useState<AccountProfile>(emptyProfile);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailOtp, setEmailOtp] = useState<{ challengeId: string; email: string } | null>(null);
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailConfirming, setEmailConfirming] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailResendAt, setEmailResendAt] = useState(0);
  const emailInputId = useId();
  const newEmailInputId = useId();
  const emailOtpInputId = useId();
  const emailDraftInputRef = useRef<HTMLInputElement | null>(null);
  const emailOtpInputRef = useRef<HTMLInputElement | null>(null);
  const loadRequestId = useRef(0);

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
  const [mfaCode, setMfaCode] = useState("");
  const [mfaManualMode, setMfaManualMode] = useState(false);
  const [mfaSecretCopied, setMfaSecretCopied] = useState(false);
  const [mfaStarting, setMfaStarting] = useState(false);
  const [mfaConfirming, setMfaConfirming] = useState(false);
  const [mfaError, setMfaError] = useState("");
  const mfaCodeInputId = useId();
  const mfaCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mfaManualToggleRef = useRef<HTMLButtonElement | null>(null);
  const mfaQrToggleRef = useRef<HTMLButtonElement | null>(null);
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
    const requestId = ++loadRequestId.current;
    setLoading(true);
    try {
      const [profileData, sessionData] = await Promise.all([
        apiRequest<AccountProfile>("/account/profile"),
        apiRequest<AccountSession[]>("/account/sessions"),
      ]);
      if (requestId !== loadRequestId.current) return;
      setProfile(profileData);
      setSessions(sessionData);
      setEmailModalOpen(false);
      setEmailDraft("");
      setEmailOtp(null);
      setEmailOtpCode("");
      setEmailError("");
      if (profileData.email) setPasswordEmail(profileData.email);
    } catch (error) {
      if (requestId === loadRequestId.current) notify(error instanceof Error ? error.message : "Không thể tải thông tin tài khoản.", "error");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; loadRequestId.current += 1; };
  }, [load]);

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => () => {
    if (mfaCopiedTimer.current !== null) clearTimeout(mfaCopiedTimer.current);
  }, []);

  useEffect(() => {
    if (!mfaSetup) return;
    let active = true;
    QRCode.toDataURL(mfaSetup.otpauthUri, {
      width: 232,
      margin: 1,
      color: { dark: "#111827", light: "#ffffff" },
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
    const target = Math.max(passwordResendAt, emailResendAt);
    if (target <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setClock(current);
      if (current >= target) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [passwordResendAt, emailResendAt]);

  const passwordResendSeconds = Math.max(0, Math.ceil((passwordResendAt - clock) / 1000));
  const emailResendSeconds = Math.max(0, Math.ceil((emailResendAt - clock) / 1000));

  /** Mở hộp thoại nổi để nhập địa chỉ email mới và xác minh qua mã OTP 6 chữ số. */
  function openEmailModal() {
    setEmailDraft("");
    setEmailOtp(null);
    setEmailOtpCode("");
    setEmailError("");
    setEmailModalOpen(true);
    window.requestAnimationFrame(() => {
      emailDraftInputRef.current?.focus();
    });
  }

  /** Đóng hộp thoại đổi email và xóa toàn bộ dữ liệu nhập tạm thời bên trong. */
  function closeEmailModal() {
    if (emailSending || emailConfirming) return;
    setEmailModalOpen(false);
    setEmailDraft("");
    setEmailOtp(null);
    setEmailOtpCode("");
    setEmailError("");
  }

  /** Cập nhật email đang nhập trong hộp thoại và xóa phiên OTP cũ nếu người dùng đổi sang địa chỉ khác. */
  function handleEmailDraftChange(nextValue: string) {
    setEmailDraft(nextValue);
    if (emailError) setEmailError("");
    if (emailOtp && nextValue.trim().toLowerCase() !== emailOtp.email.toLowerCase()) {
      setEmailOtp(null);
      setEmailOtpCode("");
    }
  }

  /** Gửi hoặc gửi lại mã OTP 6 chữ số tới địa chỉ email mới người dùng vừa nhập. */
  async function requestEmailChangeOtp() {
    const normalized = parseValidEmail(emailDraft);
    if (!normalized) {
      setEmailError("Email mới không đúng định dạng.");
      emailDraftInputRef.current?.focus();
      return;
    }
    if (profile.email && normalized === profile.email.toLowerCase()) {
      setEmailError("Email mới phải khác email hiện tại của tài khoản.");
      emailDraftInputRef.current?.focus();
      return;
    }
    if (emailSending || emailConfirming || emailResendSeconds > 0) return;

    setEmailError("");
    setEmailSending(true);
    try {
      const challenge = await apiRequest<{ challengeId: string; email: string; resendAfterSeconds?: number }>(
        "/account/email/otp",
        {
          method: "POST",
          body: JSON.stringify({ email: normalized }),
        },
      );
      const now = Date.now();
      setClock(now);
      setEmailDraft(challenge.email);
      setEmailOtp({ challengeId: challenge.challengeId, email: challenge.email });
      setEmailOtpCode("");
      setEmailResendAt(now + (challenge.resendAfterSeconds ?? 60) * 1000);
      notify("Mã xác minh OTP đã được gửi đến email mới của bạn.");
      window.requestAnimationFrame(() => {
        emailOtpInputRef.current?.focus();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể gửi mã xác minh.";
      setEmailError(message);
      notify(message, "error");
    } finally {
      setEmailSending(false);
    }
  }

  /** Gửi bước hiện tại trong hộp thoại đổi email: gửi mã OTP nếu chưa gửi hoặc xác minh mã 6 số nếu đã có. */
  async function submitEmailModalForm(event: FormEvent) {
    event.preventDefault();
    const normalized = parseValidEmail(emailDraft);
    if (!emailOtp || !normalized || normalized !== emailOtp.email.toLowerCase()) {
      await requestEmailChangeOtp();
      return;
    }
    if (!/^\d{6}$/.test(emailOtpCode)) {
      setEmailError("Vui lòng nhập đủ 6 chữ số xác minh.");
      emailOtpInputRef.current?.focus();
      return;
    }

    setEmailError("");
    setEmailConfirming(true);
    try {
      const updated = await apiRequest<AccountProfile>("/account/email", {
        method: "PATCH",
        body: JSON.stringify({
          challengeId: emailOtp.challengeId,
          email: emailOtp.email,
          code: emailOtpCode,
        }),
      });
      setProfile(updated);
      if (updated.email) {
        setPasswordEmail(updated.email);
        if (passwordOtp && passwordOtp.email.toLowerCase() !== updated.email.toLowerCase()) {
          setPasswordOtp(null);
          setPasswordCode("");
        }
      }
      setEmailResendAt(0);
      setEmailModalOpen(false);
      setEmailDraft("");
      setEmailOtp(null);
      setEmailOtpCode("");
      await refreshSession();
      notify("Đã xác minh và cập nhật địa chỉ email mới.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể xác minh địa chỉ email mới.";
      setEmailError(message);
      notify(message, "error");
    } finally {
      setEmailConfirming(false);
    }
  }

  /** Kiểm tra và lưu thông tin hồ sơ cá nhân cơ bản (họ tên, SĐT, múi giờ, ngôn ngữ). */
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const trimmedName = profile.displayName.trim();
    const trimmedPhone = profile.phone.trim();

    if (trimmedName.length < 2 || trimmedName.length > 150) {
      notify("Họ tên phải có từ 2 đến 150 ký tự.", "error");
      return;
    }

    setSaving(true);
    try {
      const updated = await apiRequest<AccountProfile>("/account/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: trimmedName,
          phone: trimmedPhone,
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
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  /** Lưu ảnh avatar mới lên hệ thống */
  async function saveAvatar() {
    if (!avatarFile) return;
    setAvatarSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", avatarFile);
      const result = await apiRequest<{ avatarUrl: string }>("/account/avatar", {
        method: "POST",
        body: formData,
      });
      setProfile((prev) => ({ ...prev, avatarUrl: result.avatarUrl }));
      setAvatarFile(null);
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
      setAvatarPreview("");
      await refreshSession();
      notify("Đã xóa ảnh đại diện.", "info");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể xóa ảnh đại diện.", "error");
    } finally {
      setAvatarSaving(false);
    }
  }

  /** Gửi hoặc gửi lại mã OTP xác nhận đổi mật khẩu tới email đã xác thực của tài khoản. */
  async function requestPasswordOtp() {
    const normalizedEmail = parseValidEmail(passwordEmail);
    if (!normalizedEmail) {
      notify("Email không đúng định dạng.", "error");
      return;
    }
    setPasswordSaving(true);
    try {
      const challenge = await apiRequest<{ challengeId: string; email: string; resendAfterSeconds?: number }>(
        "/account/password/otp",
        {
          method: "POST",
          body: JSON.stringify({ email: normalizedEmail }),
        },
      );
      const now = Date.now();
      setClock(now);
      setPasswordEmail(challenge.email);
      setPasswordOtp({ challengeId: challenge.challengeId, email: challenge.email });
      setPasswordResendAt(now + (challenge.resendAfterSeconds ?? 60) * 1000);
      notify("Mã xác thực OTP đã được gửi đến email của bạn.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể gửi mã xác thực.", "error");
    } finally {
      setPasswordSaving(false);
    }
  }

  /** Gửi yêu cầu OTP để đổi mật khẩu từ biểu mẫu nhập email. */
  async function submitPasswordEmail(event: FormEvent) {
    event.preventDefault();
    await requestPasswordOtp();
  }

  /** Hoàn tất đổi mật khẩu sau khi kiểm tra định dạng mật khẩu mới và xác nhận OTP. */
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (
      passwords.newPassword.length < 8
      || passwords.newPassword.length > 128
      || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/.test(passwords.newPassword)
    ) {
      notify("Mật khẩu mới cần có chữ hoa, chữ thường, số và ký tự đặc biệt.", "error");
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      notify("Mật khẩu xác nhận không khớp.", "error");
      return;
    }
    setPasswordSaving(true);
    try {
      await apiRequest("/account/password", {
        method: "PATCH",
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

  /** Đóng hộp thoại kết nối ứng dụng xác thực và đặt lại dữ liệu thiết lập tạm thời. */
  function closeMfaSetupModal() {
    if (mfaConfirming) return;
    if (mfaCopiedTimer.current !== null) {
      clearTimeout(mfaCopiedTimer.current);
      mfaCopiedTimer.current = null;
    }
    setMfaSetup(null);
    setMfaQrCode("");
    setMfaCode("");
    setMfaManualMode(false);
    setMfaSecretCopied(false);
    setMfaError("");
  }

  /** Bắt đầu thiết lập TOTP và mở hộp thoại nổi kết nối ứng dụng xác thực. */
  async function startMfa() {
    if (mfaStarting) return;
    setMfaStarting(true);
    setMfaError("");
    setMfaManualMode(false);
    setMfaSecretCopied(false);
    setMfaQrCode("");
    try {
      const setup = await apiRequest<{ secret: string; otpauthUri: string }>("/account/mfa/setup", { method: "POST", body: "{}" });
      setMfaSetup(setup);
      setMfaCode("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể khởi tạo MFA.", "error");
    } finally {
      setMfaStarting(false);
    }
  }

  /** Chuyển đổi giữa chế độ quét mã QR và nhập khóa bí mật thủ công. */
  function toggleMfaInputMode(manual: boolean) {
    setMfaManualMode(manual);
    window.requestAnimationFrame(() => {
      if (manual) mfaQrToggleRef.current?.focus();
      else mfaManualToggleRef.current?.focus();
    });
  }

  /** Sao chép khóa thiết lập 2FA vào clipboard và hiển thị phản hồi xác nhận. */
  async function copyMfaSecret() {
    if (!mfaSetup?.secret) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mfaSetup.secret);
      } else {
        const helper = document.createElement("textarea");
        helper.value = mfaSetup.secret;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand("copy");
        helper.remove();
        if (!copied) throw new Error("Copy command rejected");
      }
      setMfaSecretCopied(true);
      if (mfaCopiedTimer.current !== null) clearTimeout(mfaCopiedTimer.current);
      mfaCopiedTimer.current = setTimeout(() => {
        mfaCopiedTimer.current = null;
        setMfaSecretCopied(false);
      }, 2000);
    } catch {
      notify("Không thể sao chép mã thiết lập. Vui lòng bôi đen và sao chép thủ công.", "error");
    }
  }

  /** Xác minh mã TOTP 6 chữ số và kích hoạt xác thực hai bước cho tài khoản. */
  async function confirmMfa(event?: FormEvent) {
    event?.preventDefault();
    const normalizedCode = mfaCode.replace(/\D/g, "").trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setMfaError("Mã xác thực phải gồm đúng 6 chữ số.");
      return;
    }
    if (mfaConfirming) return;
    setMfaConfirming(true);
    setMfaError("");
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>("/account/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: normalizedCode }),
      });
      if (mfaCopiedTimer.current !== null) {
        clearTimeout(mfaCopiedTimer.current);
        mfaCopiedTimer.current = null;
      }
      setRecoveryCodes(result.recoveryCodes);
      setMfaSetup(null);
      setMfaQrCode("");
      setMfaCode("");
      setMfaManualMode(false);
      setMfaSecretCopied(false);
      await load();
      notify("Đã bật xác thực hai bước.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể bật MFA.";
      setMfaError(message);
      notify(message, "error");
    } finally {
      setMfaConfirming(false);
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
  /** Đăng xuất khỏi toàn bộ thiết bị khác nhưng giữ nguyên phiên đang thao tác. */
  async function revokeOthers() {
    try {
      await apiRequest("/account/sessions/revoke-others", { method: "POST", body: "{}" });
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
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-600">
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
              <span className="mt-1 block text-xs text-slate-600">Tên định danh cố định không thể sửa.</span>
            </Field>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300" htmlFor={emailInputId}>
                Email
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  aria-label="Email"
                  autoComplete="email"
                  className={inputClass}
                  disabled
                  id={emailInputId}
                  maxLength={191}
                  placeholder="name@example.com"
                  readOnly
                  type="email"
                  value={profile.email ?? ""}
                />
                <Button
                  disabled={loading || saving}
                  onClick={openEmailModal}
                  type="button"
                  variant="secondary"
                >
                  <Pencil size={14} />
                  Sửa
                </Button>
              </div>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                {profile.emailVerifiedAt ? (
                  <>
                    <MailCheck size={14} className="text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Đã xác minh</span>
                  </>
                ) : (
                  <span>Chưa xác minh</span>
                )}
              </span>
            </div>

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
              <p className="text-xs text-slate-600">
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
                <p className="text-xs text-slate-500 dark:text-slate-600 mt-0.5">
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
                    <span className="mt-1 block text-[11px] text-slate-600 dark:text-slate-400">
                      Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.
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
                      disabled={passwordSaving || passwordResendSeconds > 0}
                      onClick={() => void requestPasswordOtp()}
                      type="button"
                      variant="secondary"
                    >
                      Gửi lại mã OTP{passwordResendSeconds > 0 ? ` (${passwordResendSeconds}s)` : null}
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
                  <p className="text-xs text-slate-500 dark:text-slate-600 mt-0.5">
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

            {!profile.mfaEnabled && (
              <div className="mt-5 flex flex-col items-start gap-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tăng cường an toàn tối đa cho dữ liệu học tập và thông tin cá nhân.
                </p>
                <Button loading={mfaStarting} onClick={() => void startMfa()} variant="secondary">
                  <KeyRound size={15} />
                  Kích hoạt xác thực 2 bước ngay
                </Button>
              </div>
            )}

            {/* Hộp thoại nổi kết nối ứng dụng xác thực 2FA */}
            <Modal
              description="Dùng ứng dụng xác thực để quét mã QR, rồi nhập mã gồm 6 chữ số từ ứng dụng"
              onClose={closeMfaSetupModal}
              open={Boolean(mfaSetup)}
              size="sm"
              title="Kết nối ứng dụng xác thực"
            >
              {mfaSetup && (
                <form className="space-y-5" onSubmit={(event) => void confirmMfa(event)}>
                  {mfaManualMode ? (
                    <div className="space-y-3 pt-1">
                      <p
                        className="py-1.5 text-center font-mono text-sm sm:text-[15px] font-bold tracking-[0.06em] text-slate-900 dark:text-slate-100 select-all break-all"
                        data-i18n-skip
                      >
                        {mfaSetup.secret}
                      </p>

                      <div className="flex justify-center">
                        <button
                          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                          onClick={() => void copyMfaSecret()}
                          type="button"
                        >
                          {mfaSecretCopied ? (
                            <Check aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" size={15} />
                          ) : (
                            <Copy aria-hidden="true" size={15} />
                          )}
                          <span>{mfaSecretCopied ? "Đã sao chép code" : "Sao chép code"}</span>
                        </button>
                      </div>

                      <button
                        className="w-full rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 px-4 py-2.5 text-left text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer focus:outline-none focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/35"
                        onClick={() => toggleMfaInputMode(false)}
                        ref={mfaQrToggleRef}
                        type="button"
                      >
                        Hiện mã QR
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-center pt-1">
                        <div className="size-48 sm:size-52 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white p-2.5 shadow-xs grid place-items-center">
                          {mfaQrCode ? (
                            <Image
                              alt="Mã QR TOTP"
                              className="size-full object-contain"
                              height={188}
                              src={mfaQrCode}
                              unoptimized
                              width={188}
                            />
                          ) : (
                            <RefreshCw className="animate-spin text-slate-500" size={24} />
                          )}
                        </div>
                      </div>

                      <div>
                        <button
                          className="inline-flex items-center rounded-md px-1 py-0.5 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                          onClick={() => toggleMfaInputMode(true)}
                          ref={mfaManualToggleRef}
                          type="button"
                        >
                          Không thể quét? Hãy nhập mã theo cách thủ công
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      className="block text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200"
                      htmlFor={mfaCodeInputId}
                    >
                      Mã gồm 6 chữ số
                    </label>
                    <input
                      aria-invalid={Boolean(mfaError) || undefined}
                      autoComplete="one-time-code"
                      className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950/70 px-3.5 py-2 font-mono text-base font-semibold tracking-[0.22em] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25"
                      id={mfaCodeInputId}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) => {
                        setMfaCode(event.target.value.replace(/\D/g, ""));
                        if (mfaError) setMfaError("");
                      }}
                      value={mfaCode}
                    />
                    {mfaError ? (
                      <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
                        {mfaError}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <Button
                      disabled={mfaConfirming}
                      onClick={closeMfaSetupModal}
                      shape="pill"
                      type="button"
                      variant="secondary"
                    >
                      Huỷ
                    </Button>
                    <Button
                      disabled={!/^\d{6}$/.test(mfaCode) || mfaConfirming}
                      loading={mfaConfirming}
                      shape="pill"
                      type="submit"
                      variant="primary"
                    >
                      Xác minh
                    </Button>
                  </div>
                </form>
              )}
            </Modal>

            {recoveryCodes.length > 0 && (
              <div className="mt-5 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30" role="status">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Lưu mã khôi phục ngay</p>
                <p className="text-xs leading-5 text-amber-800 dark:text-amber-300">
                  Mỗi mã chỉ dùng một lần để đăng nhập khi không có ứng dụng xác thực. Đây là lần duy nhất các mã được hiển thị; hãy lưu chúng ở nơi an toàn trước khi đóng.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {recoveryCodes.map((code) => (
                    <code className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-center text-sm font-semibold tracking-wider text-slate-900 dark:border-amber-900 dark:bg-slate-900 dark:text-slate-100" key={code}>
                      {code}
                    </code>
                  ))}
                </div>
                <Button onClick={() => setRecoveryCodes([])} variant="secondary">Tôi đã lưu mã khôi phục</Button>
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
                  <p className="text-xs text-slate-500 dark:text-slate-600 mt-0.5">
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
                        <p className="text-[11px] text-slate-500 dark:text-slate-600 mt-0.5">
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

      {/* Hộp thoại nổi thay đổi và xác minh địa chỉ email mới */}
      <Modal
        description="Nhập địa chỉ email mới, gửi mã xác minh gồm 6 chữ số rồi xác nhận để cập nhật tài khoản"
        onClose={closeEmailModal}
        open={emailModalOpen}
        size="sm"
        title="Thay đổi địa chỉ email"
      >
        <form className="space-y-4" onSubmit={(event) => void submitEmailModalForm(event)}>
          {profile.email ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/70 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
              <span>Email hiện tại:</span>{" "}
              <strong className="font-semibold text-slate-900 dark:text-slate-100 break-all" data-i18n-skip>
                {profile.email}
              </strong>
            </div>
          ) : null}

          <div>
            <label
              className="block text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200"
              htmlFor={newEmailInputId}
            >
              Email mới
            </label>
            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                aria-invalid={Boolean(emailError) || undefined}
                autoComplete="email"
                className="min-h-11 w-full flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950/70 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:opacity-60"
                disabled={emailConfirming}
                id={newEmailInputId}
                maxLength={191}
                onChange={(event) => handleEmailDraftChange(event.target.value)}
                placeholder="name@example.com"
                ref={emailDraftInputRef}
                type="email"
                value={emailDraft}
              />
              <Button
                className="shrink-0 min-h-11"
                disabled={!emailDraft.trim() || emailSending || emailConfirming || emailResendSeconds > 0}
                loading={emailSending}
                onClick={() => void requestEmailChangeOtp()}
                type="button"
                variant="secondary"
              >
                <span>{emailOtp ? "Gửi lại mã" : "Gửi mã xác minh"}</span>
                {emailResendSeconds > 0 ? (
                  <span className="tabular-nums" data-i18n-skip>
                    ({emailResendSeconds}s)
                  </span>
                ) : null}
              </Button>
            </div>
          </div>

          {emailOtp ? (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/90 dark:bg-emerald-950/35 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200" role="status">
              <MailCheck aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" size={15} />
              <div className="min-w-0 leading-5">
                <span>Mã xác minh 6 chữ số đã được gửi tới:</span>{" "}
                <strong className="break-all" data-i18n-skip>
                  {emailOtp.email}
                </strong>
              </div>
            </div>
          ) : null}

          <div>
            <label
              className="block text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200"
              htmlFor={emailOtpInputId}
            >
              Mã gồm 6 chữ số
            </label>
            <input
              aria-invalid={Boolean(emailError) || undefined}
              autoComplete="one-time-code"
              className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950/70 px-3.5 py-2 font-mono text-base font-semibold tracking-[0.22em] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!emailOtp || emailConfirming}
              id={emailOtpInputId}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => {
                setEmailOtpCode(event.target.value.replace(/\D/g, ""));
                if (emailError) setEmailError("");
              }}
              placeholder="000000"
              ref={emailOtpInputRef}
              value={emailOtpCode}
            />
            {emailError ? (
              <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
                {emailError}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <Button
              disabled={emailSending || emailConfirming}
              onClick={closeEmailModal}
              shape="pill"
              type="button"
              variant="secondary"
            >
              Huỷ
            </Button>
            <Button
              disabled={!emailOtp || !/^\d{6}$/.test(emailOtpCode) || emailSending || emailConfirming}
              loading={emailConfirming}
              shape="pill"
              type="submit"
              variant="primary"
            >
              Xác minh
            </Button>
          </div>
        </form>
      </Modal>
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
