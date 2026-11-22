import { SetMetadata, type CustomDecorator } from "@nestjs/common";

/** Khóa metadata đánh dấu handler vẫn được chạy khi hệ thống ở chế độ bảo trì. */
export const ALLOW_DURING_MAINTENANCE = "wind:allow-during-maintenance";

/**
 * Cho phép đúng handler này nhận mutation khi đang bảo trì (đăng nhập, tắt bảo trì, sao lưu/khôi phục).
 * Guard đọc metadata của handler mà router đã chọn nên không thể lách bằng đường dẫn chứa `..` hay mã hóa phần trăm.
 */
export function AllowDuringMaintenance(): CustomDecorator<string> {
  return SetMetadata(ALLOW_DURING_MAINTENANCE, true);
}
