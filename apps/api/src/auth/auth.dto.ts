import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

/** Dữ liệu đăng nhập; lớp validation chặn dữ liệu sai trước khi AuthService kiểm tra thông tin bí mật. */
export class LoginDto {
  @IsString()
  @Length(4, 191, { message: "Tài khoản phải có từ 4 đến 191 ký tự." })
  username!: string;

  @IsString()
  @Length(8, 128, { message: "Mật khẩu phải có từ 8 đến 128 ký tự." })
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

/** Email nhận mã OTP ở bước đầu xác thực tài khoản được cấp bằng mật khẩu tạm. */
export class AccountSetupOtpDto {
  @IsString()
  @Length(32, 512, { message: "Phiên xác thực tài khoản không hợp lệ." })
  setupToken!: string;

  @IsEmail({}, { message: "Email không đúng định dạng." })
  @Length(3, 191, { message: "Email không được vượt quá 191 ký tự." })
  email!: string;
}

/** Dữ liệu hoàn tất xác thực: mã OTP đã gửi tới email, tên tài khoản và mật khẩu mới thay mật khẩu tạm. */
export class CompleteAccountSetupDto extends AccountSetupOtpDto {
  @IsString()
  @Length(20, 64, { message: "Mã OTP không còn hiệu lực. Hãy nhận mã OTP mới." })
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "Mã OTP phải gồm 6 chữ số." })
  code!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{3,31}$/, { message: "Tài khoản phải có 4–32 ký tự hợp lệ." })
  username!: string;

  @IsString()
  @Length(8, 128, { message: "Mật khẩu mới phải có từ 8 đến 128 ký tự." })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: "Mật khẩu mới cần có chữ hoa, chữ thường, số và ký tự đặc biệt.",
  })
  newPassword!: string;
}

/** Các trường hồ sơ người dùng được phép tự cập nhật. */
export class UpdateProfileDto {
  @IsString()
  @Length(2, 150, { message: "Họ tên phải có từ 2 đến 150 ký tự." })
  displayName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 30, { message: "Số điện thoại không được vượt quá 30 ký tự." })
  @Matches(/^$|^[+\d][\d\s().-]{7,29}$/, { message: "Số điện thoại không đúng định dạng." })
  phone?: string;

  @IsIn(["Asia/Bangkok", "Asia/Ho_Chi_Minh", "UTC"], { message: "Múi giờ chưa được hỗ trợ." })
  timezone!: string;

  @IsIn(["vi-VN", "en-US"], { message: "Ngôn ngữ chưa được hỗ trợ." })
  locale!: string;
}

/** Email đã xác thực của tài khoản, nhập lại để nhận mã OTP đổi mật khẩu. */
export class PasswordChangeOtpDto {
  @IsEmail({}, { message: "Email không đúng định dạng." })
  @Length(3, 191, { message: "Email không được vượt quá 191 ký tự." })
  email!: string;
}

/** Dữ liệu đổi mật khẩu: mã OTP gửi tới email tài khoản và mật khẩu mới đủ mạnh. */
export class ChangePasswordDto {
  @IsString()
  @Length(20, 64, { message: "Mã OTP không còn hiệu lực. Hãy nhận mã OTP mới." })
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "Mã OTP phải gồm 6 chữ số." })
  code!: string;

  @IsString()
  @Length(8, 128, { message: "Mật khẩu mới phải có từ 8 đến 128 ký tự." })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: "Mật khẩu mới cần có chữ hoa, chữ thường, số và ký tự đặc biệt.",
  })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: "Email không đúng định dạng." })
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(32, 512, { message: "Liên kết đặt lại mật khẩu không hợp lệ." })
  token!: string;

  @IsString()
  @Length(8, 128, { message: "Mật khẩu mới phải có từ 8 đến 128 ký tự." })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: "Mật khẩu mới cần có chữ hoa, chữ thường, số và ký tự đặc biệt.",
  })
  newPassword!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(32, 512, { message: "Liên kết xác minh email không hợp lệ." })
  token!: string;
}

export class VerifyEmailCodeDto {
  @IsString()
  @Length(20, 64, { message: "Phiên xác minh email không hợp lệ." })
  verificationId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "Mã xác minh phải gồm 6 chữ số." })
  code!: string;
}

export class ResendVerificationDto {
  @IsString()
  @Length(4, 191, { message: "Thông tin tài khoản không hợp lệ." })
  identifier!: string;

  @IsOptional()
  @IsString()
  @Length(20, 64, { message: "Phiên xác minh email không hợp lệ." })
  verificationId?: string;
}

export class VerificationStatusDto {
  @IsString()
  @Length(20, 64, { message: "Phiên xác minh email không hợp lệ." })
  verificationId!: string;
}

export class ChangeVerificationEmailDto {
  @IsString()
  @Length(20, 64, { message: "Phiên xác minh email không hợp lệ." })
  verificationId!: string;

  @IsEmail({}, { message: "Email mới không đúng định dạng." })
  @Length(3, 191, { message: "Email mới không được vượt quá 191 ký tự." })
  newEmail!: string;

  @IsString()
  @Length(8, 128, { message: "Mật khẩu hiện tại không hợp lệ." })
  password!: string;
}

/** Mã TOTP sáu chữ số dùng chung cho các bước xác nhận MFA. */
export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: "Mã xác thực phải gồm 6 chữ số." })
  code!: string;
}

export class MfaLoginDto extends MfaCodeDto {
  @IsString()
  @Length(32, 512, { message: "Phiên xác thực hai bước không hợp lệ." })
  challengeToken!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class DisableMfaPasswordDto {
  @IsString()
  @Length(8, 128, { message: "Mật khẩu hiện tại không hợp lệ." })
  password!: string;
}

export class DisableMfaDto extends MfaCodeDto {
  @IsString()
  @Length(32, 512, { message: "Phiên tắt xác thực hai bước không hợp lệ." })
  challengeToken!: string;
}

export class RecoveryMfaLoginDto {
  @IsString()
  @Length(32, 512, { message: "Phiên xác thực hai bước không hợp lệ." })
  challengeToken!: string;

  @IsString()
  @Matches(/^[A-F0-9]{5}-[A-F0-9]{5}$/i, { message: "Mã khôi phục không đúng định dạng." })
  recoveryCode!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
