import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches } from "class-validator";

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
