"use client";
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
import Link from "next/link";
import { DetailTab, roleLabel } from "./class-detail.shared";
import { useClassDetailModel } from "./use-class-detail-model";

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
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <button
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-bold text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
        onClick={() => router.push("/courses")}
        type="button"
      >
        <ArrowLeft size={17} />
        Quay lại danh sách lớp
      </button>
      <SectionState loading={loading} empty={!item}>
        {item ? (
          <>
            <header className="flex flex-col gap-5 border-b border-[var(--rule-strong)] pb-6 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-[var(--accent-ink)]">
                    {item.code} · {item.term}
                  </span>
                  <StatusBadge status={item.status} />
                </div>
                <h1 className="mt-2 font-heading text-3xl font-bold tracking-[-0.03em] text-[var(--ink)] md:text-[2.125rem]">
                  {item.name}
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                  {course
                    ? `${course.code} — ${course.name}`
                    : `Khóa học ${item.courseId}`}{" "}
                  · phiên bản {item.courseVersion}
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
              className="mt-5"
              items={tabs}
              label="Nội dung hồ sơ lớp"
              onChange={setActiveTab}
              value={activeTab}
            />

            <section
              aria-label="Tổng quan lớp"
              className="mt-7"
              hidden={activeTab !== "overview"}
              role="tabpanel"
            >
              {["INSTRUCTOR", "LEARNER"].includes(session.roleCode) ? (
                <nav
                  aria-label="Không gian lớp"
                  className="mb-5 grid grid-cols-2 gap-px border-y border-[var(--rule-strong)] bg-[var(--rule)] lg:grid-cols-5"
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
                      className="flex min-h-12 items-center gap-2 bg-[var(--surface)] px-3 py-2 text-sm font-bold text-[var(--ink)] last:col-span-2 hover:bg-[var(--surface-muted)] lg:min-h-16 lg:last:col-span-1"
                      href={href}
                      key={label}
                    >
                      <Icon size={17} className="text-[var(--accent)]" />
                      {label}
                    </Link>
                  ))}
                </nav>
              ) : null}
              <div className="grid grid-cols-2 gap-px border-y border-[var(--rule-strong)] bg-[var(--rule)] lg:grid-cols-4">
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
                    className="min-w-0 bg-[var(--surface)] px-3 py-3 sm:px-5 sm:py-5"
                    key={metric.label}
                  >
                    <p className="text-xs font-bold text-[var(--ink-muted)]">
                      {metric.label}
                    </p>
                    <p className="mt-1 break-words text-sm font-extrabold tabular-nums text-[var(--ink)] sm:text-lg">
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_.85fr]">
                <section className="order-2 border-y border-[var(--rule)] py-5 lg:order-none">
                  <h2 className="font-heading text-xl font-extrabold text-[var(--ink)]">
                    Thông tin lớp
                  </h2>
                  <dl className="mt-4 divide-y divide-[var(--rule)] text-sm">
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
                        <dt className="font-bold text-[var(--ink-soft)]">
                          {row.label}
                        </dt>
                        <dd className="text-[var(--ink)]">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="border-y border-[var(--rule)] py-5">
                  <h2 className="font-heading text-xl font-extrabold text-[var(--ink)]">
                    Việc nên làm tiếp
                  </h2>
                  <ol className="mt-4 space-y-4 text-sm leading-6 text-[var(--ink-soft)]">
                    {!canManage ? (
                      item.status === "ACTIVE" ? (
                        <>
                          <li>
                            <Link
                              className="font-bold text-[var(--accent-ink)] underline underline-offset-4"
                              href={`/academic?classId=${encodeURIComponent(item.id)}`}
                            >
                              {session.roleCode === "LEARNER"
                                ? "Xem lịch và bài tập của lớp"
                                : "Theo dõi lịch dạy và bài tập"}
                            </Link>
                          </li>
                          <li>
                            <Link
                              className="font-bold text-[var(--accent-ink)] underline underline-offset-4"
                              href={`/exams?classId=${encodeURIComponent(item.id)}`}
                            >
                              {session.roleCode === "LEARNER"
                                ? "Làm đề thi và xem kết quả"
                                : "Quản lý đề thi của lớp"}
                            </Link>
                          </li>
                          <li>
                            <Link
                              className="font-bold text-[var(--accent-ink)] underline underline-offset-4"
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
                          <strong className="text-[var(--ink)]">
                            1. Phân công giảng viên chính
                          </strong>
                          <br />
                          Lớp cần ít nhất một giảng viên trước khi kích hoạt.
                        </li>
                        <li>
                          <strong className="text-[var(--ink)]">
                            2. Ghi danh học viên
                          </strong>
                          <br />
                          Thêm từng người hoặc nhập danh sách email hàng loạt.
                        </li>
                        <li>
                          <strong className="text-[var(--ink)]">
                            3. Kích hoạt lớp
                          </strong>
                          <br />
                          Mở lớp sau khi nhân sự và lịch học đã đúng.
                        </li>
                      </>
                    ) : item.status === "ACTIVE" ? (
                      <>
                        <li>
                          <strong className="text-[var(--ink)]">
                            1. Theo dõi thành viên
                          </strong>
                          <br />
                          Cập nhật người phụ trách và sĩ số khi có thay đổi.
                        </li>
                        <li>
                          <strong className="text-[var(--ink)]">
                            2. Vận hành dạy học
                          </strong>
                          <br />
                          Tiếp tục với học liệu, đề thi và buổi học trực tuyến.
                        </li>
                        <li>
                          <strong className="text-[var(--ink)]">
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
                          <strong className="text-[var(--ink)]">
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
              <div className="flex flex-col gap-2 border-b border-[var(--rule-strong)] pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-heading text-2xl font-extrabold">
                    Đội ngũ giảng dạy
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    Một giảng viên chính chịu trách nhiệm lớp; đồng giảng viên
                    cùng hỗ trợ giảng dạy.
                  </p>
                </div>
                <span className="text-sm font-bold text-[var(--ink-muted)]">
                  {roster?.instructors.length ?? item.instructorIds.length}{" "}
                  người
                </span>
              </div>
              {canManage && item.status !== "CLOSED" ? (
                <div className="mt-5 grid gap-3 border-b border-[var(--rule)] pb-5 md:grid-cols-[minmax(0,1fr)_13rem_auto]">
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
                    <p className="text-xs font-bold text-[var(--warning-deep)] md:col-span-3">
                      Lớp đã có giảng viên chính. Thêm người mới làm đồng giảng
                      viên, sau đó dùng “Bàn giao vai trò”.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="divide-y divide-[var(--rule)] border-b border-[var(--rule-strong)]">
                {instructors.map((instructor) => (
                  <article
                    className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between"
                    key={instructor.instructorId}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-[var(--ink)]">
                          {instructor.displayName || instructor.instructorId}
                        </h3>
                        <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-bold text-[var(--ink-soft)]">
                          {roleLabel[instructor.role]}
                        </span>
                      </div>
                      {instructor.email ? (
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">
                          {instructor.email}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {instructor.instructorId !== session.user.id ? (
                        <Link
                          className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-bold text-[var(--accent-deep)] hover:bg-[var(--accent-soft)]"
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
                  <p className="py-10 text-center text-sm text-[var(--ink-muted)]">
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
              <div className="flex flex-col gap-2 border-b border-[var(--rule-strong)] pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-heading text-2xl font-extrabold">
                    Danh sách học viên
                  </h2>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    Theo dõi sĩ số và nguồn ghi danh của từng học viên.
                  </p>
                </div>
                <span className="text-sm font-bold text-[var(--ink-muted)]">
                  {item.learnerIds.length}/{item.capacity} học viên
                </span>
              </div>
              {canManage && item.status !== "CLOSED" ? (
                <div className="mt-5 grid gap-5 border-b border-[var(--rule)] pb-5 lg:grid-cols-2">
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
                  className="mt-4 border-y border-[var(--rule)] py-3 text-xs"
                >
                  {importResults.map((result, index) => (
                    <p
                      className={`py-1 ${result.status === "ENROLLED" ? "text-[var(--success-deep)]" : result.status === "FAILED" ? "text-[var(--danger-deep)]" : "text-[var(--warning-deep)]"}`}
                      key={`${result.userId}-${index}`}
                    >
                      <strong>{result.userId}</strong>: {result.message}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="divide-y divide-[var(--rule)] border-b border-[var(--rule-strong)]">
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
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                    key={learner.learnerId}
                  >
                    <div className="min-w-0">
                      <h3 className="font-bold text-[var(--ink)]">
                        {"displayName" in learner && learner.displayName
                          ? learner.displayName
                          : learner.learnerId}
                      </h3>
                      <p className="mt-1 text-xs text-[var(--ink-muted)]">
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
                          className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-bold text-[var(--accent-deep)] hover:bg-[var(--accent-soft)]"
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
                  <p className="py-10 text-center text-sm text-[var(--ink-muted)]">
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
                <div className="grid gap-7 lg:grid-cols-[1fr_.9fr]">
                  <section className="border-y border-[var(--rule-strong)] py-5">
                    <div className="flex items-center gap-3">
                      <BookOpenCheck
                        className="text-[var(--accent)]"
                        size={22}
                      />
                      <h2 className="font-heading text-xl font-extrabold">
                        Trạng thái vận hành
                      </h2>
                    </div>
                    <div className="mt-5 grid grid-cols-3 divide-x divide-[var(--rule)] border-y border-[var(--rule)] py-4 text-center text-xs">
                      <div>
                        <p
                          className={`font-extrabold ${item.status === "DRAFT" ? "text-[var(--accent-ink)]" : "text-[var(--ink-muted)]"}`}
                        >
                          Nháp
                        </p>
                        <p className="mt-1 text-[var(--ink-muted)]">Chuẩn bị</p>
                      </div>
                      <div>
                        <p
                          className={`font-extrabold ${item.status === "ACTIVE" ? "text-[var(--accent-ink)]" : "text-[var(--ink-muted)]"}`}
                        >
                          Hoạt động
                        </p>
                        <p className="mt-1 text-[var(--ink-muted)]">Đang dạy</p>
                      </div>
                      <div>
                        <p
                          className={`font-extrabold ${item.status === "CLOSED" ? "text-[var(--accent-ink)]" : "text-[var(--ink-muted)]"}`}
                        >
                          Đã đóng
                        </p>
                        <p className="mt-1 text-[var(--ink-muted)]">Chỉ đọc</p>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-[var(--ink-soft)]">
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
                  <section className="border-y border-[var(--rule-strong)] py-5">
                    <div className="flex items-center gap-3">
                      {readiness?.eligible ? (
                        <CheckCircle2
                          className="text-[var(--success)]"
                          size={22}
                        />
                      ) : (
                        <ShieldAlert
                          className="text-[var(--warning)]"
                          size={22}
                        />
                      )}
                      <h2 className="font-heading text-xl font-extrabold">
                        Điều kiện đóng lớp
                      </h2>
                    </div>
                    {readiness?.eligible ? (
                      <p className="mt-5 bg-[var(--success-soft)] px-4 py-3 text-sm font-bold text-[var(--success-deep)]">
                        Lớp đã đủ điều kiện để đóng và lưu trữ.
                      </p>
                    ) : (
                      <div className="mt-5">
                        <p className="text-sm font-bold text-[var(--warning-deep)]">
                          Cần xử lý trước khi đóng:
                        </p>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--ink-soft)]">
                          {readiness?.blockers.map((blocker) => (
                            <li key={blocker}>• {blocker}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                </div>
                {roster?.history.length ? (
                  <section className="mt-7">
                    <div className="flex items-end justify-between gap-3 border-b border-[var(--rule-strong)] pb-3">
                      <div>
                        <h2 className="flex items-center gap-2 font-heading text-xl font-extrabold">
                          <History size={19} />
                          Lịch sử thành viên
                        </h2>
                        <p className="mt-1 text-sm text-[var(--ink-soft)]">
                          Mọi phân công và ghi danh đều được lưu để truy vết.
                        </p>
                      </div>
                    </div>
                    <div className="divide-y divide-[var(--rule)]">
                      {historyPagination.pageItems.map((entry) => (
                        <div
                          className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]"
                          key={entry.id}
                        >
                          <p>
                            <strong>{entry.memberId}</strong> · {entry.action}
                            {entry.role ? ` · ${roleLabel[entry.role]}` : ""}
                            {entry.reason ? ` — ${entry.reason}` : ""}
                          </p>
                          <time className="text-xs text-[var(--ink-muted)]">
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
          </>
        ) : null}
      </SectionState>
    </div>
  );
}
