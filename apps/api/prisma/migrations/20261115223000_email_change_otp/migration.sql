-- Mã OTP gửi tới địa chỉ email mới để xác minh quyền sở hữu trước khi cập nhật email tài khoản.
ALTER TYPE "AccountTokenType" ADD VALUE 'EMAIL_CHANGE_OTP';

