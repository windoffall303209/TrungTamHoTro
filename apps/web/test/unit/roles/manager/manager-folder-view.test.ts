import { describe, expect, it } from "vitest";
import { buildManagerFolderView } from "../../../../src/roles/manager/manager-folder-view";

const records = [
  { id: "1", title: "Bài tập đầu", folder: "Chương 1" },
  { id: "2", title: "Bài tập tiếp", folder: "Chương 2" },
  { id: "3", title: "Bài tập cuối", folder: "Chương 1" },
];

describe("Manager folder view", () => {
  it("keeps first-seen folder order, folder counts and selected record", () => {
    const view = buildManagerFolderView(records, "__ALL__", "", "3");
    expect(view.folders).toEqual(["Chương 1", "Chương 2"]);
    expect([...view.counts]).toEqual([["Chương 1", 2], ["Chương 2", 1]]);
    expect(view.filtered).toEqual(records);
    expect(view.active).toBe(records[2]);
  });

  it("filters by folder and normalized search, falling back to first visible record", () => {
    const view = buildManagerFolderView(records, "Chương 1", "  CUỐI  ", "2");
    expect(view.filtered).toEqual([records[2]]);
    expect(view.active).toBe(records[2]);
  });

  it("preserves the original first-record fallback when there is no match", () => {
    const view = buildManagerFolderView(records, "Chương 2", "không tồn tại", "2");
    expect(view.filtered).toEqual([]);
    expect(view.active).toBe(records[0]);
    expect(buildManagerFolderView([], "__ALL__", "", "x").active).toBeUndefined();
  });
});
