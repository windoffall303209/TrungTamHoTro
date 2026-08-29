-- Tài khoản đã tồn tại dùng chính email chuẩn hóa làm tên đăng nhập.
-- Mở rộng cột để chứa địa chỉ email hợp lệ; tài khoản đăng ký mới vẫn có thể dùng username riêng.
ALTER TABLE `users`
  MODIFY `username` VARCHAR(191) NOT NULL;

UPDATE `users`
SET `username` = LOWER(`email`);
