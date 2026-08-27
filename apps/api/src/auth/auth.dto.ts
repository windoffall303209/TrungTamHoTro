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
