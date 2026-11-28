"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

export interface ScoreStepperInputProps {
  id?: string;
  ariaLabel?: string;
  stepTargetLabel?: string;
  value: number | string;
  onChange: (nextNumeric: number, rawText: string) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  size?: "sm" | "md";
  inputWidthClass?: string;
}

// Tính mức điểm mới theo bước nhảy 0,25 điểm và giới hạn trong miền hợp lệ với độ chính xác 2 chữ số thập phân.
export function stepScoreByQuarter(
  currentValue: number,
  direction: 1 | -1,
  min = 0.25,
  max = 1000,
  step = 0.25,
): number {
  const safeBase = Number.isFinite(currentValue) ? currentValue : min;
  const stepped = Math.round((safeBase + direction * step) * 100) / 100;
  return Math.min(max, Math.max(min, stepped));
}

// Ô nhập điểm kèm hai nút bấm tăng giảm 0,25 điểm dùng thống nhất cho toàn bộ luồng tạo, sửa và chấm bài.
export function ScoreStepperInput({
  id,
  ariaLabel,
  stepTargetLabel,
  value,
  onChange,
  min = 0.25,
  max = 1000,
  step = 0.25,
  disabled = false,
  placeholder,
  size = "sm",
  inputWidthClass,
}: ScoreStepperInputProps) {
  const [draft, setDraft] = useState<string>(() =>
    value === "" ? "" : String(value),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value === "" ? "" : String(value));
    }
  }, [focused, value]);

  const parsedCurrent =
    typeof value === "number"
      ? value
      : value.trim() === ""
        ? NaN
        : Number(value.trim().replace(",", "."));

  // Xử lý bấm nút cộng hoặc trừ theo đúng bước nhảy 0,25 điểm và chặn lan sự kiện ra thẻ label bao ngoài.
  const handleStepClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    direction: 1 | -1,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    const base = Number.isFinite(parsedCurrent) ? parsedCurrent : min;
    const next = stepScoreByQuarter(base, direction, min, max, step);
    const text = String(next);
    setDraft(text);
    onChange(next, text);
  };

  const compact = size === "sm";
  const btnClass = compact
    ? "inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700 cursor-pointer"
    : "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 text-slate-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700 cursor-pointer";
  const resolvedWidth = inputWidthClass ?? (compact ? "w-16" : "w-24");
  const inputStyles = compact
    ? `${resolvedWidth} rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-xs font-bold tabular-nums text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100`
    : `${resolvedWidth} rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-center text-sm font-bold tabular-nums text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100`;

  const canDecrease = !disabled && (!Number.isFinite(parsedCurrent) || parsedCurrent > min + 1e-6);
  const canIncrease = !disabled && (!Number.isFinite(parsedCurrent) || parsedCurrent < max - 1e-6);

  return (
    <span
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-1"
    >
      <button
        type="button"
        disabled={!canDecrease}
        aria-label={stepTargetLabel ? `Giảm 0,25 ${stepTargetLabel}` : "Giảm 0,25"}
        title="Giảm 0,25 điểm"
        onClick={(event) => handleStepClick(event, -1)}
        className={btnClass}
      >
        <Minus size={compact ? 12 : 14} />
      </button>
      <input
        id={id}
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        value={focused ? draft : value === "" ? "" : String(value)}
        onFocus={() => {
          setFocused(true);
          setDraft(value === "" ? "" : String(value));
        }}
        onBlur={() => {
          setFocused(false);
          if (draft.trim() === "") {
            setDraft(value === "" ? "" : String(value));
          }
        }}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const normalized = raw.trim().replace(",", ".");
          const parsed = normalized === "" ? NaN : Number(normalized);
          onChange(Number.isFinite(parsed) ? parsed : 0, raw);
        }}
        className={inputStyles}
      />
      <button
        type="button"
        disabled={!canIncrease}
        aria-label={stepTargetLabel ? `Tăng 0,25 ${stepTargetLabel}` : "Tăng 0,25"}
        title="Tăng 0,25 điểm"
        onClick={(event) => handleStepClick(event, 1)}
        className={btnClass}
      >
        <Plus size={compact ? 12 : 14} />
      </button>
    </span>
  );
}
