"use client";

import { useCallback, useRef, useState } from "react";
import { FileJson, Loader2, ShieldCheck, Upload } from "lucide-react";

interface FileUploaderProps {
  onParsed: (file: File) => void | Promise<void>;
  isParsing: boolean;
  progress?: number;
  error?: string | null;
}

export default function FileUploader({
  onParsed,
  isParsing,
  progress = 0,
  error,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const acceptFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || isParsing) return;
      if (!file.name.toLowerCase().endsWith(".json")) {
        return;
      }
      await onParsed(file);
    },
    [isParsing, onParsed]
  );

  return (
    <section className="mx-auto w-full max-w-xl">
      <div
        role="button"
        tabIndex={0}
        aria-label="타임라인 JSON 파일 업로드"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void acceptFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !isParsing && inputRef.current?.click()}
        className={[
          "relative overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300",
          "bg-[var(--surface)] backdrop-blur-sm",
          dragging
            ? "border-[var(--accent)] scale-[1.01] shadow-[0_0_0_4px_rgba(45,212,191,0.15)]"
            : "border-[var(--border)] hover:border-[var(--accent-muted)]",
          isParsing ? "pointer-events-none opacity-90" : "cursor-pointer",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void acceptFile(e.target.files?.[0])}
        />

        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
          {isParsing ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <Upload className="h-7 w-7" />
          )}
        </div>

        <h2 className="font-display text-xl tracking-tight text-[var(--fg)] sm:text-2xl">
          {isParsing ? "타임라인을 읽는 중…" : "Timeline.json 끌어다 놓기"}
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          또는 클릭해서{" "}
          <span className="inline-flex items-center gap-1 font-medium text-[var(--fg)]">
            <FileJson className="h-3.5 w-3.5" />
            Timeline.json / Records.json
          </span>{" "}
          선택
        </p>

        {isParsing && (
          <div className="mx-auto mt-6 w-full max-w-xs">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-500 ease-out"
                style={{ width: `${Math.min(100, Math.max(8, progress))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              브라우저 메모리에서만 처리합니다
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      <p className="mt-4 flex items-start justify-center gap-2 text-center text-xs leading-relaxed text-[var(--muted)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
        <span>
          데이터는 서버에 전송되지 않고 브라우저에서 안전하게 처리됩니다.
          파일을 닫으면 메모리에서 즉시 사라집니다.
        </span>
      </p>
    </section>
  );
}
