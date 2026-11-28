import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstructorMaterialsView } from "../../../../../src/roles/instructor/materials/instructor-materials-view";
import type { LearningClass, Material } from "@/lib/learning-types";
import type { RoleCode } from "@/lib/app-types";

const { mockApiRequest, mockLoadMaterialSummary, mockSearchMaterialsPage, mockNotify, sessionState } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockLoadMaterialSummary: vi.fn(),
  mockSearchMaterialsPage: vi.fn(),
  mockNotify: vi.fn(),
  sessionState: {
    sessionId: "sess-1",
    roleCode: "INSTRUCTOR" as RoleCode,
    permissions: ["material:view", "material:manage"],
    availableRoles: [],
    user: {
      id: "inst-1",
      username: "inst1",
      name: "Cô Hoa",
      email: "hoa@wind.test",
      roleName: "Giảng viên",
    },
  },
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: mockApiRequest,
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
}));
vi.mock("@/lib/materials", () => ({
  loadMaterialSummary: mockLoadMaterialSummary,
  searchMaterialsPage: mockSearchMaterialsPage,
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: sessionState, notify: mockNotify }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "vi-VN", t: (value: string) => value }),
}));

const sampleClasses: LearningClass[] = [
  {
    id: "cls-1",
    courseId: "crs-math",
    courseVersion: 1,
    code: "TOAN10A",
    name: "Toán 10A",
    term: "2026-HK1",
    grade: "10",
    subject: "Toán",
    startAt: "2026-08-01T00:00:00.000Z",
    endAt: "2026-12-20T00:00:00.000Z",
    capacity: 30,
    timezone: "Asia/Bangkok",
    status: "ACTIVE",
    instructorIds: ["inst-1"],
    learnerIds: ["lrn-1"],
  },
];

