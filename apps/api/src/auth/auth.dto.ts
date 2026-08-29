import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class LoginDto {
  @IsEmail({}, { message: "Email không đúng định dạng." })
  email!: string;

  @IsString()
  @Length(8, 128, { message: "Mật khẩu phải có từ 8 đến 128 ký tự." })
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class RegisterDto {
  @IsString()
  @Length(2, 150, { message: "Họ tên phải có từ 2 đến 150 ký tự." })
  displayName!: string;

  @IsEmail({}, { message: "Email không đúng định dạng." })
  email!: string;

  @IsString()
  @Length(8, 128, { message: "Mật khẩu phải có từ 8 đến 128 ký tự." })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: "Mật khẩu cần có chữ hoa, chữ thường, số và ký tự đặc biệt.",
  })
  password!: string;
}

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

export class ChangePasswordDto {
  @IsString()
  @Length(8, 128, { message: "Mật khẩu hiện tại không hợp lệ." })
  currentPassword!: string;

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

export class DisableMfaDto extends MfaCodeDto {
  @IsString()
  @Length(8, 128, { message: "Mật khẩu hiện tại không hợp lệ." })
  password!: string;
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
