"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { toPng } from "html-to-image";
import { Download, Footprints, MapPin, Train } from "lucide-react";
import type { NormalizedData } from "@/lib/parser";
import { earthLaps, moonPercent, wrappedTitle } from "@/lib/parser";
import type { RegionCount } from "@/lib/regions";

interface StoryCardsProps {
  data: NormalizedData;
  topRegions?: RegionCount[];
}

const CARD_W = 1080;
const CARD_H = 1920;
const PREVIEW_SCALE = 270 / CARD_W; // ~0.25

function SaveButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-60"
    >
      <Download className="h-4 w-4" />
      {loading ? "저장 중…" : "이미지로 저장"}
    </button>
  );
}

function useCardExport() {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const exportCard = useCallback(
    async (node: HTMLElement | null, filename: string, id: string) => {
      if (!node) return;
      setLoadingId(id);
      try {
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const dataUrl = await toPng(node, {
          width: CARD_W,
          height: CARD_H,
          pixelRatio: 1,
          cacheBust: true,
          style: {
            transform: "scale(1)",
            transformOrigin: "top left",
            width: `${CARD_W}px`,
            height: `${CARD_H}px`,
          },
        });
        const a = document.createElement("a");
        a.download = filename;
        a.href = dataUrl;
        a.click();
      } catch (e) {
        console.error("PNG export failed", e);
        alert("이미지 저장에 실패했습니다. 다시 시도해 주세요.");
      } finally {
        setLoadingId(null);
      }
    },
    []
  );

  return { loadingId, exportCard };
}

function CardShell({
  innerRef,
  variant,
  eyebrow,
  icon,
  heading,
  subheading,
  footer,
  children,
}: {
  innerRef: React.Ref<HTMLDivElement>;
  variant: "summary" | "places" | "transit";
  eyebrow: string;
  icon: ReactNode;
  heading: string;
  subheading: string;
  footer: string;
  children: ReactNode;
}) {
  return (
    <div ref={innerRef} className={`story-card story-card--${variant}`}>
      <div className="story-noise" />

      <header>
        <p className="story-brand">Timeline Wrapped</p>
        <p className="story-year">{eyebrow}</p>
      </header>

      <div className="story-body">
        <div className="story-head">
          {icon}
          <h3 className="story-heading">{heading}</h3>
          <p className="story-subheading">{subheading}</p>
        </div>
        {children}
      </div>

      <footer className="story-footer">{footer}</footer>
    </div>
  );
}

