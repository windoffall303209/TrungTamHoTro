-- Tài khoản Google không có mật khẩu cục bộ cho tới khi người dùng chủ động thiết lập.
ALTER TABLE `users`
  MODIFY `password_hash` VARCHAR(255) NULL,
  ADD COLUMN `google_subject` VARCHAR(255) NULL;

CREATE UNIQUE INDEX `users_google_subject_key` ON `users`(`google_subject`);

-- OTP email được tách theo đúng mục đích để không thể dùng chéo challenge.
ALTER TABLE `account_tokens`
  MODIFY `type` ENUM(
    'EMAIL_VERIFICATION',
    'PASSWORD_RESET',
    'MFA_LOGIN',
    'MFA_DISABLE',
    'PASSWORD_CHANGE_OTP',
    'MFA_SETUP_OTP',
    'MFA_DISABLE_OTP'
  ) NOT NULL;
