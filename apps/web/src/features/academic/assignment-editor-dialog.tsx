"use client";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal } from "@/components/ui";
import { Plus } from "lucide-react";
import type { useAcademicModel } from "./use-academic-model";

/** Tạo hoặc sửa bài tập nháp cùng thang điểm đánh giá. */
export function AssignmentEditorDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useAcademicModel>,
    | "classes"
    | "assignmentForm"
    | "setAssignmentForm"
    | "creatingAssignment"
    | "setCreatingAssignment"
    | "editingAssignment"
    | "setEditingAssignment"
    | "createAssignment"
  >;
}) {
  const {
    classes,
    assignmentForm,
    setAssignmentForm,
    creatingAssignment,
    setCreatingAssignment,
    editingAssignment,
    setEditingAssignment,
    createAssignment,
  } = model;
  return (
    <Modal
      open={creatingAssignment}
      onClose={() => {
        setCreatingAssignment(false);
        setEditingAssignment(null);
      }}
      title={editingAssignment ? "Sửa bài tập nháp" : "Tạo bài tập"}
      description="Rubric là nguồn điểm chính thức; tổng điểm các tiêu chí phải bằng điểm tối đa."
    >
      <form
        className="space-y-4"
        onSubmit={(event) => void createAssignment(event)}
      >
        <Field label="Lớp">
          <SearchableSelect
            aria-label="Tìm và chọn lớp nhận bài tập"
            onChange={(value) =>
              setAssignmentForm({ ...assignmentForm, classId: value })
            }
            options={classes.map((item) => ({
              value: item.id,
              label: `${item.code} — ${item.name}`,
              description: item.term,
              keywords: item.id,
            }))}
            placeholder="Gõ mã hoặc tên lớp để lọc…"
            value={assignmentForm.classId}
          />
        </Field>
        <Field label="Tên bài tập">
          <input
            className={inputClass}
            minLength={3}
            required
            value={assignmentForm.title}
            onChange={(event) =>
              setAssignmentForm({
                ...assignmentForm,
                title: event.target.value,
              })
            }
          />
        </Field>
        <Field label="Mô tả">
          <textarea
            className={inputClass}
            minLength={10}
            required
            rows={3}
            value={assignmentForm.description}
            onChange={(event) =>
              setAssignmentForm({
                ...assignmentForm,
                description: event.target.value,
              })
            }
          />
        </Field>
        <Field label="Hướng dẫn nộp">
          <textarea
            className={inputClass}
            minLength={5}
            required
            rows={3}
            value={assignmentForm.instructions}
            onChange={(event) =>
              setAssignmentForm({
                ...assignmentForm,
                instructions: event.target.value,
              })
            }
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hạn nộp">
            <input
              className={inputClass}
              required
              type="datetime-local"
              value={assignmentForm.dueAt}
              onChange={(event) =>
                setAssignmentForm({
                  ...assignmentForm,
                  dueAt: event.target.value,
                })
              }
            />
          </Field>
          <Field label="Điểm tối đa">
            <input
              className={inputClass}
              min={0.25}
              required
              step="0.25"
              type="number"
              value={assignmentForm.maxScore}
              onChange={(event) =>
                setAssignmentForm({
                  ...assignmentForm,
                  maxScore: Number(event.target.value),
                })
              }
            />
          </Field>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">Tiêu chí rubric</p>
            <Button
              onClick={() =>
                setAssignmentForm({
                  ...assignmentForm,
                  rubric: [
                    ...assignmentForm.rubric,
                    { title: "", description: "", maxPoints: 0 },
                  ],
                })
              }
              variant="ghost"
            >
              <Plus size={14} />
              Thêm tiêu chí
            </Button>
          </div>
          <div className="mt-2 space-y-3">
            {assignmentForm.rubric.map((criterion, index) => (
              <div
                className="grid gap-2 border-y border-[var(--rule)] py-3 sm:grid-cols-[1fr_100px]"
                key={index}
              >
                <input
                  aria-label={`Tên tiêu chí ${index + 1}`}
                  className={inputClass}
                  placeholder="Tên tiêu chí"
                  required
                  value={criterion.title}
                  onChange={(event) => {
                    const rubric = [...assignmentForm.rubric];
                    rubric[index] = {
                      ...criterion,
                      title: event.target.value,
                    };
                    setAssignmentForm({ ...assignmentForm, rubric });
                  }}
                />
                <input
                  aria-label={`Điểm tiêu chí ${index + 1}`}
                  className={inputClass}
                  min={0.25}
                  step="0.25"
                  type="number"
                  value={criterion.maxPoints}
                  onChange={(event) => {
                    const rubric = [...assignmentForm.rubric];
                    rubric[index] = {
                      ...criterion,
                      maxPoints: Number(event.target.value),
                    };
                    setAssignmentForm({ ...assignmentForm, rubric });
                  }}
                />
                <textarea
                  aria-label={`Mô tả tiêu chí ${index + 1}`}
                  className={`${inputClass} sm:col-span-2`}
                  placeholder="Mô tả mức đạt yêu cầu"
                  required
                  rows={2}
                  value={criterion.description}
                  onChange={(event) => {
                    const rubric = [...assignmentForm.rubric];
                    rubric[index] = {
                      ...criterion,
                      description: event.target.value,
                    };
                    setAssignmentForm({ ...assignmentForm, rubric });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <Button disabled={!assignmentForm.classId} type="submit">
          Lưu bản nháp
        </Button>
      </form>
    </Modal>
  );
}
