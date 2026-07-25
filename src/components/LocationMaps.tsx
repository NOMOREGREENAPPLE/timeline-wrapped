"use client";

import { useEffect, useMemo, useState } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { PathOptions } from "leaflet";
import type { Coordinate } from "@/lib/parser";
import type { RegionCount, RegionKind } from "@/lib/regions";
import {
  featureRegionId,
  featureRegionLabel,
  loadRegionGeoJSON,
} from "@/lib/regions";
import HeatmapView from "@/components/HeatmapView";

type TabId = "heat" | "kr" | "world";

interface LocationMapsProps {
  coordinates: Coordinate[];
  korea: RegionCount[];
  world: RegionCount[];
  regionsLoading?: boolean;
}

type FC = GeoJSON.FeatureCollection;

function colorForCount(count: number, max: number): string {
  if (max <= 0 || count <= 0) return "transparent";
  const t = Math.pow(count / max, 0.55);
  if (t < 0.25) return "rgba(15, 118, 110, 0.45)";
  if (t < 0.5) return "rgba(45, 212, 191, 0.55)";
  if (t < 0.75) return "rgba(234, 179, 8, 0.6)";
  if (t < 0.9) return "rgba(249, 115, 22, 0.7)";
  return "rgba(239, 68, 68, 0.8)";
}

function FitBoundsToGeo({ geo }: { geo: FC }) {
  const map = useMap();
  useEffect(() => {
    if (!geo.features.length) return;
    try {
      const layer = L.geoJSON(geo as GeoJSON.GeoJsonObject);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 9 });
      }
    } catch {
      // ignore unfit geometries
    }
  }, [map, geo]);
  return null;
}

function ChoroplethMap({
  kind,
  regions,
}: {
  kind: RegionKind;
  regions: RegionCount[];
}) {
  const [rawGeo, setRawGeo] = useState<FC | null>(null);
  const [error, setError] = useState<string | null>(null);

  const countById = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of regions) map.set(r.id, r.count);
    return map;
  }, [regions]);

  const maxCount = regions[0]?.count ?? 0;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void loadRegionGeoJSON(kind)
      .then((data) => {
        if (!cancelled) setRawGeo(data as unknown as FC);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "지도 로드 실패");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const displayGeo = useMemo(() => {
    if (!rawGeo) return null;
    if (kind === "world") return rawGeo;
    return {
      type: "FeatureCollection",
      features: rawGeo.features.filter((feature) => {
        const id = featureRegionId(
          kind,
          feature.properties as Record<string, unknown> | undefined
        );
        return id != null && countById.has(id);
      }),
    } as FC;
  }, [rawGeo, kind, countById]);

  const center: [number, number] = kind === "kr" ? [36.4, 127.8] : [20, 10];
  const zoom = kind === "kr" ? 7 : 2;

  if (error) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!displayGeo) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-[var(--muted)]">
        경계 지도 불러오는 중…
      </div>
    );
  }

  if (kind === "kr" && displayGeo.features.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-[var(--muted)]">
        한국 시·군·구 방문 기록이 없습니다
      </div>
    );
  }

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      className="z-0 h-[420px] w-full bg-[#0a1210]"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <GeoJSON
        key={`${kind}-${regions.length}-${maxCount}`}
        data={displayGeo as GeoJSON.GeoJsonObject}
        style={(feature) => {
          const props = feature?.properties as
            | Record<string, unknown>
            | undefined;
          const id = featureRegionId(kind, props);
          const count = id ? countById.get(id) ?? 0 : 0;
          const visited = count > 0;
          const style: PathOptions = {
            fillColor: visited ? colorForCount(count, maxCount) : "transparent",
            fillOpacity: visited ? 0.85 : 0,
            color: visited
              ? "rgba(255,255,255,0.35)"
              : "rgba(255,255,255,0.06)",
            weight: visited ? 1 : 0.4,
          };
          return style;
        }}
        onEachFeature={(feature, layer) => {
          const props = feature.properties as
            | Record<string, unknown>
            | undefined;
          const id = featureRegionId(kind, props);
          const label = featureRegionLabel(kind, props);
          const count = id ? countById.get(id) ?? 0 : 0;
          if (count > 0) {
            layer.bindTooltip(
              `<strong>${label}</strong><br/>체류 밀도 ${count.toLocaleString()}`,
              { sticky: true }
            );
          }
        }}
      />
      <FitBoundsToGeo geo={displayGeo} />
    </MapContainer>
  );
}

export default function LocationMaps({
  coordinates,
  korea,
  world,
  regionsLoading = false,
}: LocationMapsProps) {
  const [tab, setTab] = useState<TabId>("heat");

  const tabs: { id: TabId; label: string; hint: string }[] = [
    { id: "heat", label: "히트맵", hint: "이동 밀도" },
    {
      id: "kr",
      label: "한국 시·군·구",
      hint: regionsLoading ? "분석 중…" : `${korea.length}곳`,
    },
    {
      id: "world",
      label: "세계 지도",
      hint: regionsLoading ? "분석 중…" : `${world.length}개국`,
    },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] shadow-lg">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] p-2">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "rounded-xl px-3.5 py-2 text-left transition",
                active
                  ? "bg-[var(--accent)] text-[#04201c]"
                  : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--fg)]",
              ].join(" ")}
            >
              <span className="block text-sm font-medium">{t.label}</span>
              <span
                className={[
                  "block text-[10px]",
                  active ? "text-[#04201c]/70" : "text-[var(--muted)]",
                ].join(" ")}
              >
                {t.hint}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "heat" && (
        <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
          <HeatmapView coordinates={coordinates} />
        </div>
      )}
      {tab === "kr" && (
        <div>
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--muted)]">
            <span>방문한 시·군·구만 색칠 · 농도는 이 데이터 기준 상대값</span>
            <span>{korea.length.toLocaleString()}곳</span>
          </div>
          {regionsLoading ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-[var(--muted)]">
              좌표를 시·군·구로 매칭하는 중…
            </div>
          ) : (
            <ChoroplethMap kind="kr" regions={korea} />
          )}
        </div>
      )}
      {tab === "world" && (
        <div>
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--muted)]">
            <span>방문한 국가가 색칠됩니다 · 농도는 이 데이터 기준 상대값</span>
            <span>{world.length.toLocaleString()}개국</span>
          </div>
          {regionsLoading ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-[var(--muted)]">
              좌표를 국가로 매칭하는 중…
            </div>
          ) : (
            <ChoroplethMap kind="world" regions={world} />
          )}
        </div>
      )}
    </section>
  );
}
