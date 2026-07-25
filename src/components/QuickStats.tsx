"use client";

import type { ReactNode } from "react";
import {
  Car,
  Footprints,
  Globe2,
  MapPinned,
  Moon,
  TrainFront,
} from "lucide-react";
import type { NormalizedData } from "@/lib/parser";
import { earthLaps, moonPercent } from "@/lib/parser";
import type { RegionCount } from "@/lib/regions";

interface QuickStatsProps {
  data: NormalizedData;
  topRegions?: RegionCount[];
}

function StatCard({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-3 flex items-center gap-2 text-[var(--muted)]">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function QuickStats({ data, topRegions = [] }: QuickStatsProps) {
  const laps = earthLaps(data.totalDistanceKm);
  const moon = moonPercent(data.totalDistanceKm);
  const top3 = topRegions.slice(0, 3);

  const modeTotal = data.activities.reduce(
    (s, a) => s + (a.distanceMeters || a.durationMinutes * 80),
    0
  );
  const modes = data.activities
    .map((a) => ({
      type: a.type,
      pct:
        modeTotal > 0
          ? Math.round(
              ((a.distanceMeters || a.durationMinutes * 80) / modeTotal) * 1000
            ) / 10
          : 0,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);

  const modeIcon = (type: string) => {
    if (type.includes("도보") || type.includes("러닝"))
      return <Footprints className="h-3.5 w-3.5" />;
    if (type.includes("대중") || type.includes("열차"))
      return <TrainFront className="h-3.5 w-3.5" />;
    return <Car className="h-3.5 w-3.5" />;
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        icon={<Globe2 className="h-4 w-4 text-teal-400" />}
        label="총 이동 거리"
      >
        <p className="font-display text-3xl tracking-tight text-[var(--fg)]">
          {data.totalDistanceKm.toLocaleString()}
          <span className="ml-1 text-base font-normal text-[var(--muted)]">
            km
          </span>
        </p>
        <div className="mt-3 space-y-1.5 text-xs text-[var(--muted)]">
          <p className="flex items-center gap-1.5">
            <Globe2 className="h-3 w-3 text-teal-400/80" />
            지구 둘레 대비{" "}
            <span className="text-[var(--fg)]">{(laps * 100).toFixed(2)}%</span>
            {" "}({laps.toFixed(3)}바퀴)
          </p>
          <p className="flex items-center gap-1.5">
            <Moon className="h-3 w-3 text-sky-300/80" />
            달까지 거리의{" "}
            <span className="text-[var(--fg)]">{moon.toFixed(2)}%</span>
          </p>
        </div>
      </StatCard>

      <StatCard
        icon={<MapPinned className="h-4 w-4 text-amber-400" />}
        label="최다 방문 지자체 Top 3"
      >
        {top3.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">지자체 분석 중…</p>
        ) : (
          <ol className="space-y-2.5">
            {top3.map((p, i) => (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className="font-display text-lg text-amber-400/90">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--fg)]">
                  {p.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                  {p.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </StatCard>

      <StatCard
        icon={<TrainFront className="h-4 w-4 text-sky-400" />}
        label="이동 수단 비율"
      >
        {modes.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">이동 수단 데이터 없음</p>
        ) : (
          <ul className="space-y-2.5">
            {modes.map((m) => (
              <li key={m.type}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-[var(--fg)]">
                    {modeIcon(m.type)}
                    {m.type}
                  </span>
                  <span className="tabular-nums text-[var(--muted)]">
                    {m.pct}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-sky-400/80"
                    style={{ width: `${Math.max(m.pct, 2)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </StatCard>
    </div>
  );
}
