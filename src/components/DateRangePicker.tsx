"use client";

import { CalendarRange } from "lucide-react";
import {
  fromInputDate,
  toInputDate,
  type TimelineBundle,
} from "@/lib/parser";

export interface DateRangeValue {
  start: Date;
  end: Date;
}

interface DateRangePickerProps {
  bundle: TimelineBundle;
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
}

function clampRange(
  start: Date,
  end: Date,
  min: Date,
  max: Date
): DateRangeValue {
  let s = start < min ? min : start;
  let e = end > max ? max : end;
  if (s > e) {
    const tmp = s;
    s = e;
    e = tmp;
  }
  return { start: s, end: e };
}

export default function DateRangePicker({
  bundle,
  value,
  onChange,
}: DateRangePickerProps) {
  const min = bundle.dateRange.start;
  const max = bundle.dateRange.end;
  const minStr = toInputDate(min);
  const maxStr = toInputDate(max);

  const applyPreset = (kind: "all" | "year" | "30" | "90") => {
    const today = max;
    if (kind === "all") {
      onChange({ start: min, end: max });
      return;
    }
    if (kind === "year") {
      const start = new Date(today.getFullYear(), 0, 1);
      onChange(clampRange(start, today, min, max));
      return;
    }
    const days = kind === "30" ? 30 : 90;
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    onChange(clampRange(start, today, min, max));
  };

  const isAll =
    toInputDate(value.start) === minStr && toInputDate(value.end) === maxStr;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-[var(--muted)]">
        <CalendarRange className="h-4 w-4 text-[var(--accent)]" />
        <h2 className="font-display text-base text-[var(--fg)]">분석 기간</h2>
        <span className="text-xs text-[var(--muted)]">
          데이터 전체 {min.toLocaleDateString("ko-KR")} –{" "}
          {max.toLocaleDateString("ko-KR")}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1.5 text-xs text-[var(--muted)]">
          시작일
          <input
            type="date"
            value={toInputDate(value.start)}
            min={minStr}
            max={maxStr}
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(
                clampRange(fromInputDate(e.target.value), value.end, min, max)
              );
            }}
            className="rounded-xl border border-[var(--border)] bg-[#0a1412] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs text-[var(--muted)]">
          종료일
          <input
            type="date"
            value={toInputDate(value.end)}
            min={minStr}
            max={maxStr}
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(
                clampRange(value.start, fromInputDate(e.target.value), min, max)
              );
            }}
            className="rounded-xl border border-[var(--border)] bg-[#0a1412] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
          />
        </label>

        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {(
            [
              ["all", "전체", isAll],
              ["year", "올해", false],
              ["90", "90일", false],
              ["30", "30일", false],
            ] as const
          ).map(([key, label, active]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={[
                "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "bg-[var(--accent)] text-[#04201c]"
                  : "border border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--fg)]",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
