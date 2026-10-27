"use client";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { SectionState } from "@/components/section-state";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { UserPicker } from "@/components/user-picker";
import { activeLocale } from "@/i18n/runtime";
import type { InstructorRole } from "@/lib/learning-types";
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  History,
  ListChecks,
  MessageCircle,
  Repeat2,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserPlus,
} from "lucide-react";
import { DetailTab, roleLabel } from "./class-detail.shared";
import { useClassDetailModel } from "./use-class-detail-model";
import { LearnerClassWorkspace } from "@/features/learner-class/learner-class-workspace";
import { InstructorClassWorkspace } from "@/features/instructor-class/instructor-class-workspace";

/** Lắp ghép màn hình chi tiết lớp từ trạng thái, hành động và các thành phần nghiệp vụ. */
export default function ClassDetailScreen() {
  const model = useClassDetailModel();
  const {
    router,
    session,
    allowed,
    canManage,
    item,
    course,
    roster,
    readiness,
    activeTab,
    setActiveTab,
    loading,
    saving,
    instructorForm,
    setInstructorForm,
    learnerId,
    setLearnerId,
    bulkLearners,
    setBulkLearners,
    importResults,
    removeTarget,
    setRemoveTarget,
    removeReason,
    setRemoveReason,
    transferTarget,
    setTransferTarget,
    transferReason,
    setTransferReason,
    activeEnrollments,
    instructors,
    primaryInstructor,
    learnerPagination,
    historyPagination,
    assignInstructor,
    transferPrimary,
    enrollLearner,
    importEnrollments,
    removeMember,
    activate,
  } = model;

  if (!allowed) return <AccessDenied />;

  const tabs: Array<{ value: DetailTab; label: string; count?: number }> = [
    { value: "overview", label: "Tổng quan" },
    {
      value: "instructors",
      label: "Giảng viên",
      count: roster?.instructors.length ?? item?.instructorIds.length ?? 0,
    },
    {
      value: "learners",
      label: "Học viên",
      count: activeEnrollments.length || item?.learnerIds.length || 0,
    },
    ...(canManage
      ? [{ value: "operations" as const, label: "Vận hành lớp" }]
      : []),
  ];

  return (
    <SectionState loading={loading} empty={!item}>
      {item ? (
        session.roleCode === "LEARNER" ? (
          <LearnerClassWorkspace
            item={item}
            course={course}
            teacherName={primaryInstructor?.displayName || "Wind Fall"}
            instructors={instructors}
            onBack={() => router.push("/courses")}
          />
        ) : session.roleCode === "INSTRUCTOR" ? (
          <InstructorClassWorkspace
            item={item}
            course={course}
            instructors={instructors}
            onBack={() => router.push("/courses")}
          />
        ) : (
          <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
            <button
              className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-bold text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              onClick={() => router.push("/courses")}
              type="button"
            >
              <ArrowLeft size={17} />
              Quay lại danh sách lớp
            </button>
            <header className="flex flex-col gap-5 border-b border-slate-200 dark:border-slate-800 pb-6 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-xs font-semibold text-sky-700 dark:text-sky-300">
                    {item.code} · {item.term}
                  </span>
                  <StatusBadge status={item.status} />
                </div>
                <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {item.name}
                </h1>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                  {course
                    ? `${course.code} — ${course.name}`
                    : `Khóa học ${item.courseId}`}{" "}
                  · Phiên bản {item.courseVersion}
                </p>
              </div>
              {canManage && item.status === "DRAFT" ? (
                <Button loading={saving} onClick={() => void activate()}>
                  <CheckCircle2 size={17} />
                  Kích hoạt lớp
                </Button>
              ) : null}
            </header>

            <Tabs
              className="mt-6"
              items={tabs}
              label="Nội dung hồ sơ lớp"
              onChange={setActiveTab}
              value={activeTab}
            />

            <section
              aria-label="Tổng quan lớp"
              className="mt-6"
              hidden={activeTab !== "overview"}
              role="tabpanel"
            >
              {["INSTRUCTOR", "LEARNER"].includes(session.roleCode) ? (
                <nav
                  aria-label="Không gian lớp"
                  className="mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
                >
                  {[
                    {
                      label: "Học liệu",
                      href: `/materials?classId=${encodeURIComponent(item.id)}`,
                      icon: BookOpenCheck,
                    },
                    {
                      label: "Bài tập",
                      href: `/academic?classId=${encodeURIComponent(item.id)}`,
                      icon: ListChecks,
                    },
                    {
                      label: "Đề & kết quả",
                      href: `/exams?classId=${encodeURIComponent(item.id)}`,
                      icon: CheckCircle2,
                    },
                    {
                      label: "Trao đổi",
                      href: `/forum?classId=${encodeURIComponent(item.id)}`,
                      icon: MessageCircle,
                    },
                    {
                      label: "Tin nhắn lớp",
                      href: `/messages?classId=${encodeURIComponent(item.id)}`,
                      icon: CalendarDays,
                    },
                  ].map(({ label, href, icon: Icon }) => (
                    <Link
                      className="flex items-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 text-sm font-bold text-slate-800 dark:text-slate-200 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 hover:text-sky-600 dark:hover:text-sky-400 transition-all"
                      href={href}
                      key={label}
                    >
                      <Icon size={18} className="text-sky-600 dark:text-sky-400 shrink-0" />
                      <span>{label}</span>
                    </Link>
                  ))}
                </nav>
              ) : null}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  {
                    label: "Khai giảng",
                    value: new Date(item.startAt).toLocaleDateString(
                      activeLocale(),
                    ),
                  },
                  {
                    label: "Kết thúc",
                    value: new Date(item.endAt).toLocaleDateString(
                      activeLocale(),
                    ),
                  },
                  {
                    label: "Sức chứa",
                    value: `${item.learnerIds.length}/${item.capacity} học viên`,
                  },
                  { label: "Múi giờ", value: item.timezone },
                ].map((metric) => (
                  <div
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs"
                    key={metric.label}
                  >
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {metric.label}
                    </p>
                    <p className="mt-1.5 break-words text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid gap-6 lg:grid-cols-[1fr_.85fr]">
                <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Thông tin lớp
                  </h2>
                  <dl className="mt-4 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {[
                      { label: "Mã lớp", value: item.code },
                      { label: "Học kỳ", value: item.term },
                      {
                        label: "Khóa học",
                        value: course?.name ?? item.courseId,
                      },
                      {
                        label: "Phiên bản nội dung",
                        value: `Phiên bản ${item.courseVersion}`,
                      },
                      {
                        label: "Ghi danh muộn",
                        value: item.allowLateEnrollment
                          ? "Được phép"
                          : "Không cho phép",
                      },
                    ].map((row) => (
                      <div
                        className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr]"
                        key={row.label}
                      >
                        <dt className="font-medium text-slate-500 dark:text-slate-400">
                          {row.label}
                        </dt>
                        <dd className="font-semibold text-slate-900 dark:text-slate-100">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Việc nên làm tiếp
                  </h2>
                  <ol className="mt-4 space-y-3.5 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {!canManage ? (
                      item.status === "ACTIVE" ? (
                        <>
                          <li>
                            <Link
                              className="font-bold text-sky-600 dark:text-sky-400 hover:underline"
                              href={`/academic?classId=${encodeURIComponent(item.id)}`}
                            >
                              {(session.roleCode as string) === "LEARNER"
                                ? "Xem lịch và bài tập của lớp"
                                : "Theo dõi lịch dạy và bài tập"}
                            </Link>
                          </li>
                          <li>
                            <Link
                              className="font-bold text-sky-600 dark:text-sky-400 hover:underline"
                              href={`/exams?classId=${encodeURIComponent(item.id)}`}
                            >
                              {(session.roleCode as string) === "LEARNER"
                                ? "Làm đề thi và xem kết quả"
                                : "Quản lý đề thi của lớp"}
                            </Link>
                          </li>
                          <li>
                            <Link
                              className="font-bold text-sky-600 dark:text-sky-400 hover:underline"
                              href={`/materials?classId=${encodeURIComponent(item.id)}`}
                            >
                              Mở học liệu của lớp
                            </Link>
                          </li>
                        </>
                      ) : (
                        <li>
                          Lớp chưa hoạt động hoặc đã kết thúc. Bạn có thể xem
                          thông tin lớp; liên hệ quản lý nếu cần hỗ trợ.
                        </li>
                      )
                    ) : item.status === "DRAFT" ? (
                      <>
                        <li>
                          <strong className="text-slate-900 dark:text-slate-100">
                            1. Phân công giảng viên chính
                          </strong>
                          <br />
                          Lớp cần ít nhất một giảng viên trước khi kích hoạt.
                        </li>
                        <li>
                          <strong className="text-slate-900 dark:text-slate-100">
                            2. Ghi danh học viên
                          </strong>
                          <br />
                          Thêm từng người hoặc nhập danh sách email hàng loạt.
                        </li>
                        <li>
                          <strong className="text-slate-900 dark:text-slate-100">
                            3. Kích hoạt lớp
                          </strong>
                          <br />
                          Mở lớp sau khi nhân sự và lịch học đã đúng.
                        </li>
                      </>
                    ) : item.status === "ACTIVE" ? (
                      <>
                        <li>
                          <strong className="text-slate-900 dark:text-slate-100">
                            1. Theo dõi thành viên
                          </strong>
                          <br />
                          Cập nhật người phụ trách và sĩ số khi có thay đổi.
                        </li>
                        <li>
                          <strong className="text-slate-900 dark:text-slate-100">
                            2. Vận hành dạy học
                          </strong>
                          <br />
                          Tiếp tục với học liệu, đề thi và buổi học trực tuyến.
                        </li>
                        <li>
                          <strong className="text-slate-900 dark:text-slate-100">
                            3. Đóng lớp khi hoàn tất
                          </strong>
                          <br />
                          Kiểm tra bài chấm, điểm danh và yêu cầu còn mở trước
                          khi lưu trữ.
                        </li>
                      </>
                    ) : (
                      <>
                        <li>
                          <strong className="text-slate-900 dark:text-slate-100">
                            Lớp đang ở chế độ chỉ đọc.
                          </strong>
                          <br />
                          Dữ liệu vẫn được giữ để tra cứu. Quản lý có thể mở lại
                          lớp với lý do được lưu audit.
                        </li>
                      </>
                    )}
                  </ol>
                </section>
              </div>
            </section>

            <section
              aria-label="Giảng viên của lớp"
              className="mt-7"
              hidden={activeTab !== "instructors"}
              role="tabpanel"
            >
              <div className="flex flex-col gap-2 border-b border-slate-200 dark:border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    Đội ngũ giảng dạy
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Một giảng viên chính chịu trách nhiệm lớp; đồng giảng viên
                    cùng hỗ trợ giảng dạy.
                  </p>
                </div>
                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                  {roster?.instructors.length ?? item.instructorIds.length}{" "}
                  người
                </span>
              </div>
              {canManage && item.status !== "CLOSED" ? (
                <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem_auto]">
                  <UserPicker
                    classId={item.id}
                    label="Chọn giảng viên"
                    onChange={(userId) =>
                      setInstructorForm({ ...instructorForm, userId })
                    }
                    role="INSTRUCTOR"
                    value={instructorForm.userId}
                  />
                  <Field label="Vai trò">
                    <select
                      className={inputClass}
                      onChange={(event) =>
                        setInstructorForm({
                          ...instructorForm,
                          role: event.target.value as InstructorRole,
                        })
                      }
                      value={instructorForm.role}
                    >
                      <option
                        disabled={Boolean(primaryInstructor)}
                        value="PRIMARY"
                      >
                        Giảng viên chính
                      </option>
                      <option value="CO_INSTRUCTOR">Đồng giảng viên</option>
                    </select>
                  </Field>
                  <Button
                    className="md:mt-7"
                    disabled={
                      !instructorForm.userId ||
                      Boolean(
                        primaryInstructor && instructorForm.role === "PRIMARY",
                      )
                    }
                    loading={saving}
                    onClick={() => void assignInstructor()}
                  >
                    <UserPlus size={16} />
                    Phân công
                  </Button>
                  {primaryInstructor && instructorForm.role === "PRIMARY" ? (
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 md:col-span-3">
                      Lớp đã có giảng viên chính. Thêm người mới làm đồng giảng
                      viên, sau đó dùng “Bàn giao vai trò”.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-5 space-y-3">
                {instructors.map((instructor) => (
                  <article
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                    key={instructor.instructorId}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-slate-900 dark:text-slate-100">
                          {instructor.displayName || instructor.instructorId}
                        </h3>
                        <span className="rounded-full bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                          {roleLabel[instructor.role]}
                        </span>
                      </div>
                      {instructor.email ? (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {instructor.email}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {instructor.instructorId !== session.user.id ? (
                        <Link
                          className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition-colors"
                          href={`/messages?userId=${encodeURIComponent(instructor.instructorId)}`}
                        >
                          <MessageCircle className="mr-1.5" size={15} />
                          Nhắn tin
                        </Link>
                      ) : null}
                      {canManage && item.status !== "CLOSED" ? (
                        <>
                          {instructor.role === "CO_INSTRUCTOR" &&
                          primaryInstructor ? (
                            <Button
                              onClick={() =>
                                setTransferTarget({
                                  id: instructor.instructorId,
                                  name:
                                    instructor.displayName ||
                                    instructor.instructorId,
                                })
                              }
                              variant="secondary"
                            >
                              <Repeat2 size={15} />
                              Bàn giao vai trò
                            </Button>
                          ) : null}
                          <Button
                            aria-label={`Gỡ ${instructor.displayName || instructor.instructorId}`}
                            disabled={instructor.role === "PRIMARY"}
                            onClick={() =>
                              setRemoveTarget({
                                kind: "instructors",
                                id: instructor.instructorId,
                                name:
                                    instructor.displayName ||
                                    instructor.instructorId,
                              })
                            }
                            variant="ghost"
                          >
                            <Trash2 size={15} />
                            Gỡ phân công
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </article>
                ))}
                {!item.instructorIds.length ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
                    Chưa có giảng viên phụ trách. Đây là bước bắt buộc trước khi
                    kích hoạt lớp.
                  </p>
                ) : null}
              </div>
            </section>

            <section
              aria-label="Học viên của lớp"
              className="mt-7"
              hidden={activeTab !== "learners"}
              role="tabpanel"
            >
              <div className="flex flex-col gap-2 border-b border-slate-200 dark:border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    Danh sách học viên
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Theo dõi sĩ số và nguồn ghi danh của từng học viên.
                  </p>
                </div>
                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                  {item.learnerIds.length}/{item.capacity} học viên
                </span>
              </div>
              {canManage && item.status !== "CLOSED" ? (
                <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs grid gap-5 lg:grid-cols-2">
                  <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
                    <UserPicker
                      classId={item.id}
                      label="Chọn một học viên"
                      onChange={setLearnerId}
                      role="LEARNER"
                      value={learnerId}
                    />
                    <Button
                      disabled={!learnerId}
                      loading={saving}
                      onClick={() => void enrollLearner()}
                    >
                      <UserPlus size={16} />
                      Ghi danh
                    </Button>
                  </div>
                  <div>
                    <Field label="Nhập hàng loạt — email hoặc mã, mỗi dòng một người">
                      <textarea
                        className={inputClass}
                        onChange={(event) =>
                          setBulkLearners(event.target.value)
                        }
                        placeholder="hocvien01@example.com&#10;hocvien02@example.com"
                        rows={3}
                        value={bulkLearners}
                      />
                    </Field>
                    <Button
                      className="mt-2"
                      disabled={!bulkLearners.trim()}
                      loading={saving}
                      onClick={() => void importEnrollments()}
                      variant="secondary"
                    >
                      Kiểm tra và nhập danh sách
                    </Button>
                  </div>
                </div>
              ) : null}
              {importResults.length ? (
                <div
                  aria-live="polite"
                  className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 text-xs space-y-1"
                >
                  {importResults.map((result, index) => (
                    <p
                      className={`py-0.5 ${result.status === "ENROLLED" ? "text-emerald-700 dark:text-emerald-400" : result.status === "FAILED" ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}`}
                      key={`${result.userId}-${index}`}
                    >
                      <strong>{result.userId}</strong>: {result.message}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="mt-5 space-y-3">
                {(canManage
                  ? learnerPagination.pageItems
                  : item.learnerIds.map((learnerIdValue) => ({
                      learnerId: learnerIdValue,
                      status: "ACTIVE" as const,
                      source: "",
                      joinedAt: "",
                    }))
                ).map((learner) => (
                  <article
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                    key={learner.learnerId}
                  >
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 dark:text-slate-100">
                        {"displayName" in learner && learner.displayName
                          ? learner.displayName
                          : learner.learnerId}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {"email" in learner && learner.email
                          ? `${learner.email} · `
                          : ""}
                        {learner.source
                          ? learner.source === "MANUAL"
                            ? "Ghi danh thủ công"
                            : "Nhập hàng loạt"
                          : "Đang học"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {learner.learnerId !== session.user.id ? (
                        <Link
                          className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 dark:border-slate-800 px-3.5 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 transition-colors"
                          href={`/messages?userId=${encodeURIComponent(learner.learnerId)}`}
                        >
                          <MessageCircle className="mr-1.5" size={15} />
                          Nhắn tin
                        </Link>
                      ) : null}
                      {canManage && item.status !== "CLOSED" ? (
                        <Button
                          onClick={() =>
                            setRemoveTarget({
                              kind: "enrollments",
                              id: learner.learnerId,
                              name:
                                "displayName" in learner
                                  ? (learner.displayName ?? learner.learnerId)
                                  : learner.learnerId,
                            })
                          }
                          variant="ghost"
                        >
                          <Trash2 size={15} />
                          Gỡ khỏi lớp
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
                {!item.learnerIds.length ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
                    Chưa có học viên được ghi danh.
                  </p>
                ) : null}
              </div>
              {canManage ? (
                <Pagination
                  itemLabel="học viên"
                  onPageChange={learnerPagination.setPage}
                  onPageSizeChange={learnerPagination.setPageSize}
                  page={learnerPagination.page}
                  pageSize={learnerPagination.pageSize}
                  totalItems={learnerPagination.totalItems}
                />
              ) : null}
            </section>

            {canManage ? (
              <section
                aria-label="Vận hành lớp"
                className="mt-7"
                hidden={activeTab !== "operations"}
                role="tabpanel"
              >
                <div className="grid gap-6 lg:grid-cols-[1fr_.9fr]">
                  <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="grid size-9 place-items-center rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-sky-600 dark:text-sky-400">
                        <BookOpenCheck size={18} />
                      </div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        Trạng thái vận hành
                      </h2>
                    </div>
                    <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className={`rounded-xl border p-3 ${item.status === "DRAFT" ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold" : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-500"}`}>
                        <p className="font-bold">Nháp</p>
                        <p className="mt-0.5 text-[11px]">Chuẩn bị</p>
                      </div>
                      <div className={`rounded-xl border p-3 ${item.status === "ACTIVE" ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold" : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-500"}`}>
                        <p className="font-bold">Hoạt động</p>
                        <p className="mt-0.5 text-[11px]">Đang dạy</p>
                      </div>
                      <div className={`rounded-xl border p-3 ${item.status === "CLOSED" ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold" : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-500"}`}>
                        <p className="font-bold">Đã đóng</p>
                        <p className="mt-0.5 text-[11px]">Chỉ đọc</p>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-400">
                      “Vận hành lớp” là nơi kích hoạt lớp, kiểm tra điều kiện
                      kết thúc, đóng để lưu trữ hoặc mở lại. Đóng lớp không xóa
                      học liệu, điểm, bài thi hay điểm danh.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {item.status === "DRAFT" ? (
                        <Button
                          loading={saving}
                          onClick={() => void activate()}
                        >
                          <CheckCircle2 size={16} />
                          Kích hoạt lớp
                        </Button>
                      ) : null}
                      <Button
                        onClick={() =>
                          router.push(`/class-lifecycle?classId=${item.id}`)
                        }
                        variant={
                          item.status === "CLOSED" ? "primary" : "secondary"
                        }
                      >
                        {item.status === "CLOSED" ? (
                          <RotateCcw size={16} />
                        ) : (
                          <CalendarDays size={16} />
                        )}
                        {item.status === "CLOSED"
                          ? "Mở lại lớp"
                          : "Kiểm tra trước khi đóng"}
                      </Button>
                    </div>
                  </section>
                  <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
                    <div className="flex items-center gap-3">
                      {readiness?.eligible ? (
                        <CheckCircle2
                          className="text-emerald-600 dark:text-emerald-400"
                          size={22}
                        />
                      ) : (
                        <ShieldAlert
                          className="text-amber-600 dark:text-amber-400"
                          size={22}
                        />
                      )}
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        Điều kiện đóng lớp
                      </h2>
                    </div>
                    {readiness?.eligible ? (
                      <p className="mt-5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 p-4 text-sm font-bold text-emerald-800 dark:text-emerald-300">
                        Lớp đã đủ điều kiện để đóng và lưu trữ.
                      </p>
                    ) : (
                      <div className="mt-5">
                        <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                          Cần xử lý trước khi đóng:
                        </p>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                          {readiness?.blockers.map((blocker) => (
                            <li key={blocker}>• {blocker}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                </div>
                {roster?.history.length ? (
                  <section className="mt-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
                    <div className="flex items-end justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                      <div>
                        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
                          <History size={18} className="text-sky-600" />
                          Lịch sử thành viên
                        </h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Mọi phân công và ghi danh đều được lưu để truy vết.
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {historyPagination.pageItems.map((entry) => (
                        <div
                          className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]"
                          key={entry.id}
                        >
                          <p className="text-slate-700 dark:text-slate-300">
                            <strong className="font-semibold text-slate-900 dark:text-slate-100">{entry.memberId}</strong> · {entry.action}
                            {entry.role ? ` · ${roleLabel[entry.role]}` : ""}
                            {entry.reason ? ` — ${entry.reason}` : ""}
                          </p>
                          <time className="text-xs text-slate-400">
                            {new Date(entry.createdAt).toLocaleString(
                              activeLocale(),
                            )}
                          </time>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      itemLabel="thay đổi"
                      onPageChange={historyPagination.setPage}
                      onPageSizeChange={historyPagination.setPageSize}
                      page={historyPagination.page}
                      pageSize={historyPagination.pageSize}
                      totalItems={historyPagination.totalItems}
                    />
                  </section>
                ) : null}
              </section>
            ) : null}

            <Modal
              description={
                removeTarget
                  ? `Thao tác này được ghi vào lịch sử lớp cho ${removeTarget.name}.`
                  : undefined
              }
              onClose={() => {
                setRemoveTarget(null);
                setRemoveReason("");
              }}
              open={Boolean(removeTarget)}
              title={
                removeTarget?.kind === "instructors"
                  ? "Gỡ phân công giảng viên"
                  : "Gỡ học viên khỏi lớp"
              }
            >
              <form
                className="space-y-4"
                onSubmit={(event) => void removeMember(event)}
              >
                <Field label="Lý do thay đổi">
                  <textarea
                    className={inputClass}
                    minLength={5}
                    onChange={(event) => setRemoveReason(event.target.value)}
                    required
                    rows={4}
                    value={removeReason}
                  />
                </Field>
                <Button loading={saving} type="submit" variant="danger">
                  <Trash2 size={16} />
                  Xác nhận thay đổi
                </Button>
              </form>
            </Modal>
            <Modal
              description={
                transferTarget && primaryInstructor
                  ? `Chuyển trách nhiệm chính từ ${primaryInstructor.displayName || primaryInstructor.instructorId} sang ${transferTarget.name}.`
                  : undefined
              }
              onClose={() => {
                setTransferTarget(null);
                setTransferReason("");
              }}
              open={Boolean(transferTarget)}
              title="Bàn giao giảng viên chính"
            >
              <form
                className="space-y-4"
                onSubmit={(event) => void transferPrimary(event)}
              >
                <Field label="Lý do bàn giao">
                  <textarea
                    className={inputClass}
                    minLength={5}
                    onChange={(event) => setTransferReason(event.target.value)}
                    required
                    rows={4}
                    value={transferReason}
                  />
                </Field>
                <Button loading={saving} type="submit">
                  <Repeat2 size={16} />
                  Xác nhận bàn giao
                </Button>
              </form>
            </Modal>
          </div>
        )
      ) : null}
    </SectionState>
  );
}
