/**
 * Client-side reverse geocoding via local GeoJSON (no coordinates leave the browser).
 * Korea → 시·군·구, elsewhere → country.
 */

export type RegionKind = "kr" | "world";

export interface RegionCount {
  id: string;
  name: string;
  kind: RegionKind;
  count: number;
}

type Ring = number[][];
type PolygonCoords = Ring[];
type MultiPolygonCoords = PolygonCoords[];

interface IndexedFeature {
  id: string;
  name: string;
  kind: RegionKind;
  bbox: [number, number, number, number]; // minLng,minLat,maxLng,maxLat
  polygons: PolygonCoords[];
}

interface GeoJSONFeature {
  type: string;
  properties?: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates: unknown;
  };
}

interface GeoJSONFC {
  type: string;
  features: GeoJSONFeature[];
}

const SIDO: Record<string, string> = {
  "11": "서울",
  "21": "부산",
  "22": "대구",
  "23": "인천",
  "24": "광주",
  "25": "대전",
  "26": "울산",
  "29": "세종",
  "31": "경기",
  "32": "강원",
  "33": "충북",
  "34": "충남",
  "35": "전북",
  "36": "전남",
  "37": "경북",
  "38": "경남",
  "39": "제주",
};

const DUP_SHORT = new Set([
  "중구",
  "동구",
  "서구",
  "남구",
  "북구",
  "강서구",
  "고성군",
]);

let koreaIndex: IndexedFeature[] | null = null;
let worldIndex: IndexedFeature[] | null = null;
let loadPromise: Promise<void> | null = null;

function koreaLabel(code: string, rawName: string): string {
  const name = rawName.replace(/(시)(?=[가-힣]+[구군]$)/, "$1 ");
  const sido = SIDO[code.slice(0, 2)];
  if (DUP_SHORT.has(rawName) && sido) return `${sido} ${name}`;
  if (/^[가-힣]+시/.test(name) || name.endsWith("군") || name.endsWith("구")) {
    return name;
  }
  return sido ? `${sido} ${name}` : name;
}

