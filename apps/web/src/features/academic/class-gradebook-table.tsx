"use client";

import type {
  GradebookAssessmentCell,
  GradebookAssessmentColumn,
  GradebookResponse,
  GradebookRow,
} from "@/lib/learning-types";
import { getScoreColorClass } from "@/roles/instructor/class/instructor-class-workspace.helpers";
import { UserAvatar } from "@/shared/ui/user-avatar";

export interface GradebookCellSelection {
  row: GradebookRow;
  assessment: GradebookAssessmentColumn;
  cell: GradebookAssessmentCell;
}

/** Gom danh sách cột bài kiểm tra từ dữ liệu bảng điểm để hiển thị cố định 20/15/65 (tối đa 7 cột nhìn thấy). */
export function resolveAssessmentColumns(rows: GradebookRow[]): GradebookAssessmentColumn[] {
  const columns: GradebookAssessmentColumn[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const col of row.assessments ?? []) {
      if (seen.has(col.id)) continue;
      seen.add(col.id);
      columns.push(col);
    }
  }
  return columns;
}

/** Chuẩn hóa cả payload sổ điểm gọn mới ({ assessments, rows }) lẫn dạng mảng cũ (GradebookRow[]) thành một cấu trúc đồng nhất. */
export function normalizeGradebookResponse(
  payload: GradebookResponse | GradebookRow[],
): GradebookResponse {
  if (Array.isArray(payload)) {
    return {
      assessments: resolveAssessmentColumns(payload),
      rows: payload,
    };
  }
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const assessments =
    Array.isArray(payload?.assessments) && payload.assessments.length > 0
      ? payload.assessments
      : resolveAssessmentColumns(rows);
  return { assessments, rows };
}

/** Tính điểm trung bình thang 10 cho cột Trung bình cố định 15%. */
function computeRowAverage(row: GradebookRow): number | null {
  if (typeof row.averageScore === "number") return row.averageScore;
  const possible = row.examPossible + row.assignmentPossible;
  if (possible <= 0) return null;
  return Math.round(((row.examEarned + row.assignmentEarned) / possible) * 1000) / 100;
}

