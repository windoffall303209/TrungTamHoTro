import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket, TicketComment } from "@/lib/learning-types";
import SupportPage from "../../../../../src/app/(workspace)/support/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock, downloadApiFile: vi.fn(), previewApiFile: vi.fn() }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "CENTER_MANAGER", user: { id: "manager-1" } }, notify: notifyMock }),
}));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ t: (value: string) => value }) }));

const tickets: Ticket[] = ["a", "b"].map((id) => ({
  id, reporterId: "learner-1", category: "TECHNICAL", severity: "P2",
  description: `Ticket ${id.toUpperCase()}`, status: "OPEN",
  dueAt: "2026-11-30T00:00:00Z", createdAt: "2026-10-30T00:00:00Z",
  updatedAt: "2026-10-30T00:00:00Z", attachments: [],
}));

// Trì hoãn kết quả API để chủ động thử các thứ tự phản hồi khác nhau.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Tạo một bình luận để xác định chính xác hội thoại đang hiển thị.
function makeComment(ticketId: string): TicketComment {
  return {
    id: `comment-${ticketId}`, ticketId, authorId: "learner-1",
    body: `Comment ${ticketId.toUpperCase()}`, createdAt: "2026-10-30T00:00:00Z",
  };
}

describe("SupportPage request lifecycle", () => {
  let ticketsRequest: ReturnType<typeof deferred<Ticket[]>>;
  const commentsRequests = new Map<string, ReturnType<typeof deferred<TicketComment[]>>>();

  beforeEach(() => {
    ticketsRequest = deferred<Ticket[]>();
    commentsRequests.clear();
    notifyMock.mockReset();
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/support/tickets") return ticketsRequest.promise;
      if (path === "/notifications") return Promise.resolve([]);
      const match = path.match(/^\/support\/tickets\/(a|b)\/comments$/);
      if (match?.[1]) {
        const pending = deferred<TicketComment[]>();
        commentsRequests.set(match[1], pending);
        return pending.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // Nạp danh sách và mở hai hội thoại theo thứ tự người dùng chọn.
  async function openTwoConversations() {
    render(<SupportPage />);
    await act(async () => ticketsRequest.resolve(tickets));
    await screen.findByText("Ticket A");
    fireEvent.click(screen.getAllByRole("button", { name: "Trao đổi" })[0]!);
    await waitFor(() => expect(commentsRequests.has("a")).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: "Trao đổi" })[1]!);
    await waitFor(() => expect(commentsRequests.has("b")).toBe(true));
    return { first: commentsRequests.get("a")!, last: commentsRequests.get("b")! };
  }

  it("keeps the newly selected conversation when an older reply arrives", async () => {
    const { first, last } = await openTwoConversations();
    await act(async () => last.resolve([makeComment("b")]));
    expect(screen.getByText("Comment B")).toBeInTheDocument();
    await act(async () => first.resolve([makeComment("a")]));
    expect(screen.getByText("Comment B")).toBeInTheDocument();
    expect(screen.queryByText("Comment A")).not.toBeInTheDocument();
  });

  it("ignores errors from a conversation that has been replaced", async () => {
    const { first, last } = await openTwoConversations();
    await act(async () => first.reject(new Error("Previous conversation failed")));
    await act(async () => last.resolve([makeComment("b")]));
    expect(screen.getByText("Comment B")).toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores a reply after closing the conversation", async () => {
    render(<SupportPage />);
    await act(async () => ticketsRequest.resolve(tickets));
    await screen.findByText("Ticket A");
    fireEvent.click(screen.getAllByRole("button", { name: "Trao đổi" })[0]!);
    await waitFor(() => expect(commentsRequests.has("a")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Đóng hộp thoại" }));
    await act(async () => commentsRequests.get("a")!.reject(new Error("Closed conversation failed")));
    expect(notifyMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Comment A")).not.toBeInTheDocument();
  });

  it("does not notify about a pending ticket request after unmount", async () => {
    const page = render(<SupportPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/support/tickets", expect.anything()));
    page.unmount();
    await act(async () => ticketsRequest.reject(new Error("Unmounted tickets request failed")));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
