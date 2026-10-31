import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryUser } from "@/lib/learning-types";
import { UserPicker } from "../../../../src/shared/ui/user-picker";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "SYSTEM_ADMIN" } }),
}));

// Tạo API response có thể hoàn tất không theo thứ tự gửi yêu cầu.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((onSuccess, onFailure) => {
    resolve = onSuccess;
    reject = onFailure;
  });
  return { promise, resolve, reject };
}

const oldUser: DirectoryUser = {
  id: "old", displayName: "Người dùng cũ", email: "old@example.com", roleCode: "LEARNER",
};
const newUser: DirectoryUser = {
  id: "new", displayName: "Người dùng mới", email: "new@example.com", roleCode: "LEARNER",
};

describe("UserPicker request lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.request.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("bỏ qua phản hồi cũ khi người dùng nhập truy vấn mới", async () => {
    const first = deferred<DirectoryUser[]>();
    const second = deferred<DirectoryUser[]>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<UserPicker label="Tìm học viên" onChange={vi.fn()} role="LEARNER" value="" />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "old" } });
    act(() => vi.advanceTimersByTime(220));
    fireEvent.change(input, { target: { value: "new" } });
    act(() => vi.advanceTimersByTime(220));
    expect(mocks.request).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve([newUser]));
    expect(screen.getByRole("option", { name: /Người dùng mới/ })).toBeInTheDocument();
    await act(async () => first.resolve([oldUser]));
    expect(screen.getByRole("option", { name: /Người dùng mới/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Người dùng cũ/ })).not.toBeInTheDocument();
  });

  it("lỗi của yêu cầu cũ không kết thúc trạng thái tải của yêu cầu mới", async () => {
    const first = deferred<DirectoryUser[]>();
    const second = deferred<DirectoryUser[]>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<UserPicker label="Tìm học viên" onChange={vi.fn()} role="LEARNER" value="" />);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "old" } });
    act(() => vi.advanceTimersByTime(220));
    fireEvent.change(input, { target: { value: "new" } });
    act(() => vi.advanceTimersByTime(220));
    await act(async () => first.reject(new Error("Old request failed")));
    expect(screen.getByText("Đang tìm người dùng…")).toBeInTheDocument();

    await act(async () => second.resolve([newUser]));
    expect(screen.getByRole("option", { name: /Người dùng mới/ })).toBeInTheDocument();
  });
});
