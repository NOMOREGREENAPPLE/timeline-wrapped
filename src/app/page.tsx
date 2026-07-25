"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { Compass, RotateCcw, Sparkles } from "lucide-react";
import FileUploader from "@/components/FileUploader";
import QuickStats from "@/components/QuickStats";
import StoryCards from "@/components/StoryCards";
import {
  parseTimelineFile,
  type NormalizedData,
} from "@/lib/parser";

const HeatmapView = dynamic(() => import("@/components/HeatmapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--muted)]">
      지도 로딩 중…
    </div>
  ),
});

export default function HomePage() {
  const [data, setData] = useState<NormalizedData | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setIsParsing(true);
    setError(null);
    setProgress(12);
    try {
      // Fake progress ticks while FileReader + JSON.parse run
      const tick = window.setInterval(() => {
        setProgress((p) => (p < 85 ? p + Math.random() * 12 : p));
      }, 180);

      const parsed = await parseTimelineFile(file);
      window.clearInterval(tick);
      setProgress(100);
      setData(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "파싱에 실패했습니다.");
      setData(null);
    } finally {
      setIsParsing(false);
      setProgress(0);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setProgress(0);
  }, []);

  return (
    <main className="relative mx-auto min-h-dvh w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6 lg:px-8">
      <header className="mb-12 animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Compass className="h-6 w-6" />
            </div>
            <div>
              <p className="font-display text-2xl tracking-tight text-[var(--fg)] sm:text-3xl">
                Timeline Wrapped
              </p>
              <p className="text-xs text-[var(--muted)] sm:text-sm">
                Privacy-first · 100% client-side
              </p>
            </div>
          </div>
          {data && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm text-[var(--muted)] transition hover:border-[var(--accent-muted)] hover:text-[var(--fg)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              새 파일
            </button>
          )}
        </div>

        {!data && (
          <div className="mt-10 max-w-2xl">
            <h1 className="font-display text-3xl leading-tight tracking-tight text-[var(--fg)] sm:text-4xl">
              올해의{" "}
              <span className="text-[var(--accent)]">발자국</span>을
              <br />
              Wrapped처럼 펼쳐보세요
            </h1>
            <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-[var(--muted)] sm:text-base">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
              Google 타임라인에서 추출한 Timeline.json / Records.json을 올리면
              통계·히트맵·스토리 카드를 바로 만듭니다. 파일은 절대 서버로 나가지
              않습니다.
            </p>
          </div>
        )}
      </header>

      {!data ? (
        <div className="animate-fade-up-delay">
          <FileUploader
            onParsed={handleFile}
            isParsing={isParsing}
            progress={progress}
            error={error}
          />
        </div>
      ) : (
        <div className="space-y-12 animate-fade-up">
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-display text-2xl text-[var(--fg)]">
                  Quick Stats
                </h2>
                <p className="text-sm text-[var(--muted)]">
                  {data.dateRange.start.toLocaleDateString("ko-KR")} –{" "}
                  {data.dateRange.end.toLocaleDateString("ko-KR")} · 좌표{" "}
                  {data.coordinates.length.toLocaleString()}개
                </p>
              </div>
            </div>
            <QuickStats data={data} />
          </section>

          <section>
            <HeatmapView coordinates={data.coordinates} />
          </section>

          <StoryCards data={data} />
        </div>
      )}

      <footer className="mt-20 border-t border-[var(--border)] pt-6 text-center text-xs text-[var(--muted)]">
        모든 처리는 이 기기 브라우저 메모리에서만 수행됩니다. · Timeline Wrapped
        MVP
      </footer>
    </main>
  );
}
