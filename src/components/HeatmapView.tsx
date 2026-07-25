"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { Coordinate } from "@/lib/parser";

const HEAT_THRESHOLD = 50_000;
const TARGET_SAMPLES = 40_000;
/** ~0.005° ≈ 550m grid */
const GRID_PRECISION = 200;
/** Beyond this zoom, 550m bins look like discrete dots — lock the scale. */
export const HEATMAP_MAX_ZOOM = 12;

interface HeatmapViewProps {
  coordinates: Coordinate[];
  className?: string;
}

type HeatLatLng = [number, number, number];

type HeatLayerInstance = L.Layer & {
  setLatLngs: (latlngs: HeatLatLng[]) => HeatLayerInstance;
  setOptions: (options: Record<string, unknown>) => HeatLayerInstance;
};

/**
 * Build heat points with intensity relative to THIS user's density distribution.
 * Rank each cell by percentile within the loaded dataset, then apply a steep
 * curve so only the user's own densest areas read as "hot"/red.
 */
function densityPoints(coords: Coordinate[]): HeatLatLng[] {
  if (coords.length === 0) return [];

  const bins = new Map<string, { lat: number; lng: number; w: number }>();

  for (const c of coords) {
    const key = `${Math.round(c.lat * GRID_PRECISION)}_${Math.round(c.lng * GRID_PRECISION)}`;
    const existing = bins.get(key);
    if (existing) {
      existing.w += 1;
      existing.lat += (c.lat - existing.lat) / existing.w;
      existing.lng += (c.lng - existing.lng) / existing.w;
    } else {
      bins.set(key, { lat: c.lat, lng: c.lng, w: 1 });
    }
  }

  let points = [...bins.values()];

  if (points.length > TARGET_SAMPLES) {
    points.sort((a, b) => b.w - a.w);
    points = points.slice(0, TARGET_SAMPLES);
  }

  const sortedWeights = points.map((p) => p.w).sort((a, b) => a - b);
  const n = sortedWeights.length;
  // Empirical CDF: same weight → same percentile (stable for ties)
  const rankAt = (w: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedWeights[mid] < w) lo = mid + 1;
      else hi = mid;
    }
    // upper bound for ties
    let up = lo;
    while (up < n && sortedWeights[up] === w) up++;
    return n <= 1 ? 1 : (up - 1) / (n - 1);
  };

  return points.map((p) => {
    const percentile = rankAt(p.w); // 0..1 within this user's data
    // Steep curve: bottom ~70% stay cool; only top densest go yellow→red
    const intensity = Math.pow(percentile, 3.2);
    return [p.lat, p.lng, 0.08 + 0.92 * intensity];
  });
}

function radiusForZoom(zoom: number): number {
  return Math.round(18 + Math.max(0, zoom - 10) * 2);
}

function blurForZoom(zoom: number): number {
  return Math.round(16 + Math.max(0, zoom - 10) * 1.2);
}

function HeatLayer({ points }: { points: HeatLatLng[] }) {
  const map = useMap();

  useEffect(() => {
    const zoom = map.getZoom();
    const heatApi = L as typeof L & {
      heatLayer: (
        latlngs: HeatLatLng[],
        opts?: Record<string, unknown>
      ) => HeatLayerInstance;
    };

    const layer = heatApi.heatLayer(points, {
      radius: radiusForZoom(zoom),
      blur: blurForZoom(zoom),
      maxZoom: 0,
      max: 1.0,
      minOpacity: 0.12,
      gradient: {
        0.0: "#0c4a6e",
        0.25: "#0f766e",
        0.5: "#84cc16",
        0.72: "#eab308",
        0.88: "#f97316",
        1.0: "#ef4444",
      },
    });

    layer.addTo(map);

    const syncZoomStyle = () => {
      const z = map.getZoom();
      layer.setOptions({
        radius: radiusForZoom(z),
        blur: blurForZoom(z),
        maxZoom: 0,
      });
    };

    map.on("zoomend", syncZoomStyle);
    return () => {
      map.off("zoomend", syncZoomStyle);
      map.removeLayer(layer);
    };
  }, [map, points]);

  return null;
}

function FitBounds({ coordinates }: { coordinates: Coordinate[] }) {
  const map = useMap();

  useEffect(() => {
    if (coordinates.length === 0) return;
    const bounds = L.latLngBounds(
      coordinates.map((c) => [c.lat, c.lng] as [number, number])
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
  }, [map, coordinates]);

  return null;
}

export default function HeatmapView({
  coordinates,
  className,
}: HeatmapViewProps) {
  const heatPoints = useMemo(() => densityPoints(coordinates), [coordinates]);
  const binCount = heatPoints.length;
  const downsampled = coordinates.length > HEAT_THRESHOLD;

  const center = useMemo<[number, number]>(() => {
    if (coordinates.length === 0) return [37.5665, 126.978];
    const mid = coordinates[Math.floor(coordinates.length / 2)];
    return [mid.lat, mid.lng];
  }, [coordinates]);

  if (coordinates.length === 0) {
    return (
      <div
        className={[
          "flex h-[420px] items-center justify-center rounded-2xl bg-[var(--surface)] text-sm text-[var(--muted)]",
          className ?? "",
        ].join(" ")}
      >
        표시할 좌표가 없습니다
      </div>
    );
  }

  return (
    <div
      className={[
        "overflow-hidden rounded-2xl border border-[var(--border)] shadow-lg",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div>
          <h3 className="font-display text-base text-[var(--fg)]">이동 히트맵</h3>
          <p className="text-xs text-[var(--muted)]">
            {coordinates.length.toLocaleString()}개 좌표 → 밀도 격자{" "}
            {binCount.toLocaleString()}셀 · 색상은 이 데이터 기준 상대 순위
            {downsampled ? " · 상위 밀도 샘플링" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
          <span>적음</span>
          <div
            className="h-2 w-28 rounded-full"
            style={{
              background:
                "linear-gradient(90deg,#0c4a6e,#0f766e,#84cc16,#eab308,#f97316,#ef4444)",
            }}
          />
          <span>많음</span>
        </div>
      </div>
      <MapContainer
        center={center}
        zoom={11}
        maxZoom={HEATMAP_MAX_ZOOM}
        scrollWheelZoom
        className="z-0 h-[420px] w-full bg-[#0a1210]"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={HEATMAP_MAX_ZOOM}
        />
        <HeatLayer points={heatPoints} />
        <FitBounds coordinates={coordinates} />
      </MapContainer>
    </div>
  );
}
