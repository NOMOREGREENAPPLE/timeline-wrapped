"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import type { Coordinate } from "@/lib/parser";

const HEAT_THRESHOLD = 50_000;
const TARGET_SAMPLES = 40_000;
/** ~0.005° ≈ 550m grid — denser than 1km so hotspots stand out */
const GRID_PRECISION = 200;

interface HeatmapViewProps {
  coordinates: Coordinate[];
  className?: string;
}

/**
 * Always bin into a grid so intensity = visit density (not a flat 0.6).
 * Above 50k points we keep the heaviest bins only (downsampling).
 * Gamma > 1 stretches high-density cells toward max intensity for contrast.
 */
function densityPoints(coords: Coordinate[]): [number, number, number][] {
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

  const maxW = Math.max(1, ...points.map((p) => p.w));
  // Soft-cap at 95th percentile so one mega-hotspot doesn't wash out the rest,
  // but rare cells stay near zero after gamma.
  const weights = points.map((p) => p.w).sort((a, b) => a - b);
  const p95 = weights[Math.floor(weights.length * 0.95)] ?? maxW;
  const cap = Math.max(p95, 1);

  return points.map((p) => {
    const normalized = Math.min(p.w / cap, 1);
    // gamma 2.2 → sparse stays cool, dense → hot red
    const intensity = Math.pow(normalized, 2.2);
    return [p.lat, p.lng, 0.05 + 0.95 * intensity] as [
      number,
      number,
      number,
    ];
  });
}

function HeatLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap();

  useEffect(() => {
    const layer = (
      L as typeof L & {
        heatLayer: (
          latlngs: [number, number, number][],
          opts?: object
        ) => L.Layer;
      }
    ).heatLayer(points, {
      radius: 22,
      blur: 18,
      maxZoom: 17,
      max: 1.0,
      minOpacity: 0.15,
      gradient: {
        0.0: "#0c4a6e",
        0.2: "#0f766e",
        0.45: "#84cc16",
        0.65: "#eab308",
        0.82: "#f97316",
        1.0: "#ef4444",
      },
    });

    layer.addTo(map);
    return () => {
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
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
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
            {binCount.toLocaleString()}셀
            {downsampled ? " (상위 밀도로 샘플링)" : ""}
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
        scrollWheelZoom
        className="z-0 h-[420px] w-full bg-[#0a1210]"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <HeatLayer points={heatPoints} />
        <FitBounds coordinates={coordinates} />
      </MapContainer>
    </div>
  );
}
