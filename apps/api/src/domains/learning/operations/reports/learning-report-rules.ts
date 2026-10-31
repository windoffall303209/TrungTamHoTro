import { BadRequestException } from "@nestjs/common";
import type {
  LearnerProgress,
  OperationalReport,
  RiskThresholds,
} from "../../core/learning.types.js";

/** Parse khoảng báo cáo, áp dụng mặc định và từ chối ngày đảo ngược/không hợp lệ. */
export function reportingPeriod(
  fromInput?: string,
  toInput?: string,
): { from: Date; to: Date } {
  const to = toInput ? new Date(toInput) : new Date();
  const from = fromInput
    ? new Date(fromInput)
    : new Date(to.getTime() - 365 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    throw new BadRequestException("Khoảng thời gian báo cáo không hợp lệ.");
  if (from > to)
    throw new BadRequestException(
      "Ngày bắt đầu báo cáo phải trước ngày kết thúc.",
    );
  if (to.getTime() - from.getTime() > 5 * 365 * 86_400_000)
    throw new BadRequestException(
      "Khoảng thời gian báo cáo không được vượt quá 5 năm.",
    );
  return { from, to };
}

/** Bảo đảm các ngưỡng rủi ro nằm trong miền phần trăm hợp lệ. */
export function validateRiskThresholds(thresholds: RiskThresholds): void {
  for (const [name, value] of Object.entries(thresholds))
    if (!Number.isInteger(value) || value < 1 || value > 100)
      throw new BadRequestException(
        `Ngưỡng ${name} phải là số nguyên từ 1 đến 100.`,
      );
}

/** Dùng Intl kiểm tra tên múi giờ IANA trước khi lưu lớp. */
export function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("vi-VN", { timeZone: timezone }).format(new Date());
  } catch {
    throw new BadRequestException("Múi giờ lớp học không hợp lệ.");
  }
}

/** Tính phần trăm làm tròn và tránh chia cho zero. */
export function percentage(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 10_000) / 100
    : 0;
}

/** Trả mốc ISO mới nhất hoặc undefined khi không có dữ liệu. */
export function latestDate(values: Date[]): string | undefined {
  if (!values.length) return undefined;
  const latest = values.reduce(
    (maximum, value) => Math.max(maximum, value.getTime()),
    -Infinity,
  );
  return new Date(latest).toISOString();
}

/** So sánh chỉ số học viên với ngưỡng để sinh mức và lý do rủi ro. */
export function buildLearnerProgress(
  input: Omit<LearnerProgress, "riskLevel" | "riskReasons"> & {
    thresholds: RiskThresholds;
  },
): LearnerProgress {
  const reasons: string[] = [];
  if (input.attendanceRate < input.thresholds.attendanceBelow)
    reasons.push(
      `Điểm danh ${input.attendanceRate}% thấp hơn ngưỡng ${input.thresholds.attendanceBelow}%.`,
    );
  if (input.averageScore < input.thresholds.scoreBelow)
    reasons.push(
      `Điểm trung bình ${input.averageScore}% thấp hơn ngưỡng ${input.thresholds.scoreBelow}%.`,
    );
  const overallCompletion =
    Math.round(
      ((input.materialCompletionRate + input.assessmentCompletionRate) / 2) *
        100,
    ) / 100;
  if (overallCompletion < input.thresholds.completionBelow)
    reasons.push(
      `Tiến độ tổng hợp ${overallCompletion}% thấp hơn ngưỡng ${input.thresholds.completionBelow}%.`,
    );
  const riskLevel: LearnerProgress["riskLevel"] =
    reasons.length >= 2 ? "HIGH" : reasons.length === 1 ? "MEDIUM" : "LOW";
  return {
    learnerId: input.learnerId,
    materialCompletionRate: input.materialCompletionRate,
    assessmentCompletionRate: input.assessmentCompletionRate,
    attendanceRate: input.attendanceRate,
    averageScore: input.averageScore,
    lastActivityAt: input.lastActivityAt,
    interventions: input.interventions,
    riskLevel,
    riskReasons: reasons,
  };
}

/** Chuyển snapshot vận hành sang CSV tiếng Việt có escape trường dữ liệu. */
export function operationalReportCsv(report: OperationalReport): string {
  const rows: Array<[string, string | number]> = [
    ["Phiên bản định nghĩa", report.definitionVersion],
    ["Múi giờ", report.timezone],
    ["Thời điểm tạo", report.generatedAt],
    ["Khóa học", report.courses],
    ["Lớp học", report.classes],
    ["Lớp đang hoạt động", report.activeClasses],
    ["Học viên", report.learners],
    ["Học liệu", report.materials],
    ["Học liệu đã phát hành", report.publishedMaterials],
    ["Câu hỏi", report.questions],
    ["Đề thi", report.exams],
    ["Buổi trực tuyến", report.liveSessions],
    ["Báo cáo diễn đàn mở", report.openReports],
    ["Phiếu hỗ trợ mở", report.openTickets],
  ];
  /** Bao ô CSV bằng dấu ngoặc kép và thoát dấu ngoặc kép trong nội dung. */
  const escape = (value: string | number): string =>
    `"${String(value).replaceAll('"', '""')}"`;
  return [["Chỉ số", "Giá trị"], ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}