function StoryPreview({ children }: { children: ReactNode }) {
  return (
    <div
      className="story-frame mx-auto"
      style={{
        width: CARD_W * PREVIEW_SCALE,
        height: CARD_H * PREVIEW_SCALE,
      }}
    >
      <div
        style={{
          width: CARD_W,
          height: CARD_H,
          transform: `scale(${PREVIEW_SCALE})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function StoryCards({
  data,
  topRegions = [],
}: StoryCardsProps) {
  const card1Ref = useRef<HTMLDivElement>(null);
  const card2Ref = useRef<HTMLDivElement>(null);
  const card3Ref = useRef<HTMLDivElement>(null);
  const { loadingId, exportCard } = useCardExport();

  const title = wrappedTitle(data.totalDistanceKm);
  const laps = earthLaps(data.totalDistanceKm);
  const moon = moonPercent(data.totalDistanceKm);
  const top3 = topRegions.slice(0, 3);

  const activityTotals = data.activities.reduce(
    (acc, a) => {
      const score =
        a.distanceMeters > 0 ? a.distanceMeters : a.durationMinutes * 80;
      acc.total += score;
      acc.items.push({ type: a.type, score });
      return acc;
    },
    { total: 0, items: [] as { type: string; score: number }[] }
  );

  const ratios =
    activityTotals.total > 0
      ? activityTotals.items
          .map((i) => ({
            type: i.type,
            pct: Math.round((i.score / activityTotals.total) * 1000) / 10,
          }))
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 5)
      : [];

  const yearLabel = (() => {
    const y1 = data.dateRange.start.getFullYear();
    const y2 = data.dateRange.end.getFullYear();
    return y1 === y2 ? `${y1}` : `${y1}–${y2}`;
  })();

  const rangeLabel = `${data.dateRange.start.toLocaleDateString(
    "ko-KR"
  )} – ${data.dateRange.end.toLocaleDateString("ko-KR")}`;

  const barColors = ["#2dd4bf", "#38bdf8", "#fbbf24", "#fb7185", "#a78bfa"];

  return (
    <section>
      <div className="mb-6">
        <h2 className="font-display text-2xl text-[var(--fg)]">Story Cards</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          인스타그램 스토리(9:16 · 1080×1920)용 카드 · PNG로 저장해 공유하세요
        </p>
      </div>

      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {/* Card 1 — Summary */}
        <div className="flex flex-col">
          <StoryPreview>
            <CardShell
              innerRef={card1Ref}
              variant="summary"
              eyebrow={yearLabel}
              icon={
                <Footprints
                  className="text-teal-300"
                  style={{ width: 72, height: 72 }}
                />
              }
              heading="올해 나의 발자국"
              subheading="Total Distance"
              footer={rangeLabel}
            >
              <div>
                <p
                  className="font-display font-semibold tracking-tight text-teal-300"
                  style={{ fontSize: 132, lineHeight: 1 }}
                >
                  {data.totalDistanceKm.toLocaleString()}
                  <span
                    className="ml-3 font-normal text-white/60"
                    style={{ fontSize: 44 }}
                  >
                    km
                  </span>
                </p>
                <p className="mt-8 text-white/70" style={{ fontSize: 30 }}>
                  지구 둘레{" "}
                  <span className="text-teal-200">{laps.toFixed(3)}</span> 바퀴 ·
                  달까지의{" "}
                  <span className="text-teal-200">{moon.toFixed(2)}</span>%
                </p>
                <p
                  className="mt-14 border-t border-white/15 pt-10 font-medium leading-snug text-white"
                  style={{ fontSize: 38 }}
                >
                  “{title}”
                </p>
              </div>
            </CardShell>
          </StoryPreview>
          <SaveButton
            loading={loadingId === "1"}
            onClick={() =>
              void exportCard(
                card1Ref.current,
                "timeline-wrapped-summary.png",
                "1"
              )
            }
          />
        </div>

        {/* Card 2 — Places */}
        <div className="flex flex-col">
          <StoryPreview>
            <CardShell
              innerRef={card2Ref}
              variant="places"
              eyebrow={yearLabel}
              icon={
                <MapPin
                  className="text-amber-300"
                  style={{ width: 68, height: 68 }}
                />
              }
              heading="나의 최애 지자체"
              subheading="Top 3 Regions"
              footer={rangeLabel}
            >
              <ol className="flex flex-col" style={{ gap: 48 }}>
                {top3.length === 0 && (
                  <li className="text-white/50" style={{ fontSize: 30 }}>
                    지자체 기록이 부족합니다
                  </li>
                )}
                {top3.map((p, i) => (
                  <li
                    key={p.id}
                    className="flex items-baseline gap-8 border-b border-white/10"
                    style={{ paddingBottom: 36 }}
                  >
                    <span
                      className="font-display text-amber-300/90"
                      style={{ fontSize: 56, lineHeight: 1 }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate font-semibold text-white"
                        style={{ fontSize: 40 }}
                      >
                        {p.name}
                      </p>
                      <p className="mt-3 text-white/50" style={{ fontSize: 28 }}>
                        체류 밀도 {p.count.toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardShell>
          </StoryPreview>
          <SaveButton
            loading={loadingId === "2"}
            onClick={() =>
              void exportCard(
                card2Ref.current,
                "timeline-wrapped-places.png",
                "2"
              )
            }
          />
        </div>

        {/* Card 3 — Transport */}
        <div className="flex flex-col">
          <StoryPreview>
            <CardShell
              innerRef={card3Ref}
              variant="transit"
              eyebrow={yearLabel}
              icon={
                <Train
                  className="text-sky-300"
                  style={{ width: 68, height: 68 }}
                />
              }
              heading="어떻게 움직였나"
              subheading="Mode Mix"
              footer={rangeLabel}
            >
              <div className="flex flex-col" style={{ gap: 52 }}>
                {ratios.length === 0 && (
                  <p className="text-white/50" style={{ fontSize: 30 }}>
                    이동 수단 데이터가 없습니다
                  </p>
                )}
                {ratios.map((r, i) => (
                  <div key={r.type}>
                    <div
                      className="flex items-baseline justify-between"
                      style={{ fontSize: 32, marginBottom: 14 }}
                    >
                      <span className="font-medium text-white">{r.type}</span>
                      <span className="tabular-nums text-white/60">
                        {r.pct}%
                      </span>
                    </div>
                    <div
                      className="overflow-hidden rounded-full bg-white/10"
                      style={{ height: 18 }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(r.pct, 2)}%`,
                          background: barColors[i % barColors.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardShell>
          </StoryPreview>
          <SaveButton
            loading={loadingId === "3"}
            onClick={() =>
              void exportCard(
                card3Ref.current,
                "timeline-wrapped-transit.png",
                "3"
              )
            }
          />
        </div>
      </div>
    </section>
  );
}
