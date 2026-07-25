"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import type { Coordinate } from "@/lib/parser";

const HEAT_THRESHOLD = 50_000;
const TARGET_SAMPLES = 40_000;

interface HeatmapViewProps {
  coordinates: Coordinate[];
  className?: string;
}

/** Weighted grid downsampling for 50k+ points */
function downsample(coords: Coordinate[]): [number, number, number][] {
  if (coords.length <= HEAT_THRESHOLD) {
    return coords.map((c) => [c.lat, c.lng, 0.6]);
  }

  // ~0.01° bins (~1km) — accumulate density as heat weight
  const bins = new Map<string, { lat: number; lng: number; w: number }>();
  const precision = 100; // 0.01°

  for (const c of coords) {
    const key = `${Math.round(c.lat * precision)}_${Math.round(c.lng * precision)}`;
    const existing = bins.get(key);
    if (existing) {
      existing.w += 1;
      // running average of position inside bin
      existing.lat += (c.lat - existing.lat) / existing.w;
      existing.lng += (c.lng - existing.lng) / existing.w;
    } else {
      bins.set(key, { lat: c.lat, lng: c.lng, w: 1 });
    }
  }

  let points = [...bins.values()];

  if (points.length > TARGET_SAMPLES) {
    // Keep heaviest bins
    points.sort((a, b) => b.w - a.w);
    points = points.slice(0, TARGET_SAMPLES);
  }

  const maxW = Math.max(1, ...points.map((p) => p.w));
  return points.map((p) => [
    p.lat,
    p.lng,
    0.3 + (0.7 * p.w) / maxW,
  ]);
}

function HeatLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap();

  useEffect(() => {
    // leaflet.heat augments L
    const layer = (
      L as typeof L & {
        heatLayer: (
          latlngs: [number, number, number][],
          opts?: object
        ) => L.Layer;
      }
    ).heatLayer(points, {
      radius: 18,
      blur: 22,
      maxZoom: 17,
      max: 1.0,
      minOpacity: 0.35,
      gradient: {
        0.2: "#0f766e",
        0.4: "#14b8a6",
        0.6: "#2dd4bf",
        0.8: "#fbbf24",
        1.0: "#f97316",
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
  const heatPoints = useMemo(() => downsample(coordinates), [coordinates]);

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
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div>
          <h3 className="font-display text-base text-[var(--fg)]">이동 히트맵</h3>
          <p className="text-xs text-[var(--muted)]">
            {coordinates.length.toLocaleString()}개 좌표
            {coordinates.length > HEAT_THRESHOLD
              ? ` → ${heatPoints.length.toLocaleString()}개로 샘플링`
              : ""}
          </p>
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
