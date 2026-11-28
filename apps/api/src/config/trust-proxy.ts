/**
 * Chuyển giá trị TRUST_PROXY sang tham số "trust proxy" của Express:
 * - "false"/"0"/rỗng: không tin proxy nào (mặc định, dùng địa chỉ socket);
 * - số nguyên dương: số hop proxy tin cậy phía trước API (ví dụ 1 khi chỉ có Nginx);
 * - danh sách IP/CIDR hoặc tên dải của proxy-addr ("loopback", "uniquelocal"), phân tách bởi dấu phẩy.
 * Không nhận "true" vì tin mọi proxy cho phép client tự khai X-Forwarded-For để lách rate-limit và giả IP kiểm toán.
 */
export function parseTrustProxy(raw: string | undefined): false | number | string[] {
  const value = (raw ?? "").trim();
  if (!value || value === "false" || value === "0") return false;
  if (value === "true") throw new Error("TRUST_PROXY=true tin mọi proxy và cho phép giả X-Forwarded-For; hãy khai số hop hoặc dải IP của proxy.");
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (!/^(loopback|linklocal|uniquelocal|[0-9a-fA-F:.]+(\/\d{1,3})?)$/.test(entry)) throw new Error(`TRUST_PROXY chứa giá trị không hợp lệ: ${entry}`);
  }
  return entries;
}
