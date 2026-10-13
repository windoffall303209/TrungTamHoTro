"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Dùng dialog gốc để khóa nền, giữ focus và khôi phục nút mở khi đóng menu mobile. */
export function MobileDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLButtonElement>("[data-drawer-close]")
      ?.focus({ preventScroll: true });
    const desktop = window.matchMedia("(min-width: 1024px)");
    /** Đóng drawer khi chuyển sang bố cục desktop để không giữ lớp nền vô hiệu hóa. */
    const closeOnDesktop = () => {
      if (desktop.matches) closeRef.current();
    };
    desktop.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      dialog?.close();
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, []);

  return (
    <dialog
      aria-label="Điều hướng trên thiết bị di động"
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-[var(--overlay)]"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button:not([tabindex="-1"])',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      ref={dialogRef}
    >
      <button
        aria-label="Đóng menu"
        className="absolute inset-0"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div className="relative h-full w-72 max-w-[calc(100vw-3rem)] bg-[var(--nav)] shadow-[var(--dialog-shadow)]">
        <button
          data-drawer-close
          aria-label="Đóng menu"
          className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-xl text-[var(--nav-muted)] hover:bg-[var(--nav-hover)]"
          onClick={onClose}
          type="button"
        >
          <X size={19} />
        </button>
        {children}
      </div>
    </dialog>
  );
}
