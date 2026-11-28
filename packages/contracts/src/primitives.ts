/**
 * Quy ước tuần tự hóa kiểu nguyên thủy trên hợp đồng JSON giữa API và Web:
 * - `IsoDateTimeString`: mốc thời gian UTC theo chuẩn ISO-8601 (`Date.toISOString()`).
 * - `DecimalNumber`: cột `DECIMAL(8, 2)` trong PostgreSQL (điểm bài thi/bài tập) được chuyển sang `number` hữu hạn làm tròn 2 chữ số thập phân, tuyệt đối không trả object `Prisma.Decimal` thô.
 * - `ByteSizeNumber`: cột `BIGINT` dung lượng tệp (`size_bytes`) được kiểm tra nằm trong khoảng an toàn IEEE-754 (`0..Number.MAX_SAFE_INTEGER`) và trả `number`.
 * - `SerializedBigIntId`: khóa chính `BIGINT` tăng tự động (ví dụ `audit_logs.id`) luôn tuần tự hóa thành chuỗi thập phân (`string`) để không mất độ chính xác.
 */
export type IsoDateTimeString = string;
export type DecimalNumber = number;
export type ByteSizeNumber = number;
export type SerializedBigIntId = string;

/** Chuẩn hóa giá trị Decimal (số, chuỗi hoặc Prisma.Decimal) sang số thực hữu hạn 2 chữ số thập phân cho JSON. */
export function toDecimalNumber(
  value: number | string | { toNumber(): number },
): DecimalNumber {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : value.toNumber();
  if (!Number.isFinite(numeric)) {
    throw new RangeError("Giá trị Decimal không hợp lệ hoặc vượt giới hạn số hữu hạn.");
  }
  return Math.round(numeric * 100) / 100;
}

/** Chuẩn hóa kích thước byte kiểu BigInt sang số nguyên không âm an toàn cho JSON. */
export function toSafeByteSize(value: bigint | number | string): ByteSizeNumber {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new RangeError("Kích thước tệp vượt giới hạn số nguyên an toàn của JSON.");
  }
  return numeric;
}

/** Tuần tự hóa khóa chính BigInt sang chuỗi thập phân chuẩn không mất độ chính xác. */
export function serializeBigIntId(value: bigint | number | string): SerializedBigIntId {
  const text = typeof value === "bigint" ? value.toString(10) : String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new RangeError("Định danh BigInt phải là chuỗi số nguyên không âm.");
  }
  return text;
}
