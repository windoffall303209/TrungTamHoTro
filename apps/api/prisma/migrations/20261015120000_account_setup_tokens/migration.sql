-- Phiên xác thực lần đầu sau khi đăng nhập bằng mật khẩu tạm và mã OTP gửi tới email người dùng nhập.
-- Email chỉ được ràng buộc vào mã OTP, không ghi vào tài khoản cho tới khi xác thực hoàn tất.
ALTER TYPE "AccountTokenType" ADD VALUE 'ACCOUNT_SETUP';
ALTER TYPE "AccountTokenType" ADD VALUE 'ACCOUNT_SETUP_OTP';