const sampleMaterials: Material[] = [
  {
    id: "mat-1",
    classId: "cls-1",
    courseId: "crs-math",
    ownerId: "inst-1",
    name: "Đề cương chương 1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    folder: "Tài liệu chung",
    tags: ["MATERIAL"],
    version: 1,
    visibility: "PUBLISHED",
    scope: "CLASS",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("InstructorMaterialsView", () => {
  let foldersState = {
    materials: ["Tài liệu chung"],
    lectures: ["Bài giảng chung"],
    assignments: [] as string[],
  };

  let materialsState: Material[];

  beforeEach(() => {
    foldersState = {
      materials: ["Tài liệu chung"],
      lectures: ["Bài giảng chung"],
      assignments: [],
    };
    materialsState = [...sampleMaterials];
    sessionState.roleCode = "INSTRUCTOR";
    sessionState.user.id = "inst-1";
    mockApiRequest.mockReset();
    mockLoadMaterialSummary.mockReset();
    mockSearchMaterialsPage.mockReset();
    mockNotify.mockReset();

    mockLoadMaterialSummary.mockImplementation(async () => {
      const counts = new Map<string, { classId: string; folder: string; kind: "materials" | "lectures"; count: number }>();
      for (const item of materialsState) {
        if (!item.classId) continue;
        const kind = /^(audio|video)\//.test(item.mimeType) || item.tags.some((t) => /lecture|video|bài giảng/i.test(t))
          ? "lectures"
          : "materials";
        const key = `${item.classId}\u0000${kind}\u0000${item.folder}`;
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else counts.set(key, { classId: item.classId, folder: item.folder, kind, count: 1 });
      }
      return [...counts.values()];
    });

    mockSearchMaterialsPage.mockImplementation(async (params: {
      classId?: string;
      folder?: string;
      kind?: "materials" | "lectures";
      query?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const q = params.query?.trim().toLowerCase() ?? "";
      const filtered = materialsState.filter((item) => {
        const kind = /^(audio|video)\//.test(item.mimeType) || item.tags.some((t) => /lecture|video|bài giảng/i.test(t))
          ? "lectures"
          : "materials";
        return (
          (!params.classId || item.classId === params.classId) &&
          (!params.folder || item.folder === params.folder) &&
          (!params.kind || kind === params.kind) &&
          (!q || item.name.toLowerCase().includes(q))
        );
      });
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return {
        items: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      };
    });

    mockApiRequest.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/instructor/classes" || path === "/classes" || path === "/learner/classes") {
        return sampleClasses;
      }
      if (path === "/classes/cls-1/folders") {
        return foldersState;
      }
      if (path === "/instructor/classes/cls-1/folders" && options?.method === "POST") {
        const parsed = JSON.parse(String(options.body ?? "{}")) as { kind: "materials" | "lectures"; name: string };
        foldersState = {
          ...foldersState,
          [parsed.kind]: [...foldersState[parsed.kind], parsed.name],
        };
        return foldersState;
      }
      if (path === "/instructor/classes/cls-1/material-uploads" && options?.method === "POST") {
        const created: Material = {
          ...sampleMaterials[0]!,
          id: "mat-uploaded",
          name: "bai-moi.pdf",
          folder: "Chương 2",
        };
        materialsState = [created, ...materialsState];
        return created;
      }
      return {};
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("enforces Khối → Môn → Lớp → Thư mục → Tệp flow, folder creation, and locked open-folder uploads without Cần phân cấp lại", async () => {
    render(<InstructorMaterialsView />);

    await screen.findByText("Khối 10");
    expect(screen.queryByText(/Cần phân cấp lại/i)).not.toBeInTheDocument();

    const uploadBtn = screen.getByRole("button", { name: /Tải tài liệu \/ bài giảng/ });
    // Cấp Khối: nút tải lên bị vô hiệu hóa
    expect(uploadBtn).toBeDisabled();

    // Mở Khối -> Môn: vẫn bị vô hiệu hóa
    fireEvent.click(screen.getByRole("button", { name: /Khối 10/ }));
    await screen.findByText("Môn Toán");
    expect(uploadBtn).toBeDisabled();

    // Mở Môn -> Lớp: vẫn bị vô hiệu hóa
    fireEvent.click(screen.getByRole("button", { name: /Môn Toán/ }));
    await screen.findByText("Toán 10A (TOAN10A)");
    expect(uploadBtn).toBeDisabled();

    // Mở Lớp -> hiển thị Thư mục và nút Tạo thư mục; khi chưa mở thư mục cụ thể, nút tải vẫn disabled
    fireEvent.click(screen.getByRole("button", { name: /Toán 10A/ }));
    await screen.findByText("Tài liệu chung");
    expect(uploadBtn).toBeDisabled();

    // Tạo thư mục mới ở cấp Lớp
    const createFolderTrigger = screen.getByRole("button", { name: /Tạo thư mục/ });
    fireEvent.click(createFolderTrigger);
    fireEvent.change(screen.getByPlaceholderText("Ví dụ: Chương 1 - Hàm số"), {
      target: { value: "Chương 2" },
    });
    const modalButtons = screen.getAllByRole("button", { name: "Tạo thư mục" });
    fireEvent.click(modalButtons[modalButtons.length - 1]!);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/instructor/classes/cls-1/folders",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await screen.findByText("Chương 2");

    // Mở đúng thư mục "Chương 2" -> nút tải lên được bật
    fireEvent.click(screen.getByRole("button", { name: /Chương 2/ }));
    await waitFor(() => expect(uploadBtn).toBeEnabled());

    // Mở modal tải tệp: khóa vào cls-1 / Chương 2, không có dropdown đổi lớp hoặc đổi thư mục
    fireEvent.click(uploadBtn);
    expect(screen.getByText(/Toán 10A \(TOAN10A\) \/ Chương 2/)).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(["%PDF"], "bai-moi.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [testFile] } });
    fireEvent.click(screen.getByRole("button", { name: /Hoàn tất & Lưu vào kho/ }));

    await waitFor(() => {
      const uploadCall = mockApiRequest.mock.calls.find(
        ([path, opts]) =>
          path === "/instructor/classes/cls-1/material-uploads" &&
          (opts as RequestInit | undefined)?.method === "POST",
      );
      expect(uploadCall).toBeTruthy();
      const body = (uploadCall![1] as RequestInit).body as FormData;
      expect(body.get("folder")).toBe("Chương 2");
      expect(body.get("scope")).toBe("CLASS");
      expect(body.get("tags")).toBe("MATERIAL");
    });
  });

  it("hides write controls and keeps upload disabled when actor is not assigned in class_instructors", async () => {
    sessionState.user.id = "inst-outsider";
    render(<InstructorMaterialsView />);

    await screen.findByText("Khối 10");
    fireEvent.click(screen.getByRole("button", { name: /Khối 10/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Môn Toán/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Toán 10A/ }));
    await screen.findByText("Tài liệu chung");

    expect(screen.queryByRole("button", { name: /Tạo thư mục/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Tài liệu chung/ }));
    await screen.findByText("Đề cương chương 1.pdf");

    expect(screen.getByRole("button", { name: /Tải tài liệu \/ bài giảng/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Tùy chọn học liệu" })).not.toBeInTheDocument();
  });

  it("loads paginated files on demand inside an opened folder using searchMaterialsPage", async () => {
    materialsState = Array.from({ length: 25 }, (_, index) => ({
      ...sampleMaterials[0]!,
      id: `mat-${index + 1}`,
      name: `Bai-giang-tuan-${index + 1}.pdf`,
      folder: "Tài liệu chung",
    }));

    render(<InstructorMaterialsView />);
    await screen.findByText("Khối 10");
    fireEvent.click(screen.getByRole("button", { name: /Khối 10/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Môn Toán/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Toán 10A/ }));
    await screen.findByText("Tài liệu chung");
    expect(mockSearchMaterialsPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Tài liệu chung/ }));
    await screen.findByText("Bai-giang-tuan-1.pdf");
    expect(screen.queryByText("Bai-giang-tuan-21.pdf")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Trang sau/i }));
    await screen.findByText("Bai-giang-tuan-21.pdf");
    expect(mockSearchMaterialsPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        classId: "cls-1",
        folder: "Tài liệu chung",
        folderExact: true,
        kind: "materials",
        page: 2,
        pageSize: 20,
      }),
      expect.objectContaining({ roleCode: "INSTRUCTOR" }),
    );
  });
});
