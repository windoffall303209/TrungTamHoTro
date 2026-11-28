-- Chỉ mục hàng đợi thực thi, bao gồm FAILED đang chờ retry và PROCESSING hết lease.
-- Không bọc migration này trong BEGIN/COMMIT: PostgreSQL tạo index concurrently ngoài transaction.
-- Giữ index status/available_at cũ cho các truy vấn thống kê và trạng thái khác.
CREATE INDEX CONCURRENTLY "outbox_deliveries_ready_available_at_idx"
ON "outbox_deliveries" ("available_at")
WHERE "status" IN ('PENDING', 'FAILED', 'PROCESSING');
