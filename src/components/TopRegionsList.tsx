"use client";

import { MapPinned } from "lucide-react";
import type { RegionCount } from "@/lib/regions";

interface TopRegionsListProps {
  korea: RegionCount[];
  world: RegionCount[];
  loading?: boolean;
}

function RegionColumn({
  title,
  subtitle,
  regions,
}: {
  title: string;
  subtitle: string;
  regions: RegionCount[];
}) {
  const top = regions.slice(0, 30);
  const max = top[0]?.count ?? 1;
  const min = top[top.length - 1]?.count ?? 1;
  // Log scale: with one dominant region (e.g. 8만 vs 수백) a linear bar buries
  // everyone else. Log keeps the ranking but shows order-of-magnitude gaps,
  // while the exact count stays visible as text on the right.
  const logMax = Math.log(max + 1);
  const logMin = Math.log(min + 1);
  const logSpan = Math.max(logMax - logMin, 1e-6);
  const barPct = (count: number) => {
    const t = (Math.log(count + 1) - logMin) / logSpan;
    return Math.round(12 + t * 88); // smallest ≈12%, largest = 100%
  };

  return (
    <div>
      <div className="mb-3">
        <h3 className="font-display text-lg text-[var(--fg)]">{title}</h3>
        <p className="text-xs text-[var(--muted)]">{subtitle} · 막대는 로그 비율</p>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">방문 기록 없음</p>
      ) : (
        <ol className="space-y-2">
          {top.map((region, index) => {
            const pct = barPct(region.count);
            return (
              <li
                key={region.id}
                className="rounded-xl border border-[var(--border)] bg-[#0a1412]/60 px-3 py-2.5"
              >
                <div className="flex items-baseline gap-2">
                  <span className="w-7 shrink-0 font-display text-sm tabular-nums text-amber-400/90">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg)]">
                    {region.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                    {region.count.toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-amber-400/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function TopRegionsList({
  korea,
  world,
  loading,
}: TopRegionsListProps) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPinned className="h-4 w-4 text-amber-400" />
          <div>
            <h2 className="font-display text-xl text-[var(--fg)]">
              많이 방문한 지자체
            </h2>
            <p className="text-xs text-[var(--muted)]">
              한국은 시·군·구 · 해외는 국가 · 체류 밀도 순 Top 30
            </p>
          </div>
        </div>
        {loading && (
          <p className="text-xs text-[var(--accent)]">경계 매칭 중…</p>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <RegionColumn
          title={`한국 시·군·구 Top ${Math.min(30, korea.length) || 30}`}
          subtitle={`${korea.length.toLocaleString()}곳 방문`}
          regions={korea}
        />
        <RegionColumn
          title={`세계 국가 Top ${Math.min(30, world.length) || 30}`}
          subtitle={`${world.length.toLocaleString()}개국 방문`}
          regions={world}
        />
      </div>
    </section>
  );
}