/** Bảng điểm chia 2 phần cố định trái (Học sinh 20%, Trung bình 15%) và vùng bài kiểm tra 65% kéo ngang nếu > 7 bài. */
export function ClassGradebookTable({
  rows,
  assessments: assessmentsProp,
  loading = false,
  emptyMessage = "Chưa có dữ liệu bảng điểm.",
  onSelectCell,
}: {
  rows: GradebookRow[];
  assessments?: GradebookAssessmentColumn[];
  loading?: boolean;
  emptyMessage?: string;
  onSelectCell?: (selection: GradebookCellSelection) => void;
}) {
  const assessments =
    assessmentsProp && assessmentsProp.length > 0
      ? assessmentsProp
      : resolveAssessmentColumns(rows);
  const hasStructuredAssessments = assessments.length > 0;
  const totalAssessments = assessments.length;
  const visibleSlots = Math.min(Math.max(1, totalAssessments), 7);
  const needsHorizontalScroll = totalAssessments > 7;

  // Khi <= 7 bài: chia đều 65% cho N bài; khi > 7 bài: giữ đúng bề rộng mỗi cột bằng 65% / 7 để cuộn ngang mượt.
  const tableStyle = needsHorizontalScroll
    ? {
        width: `calc(35cqw + ${totalAssessments} * (65cqw / 7))`,
        minWidth: `${290 + totalAssessments * 98}px`,
      }
    : {
        width: "100%",
        minWidth: "740px",
      };

  const studentColStyle = { width: "max(165px, 20cqw)", minWidth: "165px" } as const;
  const avgColStyle = {
    width: "max(105px, 15cqw)",
    minWidth: "105px",
    left: "max(165px, 20cqw)",
  } as const;
  const assessmentColStyle = needsHorizontalScroll
    ? { width: "calc(65cqw / 7)", minWidth: "98px" }
    : hasStructuredAssessments
      ? { width: `calc(65cqw / ${visibleSlots})`, minWidth: "98px" }
      : { width: "65cqw", minWidth: "240px" };

  return (
    <div
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-x-auto shadow-xs"
      style={{ containerType: "inline-size" }}
    >
      <table
        className="border-collapse text-left text-xs table-fixed"
        style={tableStyle}
      >
        <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-extrabold text-[11px] border-b border-slate-200 dark:border-slate-800">
          <tr>
            <th
              className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-800 px-4 py-3 border-r border-slate-200/70 dark:border-slate-700/70"
              style={studentColStyle}
            >
              Học sinh
            </th>
            <th
              className="sticky z-20 bg-slate-50 dark:bg-slate-800 px-3 py-3 text-center border-r border-slate-200 dark:border-slate-700 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)]"
              style={avgColStyle}
            >
              Trung bình
            </th>

            {hasStructuredAssessments ? (
              assessments.map((col) => (
                <th
                  key={col.id}
                  title={`${col.title} (Tối đa ${col.maxScore} điểm)`}
                  className="px-2.5 py-3 text-center align-middle border-r last:border-r-0 border-slate-200/60 dark:border-slate-700/50"
                  style={assessmentColStyle}
                >
                  <span className="block line-clamp-2 font-bold text-slate-800 dark:text-slate-100 leading-snug">
                    {col.title}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">
                    {col.kind === "EXAM" ? "Trắc nghiệm" : "Tự luận"} · /{col.maxScore}
                  </span>
                </th>
              ))
            ) : rows.some((r) => r.examPossible > 0 || r.assignmentPossible > 0) ? (
              <>
                <th className="px-3 py-3 text-center border-r border-slate-200/60 dark:border-slate-700/50" style={{ width: "32.5cqw" }}>
                  Điểm thi
                </th>
                <th className="px-3 py-3 text-center" style={{ width: "32.5cqw" }}>
                  Điểm bài tập
                </th>
              </>
            ) : (
              <th className="px-4 py-3 text-center text-slate-400 font-semibold" style={assessmentColStyle}>
                Chưa có bài kiểm tra đang công bố
              </th>
            )}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <tr>
              <td
                colSpan={2 + Math.max(1, totalAssessments)}
                className="p-8 text-center text-slate-500"
              >
                Đang tải bảng điểm...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={2 + Math.max(1, totalAssessments)}
                className="p-8 text-center text-slate-400"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const avgScore = computeRowAverage(row);
              return (
                <tr key={row.learnerId} className="group hover:bg-slate-50/90 dark:hover:bg-slate-800/40">
                  <td
                    className="sticky left-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/90 px-4 py-3 border-r border-slate-200/70 dark:border-slate-700/70"
                    style={studentColStyle}
                  >
                    <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100 min-w-0">
                      <UserAvatar name={row.learnerName} className="size-6 text-[10px] shrink-0" />
                      <span className="truncate">{row.learnerName}</span>
                    </div>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {row.learnerEmail}
                    </span>
                  </td>

                  <td
                    className="sticky z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/90 px-3 py-3 text-center border-r border-slate-200 dark:border-slate-700 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)]"
                    style={avgColStyle}
                  >
                    {avgScore !== null ? (
                      <div className="inline-flex flex-col items-center gap-0.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 border font-extrabold tabular-nums ${getScoreColorClass(row.totalPercent, 100)}`}
                        >
                          {avgScore.toFixed(2)}
                        </span>
                        <span className="text-[10px] font-medium text-slate-400 tabular-nums">
                          {row.totalPercent.toFixed(1)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400 font-semibold">—</span>
                    )}
                  </td>

                  {hasStructuredAssessments ? (
                    assessments.map((col) => {
                      const cell = row.cells?.find((entry) => entry.assessmentId === col.id);
                      if (!cell) {
                        return (
                          <td
                            key={col.id}
                            className="px-2.5 py-3 text-center text-slate-400 border-r last:border-r-0 border-slate-100 dark:border-slate-800/60"
                            style={assessmentColStyle}
                          >
                            —
                          </td>
                        );
                      }
                      if (cell.status === "GRADED" && typeof cell.score === "number") {
                        const clickable = Boolean(
                          onSelectCell && (cell.submissionId || cell.attemptId),
                        );
                        const scoreTitle = [
                          (cell.attemptCount ?? 0) > 1
                            ? `Điểm cao nhất trong ${cell.attemptCount} lần làm bài`
                            : "",
                          clickable ? "Nhấn để xem chi tiết bài làm" : "",
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <td
                            key={col.id}
                            className="px-2.5 py-3 text-center border-r last:border-r-0 border-slate-100 dark:border-slate-800/60"
                            style={assessmentColStyle}
                            title={scoreTitle || undefined}
                          >
                            {clickable ? (
                              <button
                                type="button"
                                aria-label={`Xem chi tiết ${col.title} của ${row.learnerName}`}
                                onClick={() =>
                                  onSelectCell?.({ row, assessment: col, cell })
                                }
                                className={`inline-flex rounded-full px-2.5 py-0.5 border font-bold tabular-nums transition-all cursor-pointer hover:scale-105 hover:ring-2 hover:ring-blue-400/60 ${getScoreColorClass(cell.score, cell.maxScore ?? col.maxScore)}`}
                              >
                                {cell.score}
                              </button>
                            ) : (
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 border font-bold tabular-nums ${getScoreColorClass(cell.score, cell.maxScore ?? col.maxScore)}`}
                              >
                                {cell.score}
                              </span>
                            )}
                            {(cell.attemptCount ?? 0) > 1 && (
                              <span className="mt-0.5 block text-[9px] font-medium text-slate-400">
                                Cao nhất ({cell.attemptCount} lượt)
                              </span>
                            )}
                          </td>
                        );
                      }
                      if (cell.status === "AWAITING_GRADE") {
                        const clickable = Boolean(
                          onSelectCell && (cell.submissionId || cell.attemptId),
                        );
                        return (
                          <td
                            key={col.id}
                            className="px-2.5 py-3 text-center border-r last:border-r-0 border-slate-100 dark:border-slate-800/60"
                            style={assessmentColStyle}
                            title={clickable ? "Nhấn để chấm bài đang chờ chấm" : undefined}
                          >
                            {clickable ? (
                              <button
                                type="button"
                                aria-label={`Chấm bài ${col.title} của ${row.learnerName}`}
                                onClick={() =>
                                  onSelectCell?.({ row, assessment: col, cell })
                                }
                                className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200/80 transition-all cursor-pointer hover:bg-amber-100 hover:ring-2 hover:ring-amber-400 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800"
                              >
                                Chờ chấm
                              </button>
                            ) : (
                              <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                Chờ chấm
                              </span>
                            )}
                          </td>
                        );
                      }
                      if (cell.status === "IN_PROGRESS") {
                        return (
                          <td
                            key={col.id}
                            className="px-2.5 py-3 text-center border-r last:border-r-0 border-slate-100 dark:border-slate-800/60"
                            style={assessmentColStyle}
                          >
                            <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                              Đang làm
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={col.id}
                          className="px-2.5 py-3 text-center text-slate-400 border-r last:border-r-0 border-slate-100 dark:border-slate-800/60"
                          style={assessmentColStyle}
                        >
                          —
                        </td>
                      );
                    })
                  ) : rows.some((r) => r.examPossible > 0 || r.assignmentPossible > 0) ? (
                    <>
                      <td className="px-3 py-3 text-center border-r border-slate-100 dark:border-slate-800/60">
                        {row.examEarned} / {row.examPossible}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {row.assignmentEarned} / {row.assignmentPossible}
                      </td>
                    </>
                  ) : (
                    <td className="px-4 py-3 text-center text-slate-400">—</td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
