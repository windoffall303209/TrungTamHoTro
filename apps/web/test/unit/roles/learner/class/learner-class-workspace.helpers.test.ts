import { describe, expect, it } from "vitest";
import { filterLearnerAssignments, filterLearnerFiles, getLearnerFolderNames } from "../../../../../src/roles/learner/class/learner-class-workspace.helpers";

describe("learner class workspace filters", () => {
  it("keeps only nonempty folders in their original order", () => {
    expect(getLearnerFolderNames([
      { folder: "Toán" }, { folder: undefined }, { folder: "Văn" }, { folder: "Toán" }, { folder: "" },
    ])).toEqual(["Toán", "Văn"]);
  });

  it("filters assignments by folder and trimmed case-insensitive title without mutating input", () => {
    const items = [
      { id: "a", title: "Bài toán B", folder: "Lớp 1", dueAt: "2026-11-03T00:00:00Z" },
      { id: "b", title: "BÀI TOÁN A", folder: "Lớp 1", dueAt: "2026-11-01T00:00:00Z" },
      { id: "c", title: "Bài toán C", folder: "Lớp 2" },
    ];
    const original = [...items];
    expect(filterLearnerAssignments(items, "Lớp 1", "  TOÁN  ", "alpha").map((item) => item.id)).toEqual(["b", "a"]);
    expect(filterLearnerAssignments(items, "__ALL__", "", "due").map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(items).toEqual(original);
  });

  it("uses createdAt then dueAt for newest assignments and preserves tie order", () => {
    const items = [
      { id: "due", title: "Due", dueAt: "2026-11-05T00:00:00Z" },
      { id: "created", title: "Created", createdAt: "2026-11-10T00:00:00Z", dueAt: "2026-11-01T00:00:00Z" },
      { id: "empty", title: "Empty" },
    ];
    expect(filterLearnerAssignments(items, "__ALL__", "", "newest").map((item) => item.id)).toEqual(["created", "due", "empty"]);
    expect(filterLearnerAssignments(items, "__ALL__", "", "due").map((item) => item.id)).toEqual(["empty", "created", "due"]);
  });

  it("sorts files by format or upload time while preserving the source array", () => {
    const items = [
      { id: "z", title: "Zeta", folder: "B", fileType: "pdf", uploadedAt: "2026-11-01T00:00:00Z" },
      { id: "a", title: "Alpha", folder: "A", fileType: "mp4", uploadedAt: "2026-11-03T00:00:00Z" },
      { id: "b", title: "Beta", folder: "A", fileType: "pdf", uploadedAt: "2026-11-02T00:00:00Z" },
    ];
    expect(filterLearnerFiles(items, "__ALL__", "", "type").map((item) => item.id)).toEqual(["a", "z", "b"]);
    expect(filterLearnerFiles(items, "__ALL__", "", "newest").map((item) => item.id)).toEqual(["a", "b", "z"]);
    expect(filterLearnerFiles(items, "A", " alpha ", "alpha").map((item) => item.id)).toEqual(["a"]);
    expect(items.map((item) => item.id)).toEqual(["z", "a", "b"]);
  });
});