function bboxOf(polygons: PolygonCoords[]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const pos of ring) {
        const lng = pos[0];
        const lat = pos[1];
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygons(
  lng: number,
  lat: number,
  polygons: PolygonCoords[]
): boolean {
  for (const polygon of polygons) {
    if (!polygon.length) continue;
    if (!pointInRing(lng, lat, polygon[0])) continue;
    let inHole = false;
    for (let r = 1; r < polygon.length; r++) {
      if (pointInRing(lng, lat, polygon[r])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

function geometryToPolygons(geometry: {
  type: string;
  coordinates: unknown;
}): PolygonCoords[] {
  if (geometry.type === "Polygon") {
    return [geometry.coordinates as PolygonCoords];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates as MultiPolygonCoords;
  }
  return [];
}

function indexFeatures(
  fc: GeoJSONFC,
  kind: RegionKind
): IndexedFeature[] {
  const out: IndexedFeature[] = [];
  for (const feature of fc.features) {
    if (!feature.geometry) continue;
    const props = feature.properties ?? {};
    const polygons = geometryToPolygons(feature.geometry);
    if (!polygons.length) continue;

    if (kind === "kr") {
      const code = String(props.code ?? "");
      const rawName = String(props.name ?? "");
      if (!rawName) continue;
      const name = koreaLabel(code, rawName);
      const id = `kr:${code || name}`;
      out.push({ id, name, kind, bbox: bboxOf(polygons), polygons });
    } else {
      const name = String(props.admin ?? props.name ?? "");
      if (!name) continue;
      const id = `world:${name}`;
      out.push({ id, name, kind, bbox: bboxOf(polygons), polygons });
    }
  }
  return out;
}

async function ensureIndexes(): Promise<void> {
  if (koreaIndex && worldIndex) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [krRes, worldRes] = await Promise.all([
      fetch("/geo/kr-sigungu.geojson"),
      fetch("/geo/countries-110m.geojson"),
    ]);
    if (!krRes.ok || !worldRes.ok) {
      throw new Error("지자체 경계 데이터를 불러오지 못했습니다.");
    }
    const [krJson, worldJson] = (await Promise.all([
      krRes.json(),
      worldRes.json(),
    ])) as [GeoJSONFC, GeoJSONFC];
    koreaIndex = indexFeatures(krJson, "kr");
    worldIndex = indexFeatures(worldJson, "world");
  })();
  return loadPromise;
}

function lookup(
  index: IndexedFeature[],
  lat: number,
  lng: number
): IndexedFeature | null {
  for (const feature of index) {
    const [minLng, minLat, maxLng, maxLat] = feature.bbox;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    if (pointInPolygons(lng, lat, feature.polygons)) return feature;
  }
  return null;
}

type Hit = { id: string; name: string } | null;

function lookupKorea(lat: number, lng: number): Hit {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (koreaCache.has(key)) return koreaCache.get(key)!;
  const kr = lookup(koreaIndex!, lat, lng);
  const hit = kr ? { id: kr.id, name: kr.name } : null;
  koreaCache.set(key, hit);
  return hit;
}

function lookupWorld(lat: number, lng: number): Hit {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (worldCache.has(key)) return worldCache.get(key)!;
  const world = lookup(worldIndex!, lat, lng);
  const hit = world ? { id: world.id, name: world.name } : null;
  worldCache.set(key, hit);
  return hit;
}

/**
 * Aggregate coordinates into visited regions.
 * Points are first binned (~1.1km) so dense GPS trails don't explode work,
 * then each bin is reverse-geocoded once and weighted by its count.
 */
export async function summarizeRegions(
  coordinates: { lat: number; lng: number }[]
): Promise<{ korea: RegionCount[]; world: RegionCount[] }> {
  await ensureIndexes();

  const bins = new Map<string, { lat: number; lng: number; w: number }>();
  const precision = 90; // ~0.011° ≈ 1.2km
  for (const c of coordinates) {
    const key = `${Math.round(c.lat * precision)}_${Math.round(c.lng * precision)}`;
    const existing = bins.get(key);
    if (existing) {
      existing.w += 1;
      existing.lat += (c.lat - existing.lat) / existing.w;
      existing.lng += (c.lng - existing.lng) / existing.w;
    } else {
      bins.set(key, { lat: c.lat, lng: c.lng, w: 1 });
    }
  }

  const koreaMap = new Map<string, RegionCount>();
  const worldMap = new Map<string, RegionCount>();
  let i = 0;
  for (const bin of bins.values()) {
    // Country and district are counted independently so a Korean point
    // contributes to BOTH its 시·군·구 and to "South Korea" on the world map.
    const world = lookupWorld(bin.lat, bin.lng);
    if (world) {
      const prev = worldMap.get(world.id);
      if (prev) prev.count += bin.w;
      else worldMap.set(world.id, { ...world, kind: "world", count: bin.w });
    }
    const kr = lookupKorea(bin.lat, bin.lng);
    if (kr) {
      const prev = koreaMap.get(kr.id);
      if (prev) prev.count += bin.w;
      else koreaMap.set(kr.id, { ...kr, kind: "kr", count: bin.w });
    }
    i += 1;
    if (i % 400 === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  const sortDesc = (a: RegionCount, b: RegionCount) => b.count - a.count;
  return {
    korea: [...koreaMap.values()].sort(sortDesc),
    world: [...worldMap.values()].sort(sortDesc),
  };
}

/** Per-index caches so choropleth coloring can reuse lookups while painting. */
const koreaCache = new Map<string, Hit>();
const worldCache = new Map<string, Hit>();

export async function loadRegionGeoJSON(kind: RegionKind): Promise<GeoJSONFC> {
  const path =
    kind === "kr" ? "/geo/kr-sigungu.geojson" : "/geo/countries-110m.geojson";
  const res = await fetch(path);
  if (!res.ok) throw new Error("경계 데이터를 불러오지 못했습니다.");
  return (await res.json()) as GeoJSONFC;
}

export function featureRegionId(
  kind: RegionKind,
  props: Record<string, unknown> | null | undefined
): string | null {
  if (!props) return null;
  if (kind === "kr") {
    const code = String(props.code ?? "");
    const name = String(props.name ?? "");
    if (!name) return null;
    return `kr:${code || name}`;
  }
  const name = String(props.admin ?? props.name ?? "");
  return name ? `world:${name}` : null;
}

export function featureRegionLabel(
  kind: RegionKind,
  props: Record<string, unknown> | null | undefined
): string {
  if (!props) return "";
  if (kind === "kr") {
    return koreaLabel(String(props.code ?? ""), String(props.name ?? ""));
  }
  return String(props.admin ?? props.name ?? "");
}
