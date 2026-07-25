/**
 * Google Timeline JSON parser — privacy-first, 100% client-side.
 * Supports:
 *  1. On-device backup (semanticSegments / timelinePath)
 *  2. Classic Takeout (timelineObjects: placeVisit / activitySegment)
 *  3. Legacy Records (locations[] with latitudeE7 / longitudeE7)
 */

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface ActivityStat {
  type: string;
  distanceMeters: number;
  durationMinutes: number;
}

export interface TopPlace {
  name: string;
  visitCount: number;
}

export interface NormalizedData {
  coordinates: Coordinate[];
  activities: ActivityStat[];
  topPlaces: TopPlace[];
  totalDistanceKm: number;
  dateRange: { start: Date; end: Date };
}

const EARTH_CIRCUMFERENCE_KM = 40_075;
const MOON_DISTANCE_KM = 384_400;

const ACTIVITY_ALIASES: Record<string, string> = {
  walking: "도보",
  on_foot: "도보",
  onfoot: "도보",
  running: "러닝",
  cycling: "자전거",
  on_bicycle: "자전거",
  in_vehicle: "자동차",
  in_passenger_vehicle: "자동차",
  in_car: "자동차",
  driving: "자동차",
  in_bus: "대중교통",
  in_train: "대중교통",
  in_subway: "대중교통",
  in_tram: "대중교통",
  in_ferry: "대중교통",
  flying: "항공",
  in_airplane: "항공",
  still: "정지",
  unknown: "기타",
};

type Loose = Record<string, unknown>;

function isRecord(v: unknown): v is Loose {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** E7 integer → decimal degrees */
function fromE7(v: unknown): number | null {
  const n = toNumber(v);
  if (n === null) return null;
  // Heuristic: values with |n| > 180 are almost certainly E7
  return Math.abs(n) > 180 ? n / 1e7 : n;
}

function parseCoordPair(
  latRaw: unknown,
  lngRaw: unknown
): Coordinate | null {
  const lat = fromE7(latRaw);
  const lng = fromE7(lngRaw);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parseLatLngString(s: string): Coordinate | null {
  // "37.566535°, 126.9780°" or "37.566535,126.9780"
  const cleaned = s.replace(/[°]/g, "").trim();
  const parts = cleaned.split(/[, ]+/).filter(Boolean);
  if (parts.length < 2) return null;
  return parseCoordPair(parts[0], parts[1]);
}

const LAT_E7_KEYS = ["latitudeE7", "latE7"] as const;
const LNG_E7_KEYS = ["longitudeE7", "lngE7", "lonE7"] as const;
const LAT_KEYS = ["latitude", "lat"] as const;
const LNG_KEYS = ["longitude", "lng", "lon"] as const;
const LATLNG_STRING_KEYS = ["latLng", "point", "latlng"] as const;

function firstDefined(o: Loose, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (o[k] != null) return o[k];
  }
  return undefined;
}

/**
 * Pull a coordinate out of any Google Timeline node shape:
 * explicit E7 integer fields, plain decimal fields, or a "lat°, lng°" string.
 * E7 keys divide unconditionally so points near the equator stay correct.
 */
function extractCoord(node: unknown): Coordinate | null {
  if (typeof node === "string") return parseLatLngString(node);
  if (!isRecord(node)) return null;

  const latE7 = firstDefined(node, LAT_E7_KEYS);
  const lngE7 = firstDefined(node, LNG_E7_KEYS);
  if (latE7 !== undefined && lngE7 !== undefined) {
    const lat = toNumber(latE7);
    const lng = toNumber(lngE7);
    if (lat !== null && lng !== null) {
      const c = { lat: lat / 1e7, lng: lng / 1e7 };
      if (c.lat >= -90 && c.lat <= 90 && c.lng >= -180 && c.lng <= 180) {
        return c;
      }
      return null;
    }
  }

  const lat = firstDefined(node, LAT_KEYS);
  const lng = firstDefined(node, LNG_KEYS);
  if (lat !== undefined && lng !== undefined) {
    return parseCoordPair(lat, lng);
  }

  for (const k of LATLNG_STRING_KEYS) {
    const v = node[k];
    if (typeof v === "string") {
      const c = parseLatLngString(v);
      if (c) return c;
    } else if (isRecord(v)) {
      const c = extractCoord(v);
      if (c) return c;
    }
  }

  return null;
}

function parseTimestamp(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number") {
    // seconds vs ms
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    // Google sometimes uses "2024-01-01T12:00:00.000Z" or "2024-01-01T12:00:00Z"
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (isRecord(v)) {
    if ("timestamp" in v) return parseTimestamp(v.timestamp);
    if ("timestampMs" in v) return parseTimestamp(v.timestampMs);
  }
  return null;
}

function normalizeActivityType(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "기타";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ACTIVITY_ALIASES[key] ?? raw.trim();
}

function haversineMeters(a: Coordinate, b: Coordinate): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pushCoord(
  coords: Coordinate[],
  c: Coordinate | null,
  dates: Date[],
  date?: Date | null
) {
  if (!c) return;
  coords.push(c);
  if (date) dates.push(date);
}

function mergeActivity(
  map: Map<string, { distanceMeters: number; durationMinutes: number }>,
  type: string,
  distanceMeters: number,
  durationMinutes: number
) {
  const prev = map.get(type) ?? { distanceMeters: 0, durationMinutes: 0 };
  prev.distanceMeters += Math.max(0, distanceMeters);
  prev.durationMinutes += Math.max(0, durationMinutes);
  map.set(type, prev);
}

function bumpPlace(map: Map<string, number>, name: string) {
  const n = name.trim();
  if (!n || n === "Unknown" || n === "unknown") return;
  map.set(n, (map.get(n) ?? 0) + 1);
}

function durationMinutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return ms > 0 ? ms / 60_000 : 0;
}

// ─── Format detectors ───────────────────────────────────────────────

function hasSemanticSegments(data: Loose): boolean {
  return Array.isArray(data.semanticSegments) || Array.isArray(data.timelinePath);
}

function hasTimelineObjects(data: Loose): boolean {
  return Array.isArray(data.timelineObjects);
}

function hasLegacyLocations(data: Loose): boolean {
  return Array.isArray(data.locations);
}

// ─── Format 1: On-device (semanticSegments / timelinePath) ───────────

function parseSemantic(data: Loose): {
  coords: Coordinate[];
  activities: Map<string, { distanceMeters: number; durationMinutes: number }>;
  places: Map<string, number>;
  dates: Date[];
  distanceMeters: number;
} {
  const coords: Coordinate[] = [];
  const activities = new Map<
    string,
    { distanceMeters: number; durationMinutes: number }
  >();
  const places = new Map<string, number>();
  const dates: Date[] = [];
  let distanceMeters = 0;

  const segments = Array.isArray(data.semanticSegments)
    ? (data.semanticSegments as unknown[])
    : [];

  for (const seg of segments) {
    if (!isRecord(seg)) continue;

    const start = parseTimestamp(seg.startTime ?? seg.startTimestamp);
    const end = parseTimestamp(seg.endTime ?? seg.endTimestamp);
    if (start) dates.push(start);
    if (end) dates.push(end);

    // timelinePath inside segment: [{ point: "lat°, lng°", time }, ...]
    if (Array.isArray(seg.timelinePath)) {
      let prev: Coordinate | null = null;
      for (const p of seg.timelinePath) {
        if (!isRecord(p)) continue;
        const point = extractCoord(p);
        const t = parseTimestamp(p.time ?? p.timestamp);
        pushCoord(coords, point, dates, t);
        if (point && prev) {
          distanceMeters += haversineMeters(prev, point);
        }
        prev = point;
      }
    }

    // visit
    const visit = isRecord(seg.visit) ? seg.visit : null;
    if (visit) {
      const topCandidate = isRecord(visit.topCandidate)
        ? visit.topCandidate
        : null;
      const place =
        isRecord(topCandidate?.placeLocation)
          ? (topCandidate!.placeLocation as Loose)
          : isRecord(visit.placeLocation)
            ? (visit.placeLocation as Loose)
            : null;

      const semanticLabel = (raw: string) => {
        const map: Record<string, string> = {
          INFERRED_HOME: "집",
          INFERRED_WORK: "직장",
          HOME: "집",
          WORK: "직장",
        };
        return map[raw] ?? raw.replace(/^INFERRED_/, "").replace(/_/g, " ");
      };

      const nameCandidate =
        (typeof place?.name === "string" && place.name) ||
        (typeof topCandidate?.name === "string" && topCandidate.name) ||
        (typeof topCandidate?.semanticType === "string" &&
          semanticLabel(topCandidate.semanticType)) ||
        (typeof visit.placeId === "string" && visit.placeId) ||
        "";

      if (typeof nameCandidate === "string" && nameCandidate) {
        bumpPlace(places, nameCandidate);
      }

      pushCoord(coords, extractCoord(place), dates, start);
    }

    // activity
    const activity = isRecord(seg.activity) ? seg.activity : null;
    if (activity) {
      const topCandidate = isRecord(activity.topCandidate)
        ? activity.topCandidate
        : null;
      const type = normalizeActivityType(
        topCandidate?.type ?? activity.activityType ?? activity.type
      );
      const dist =
        toNumber(activity.distanceMeters) ??
        toNumber(topCandidate?.distanceMeters) ??
        0;
      const dur = durationMinutesBetween(start, end);
      mergeActivity(activities, type, dist, dur);
      distanceMeters += dist;

      pushCoord(coords, extractCoord(activity.start), dates, start);
      pushCoord(coords, extractCoord(activity.end), dates, end);
    }
  }

  // Top-level timelinePath
  if (Array.isArray(data.timelinePath)) {
    let prev: Coordinate | null = null;
    for (const p of data.timelinePath as unknown[]) {
      if (!isRecord(p)) continue;
      const point = extractCoord(p);
      const t = parseTimestamp(p.time ?? p.timestamp);
      pushCoord(coords, point, dates, t);
      if (point && prev) distanceMeters += haversineMeters(prev, point);
      prev = point;
    }
  }

  return { coords, activities, places, dates, distanceMeters };
}

// ─── Format 2: Takeout timelineObjects ──────────────────────────────

function parseTimelineObjects(data: Loose): {
  coords: Coordinate[];
  activities: Map<string, { distanceMeters: number; durationMinutes: number }>;
  places: Map<string, number>;
  dates: Date[];
  distanceMeters: number;
} {
  const coords: Coordinate[] = [];
  const activities = new Map<
    string,
    { distanceMeters: number; durationMinutes: number }
  >();
  const places = new Map<string, number>();
  const dates: Date[] = [];
  let distanceMeters = 0;

  const objects = data.timelineObjects as unknown[];

  for (const obj of objects) {
    if (!isRecord(obj)) continue;

    // placeVisit
    if (isRecord(obj.placeVisit)) {
      const pv = obj.placeVisit;
      const loc = isRecord(pv.location) ? pv.location : null;
      const name =
        (typeof loc?.name === "string" && loc.name) ||
        (typeof loc?.address === "string" && loc.address) ||
        (typeof loc?.placeId === "string" && loc.placeId) ||
        "";
      if (name) bumpPlace(places, name);

      const c = extractCoord(loc);
      const start = parseTimestamp(
        isRecord(pv.duration) ? pv.duration.startTimestampMs ?? pv.duration.startTimestamp : null
      ) ?? parseTimestamp(pv.startTimestampMs ?? pv.startTimestamp);
      const end = parseTimestamp(
        isRecord(pv.duration) ? pv.duration.endTimestampMs ?? pv.duration.endTimestamp : null
      ) ?? parseTimestamp(pv.endTimestampMs ?? pv.endTimestamp);
      pushCoord(coords, c, dates, start);
      if (end) dates.push(end);
    }

    // activitySegment
    if (isRecord(obj.activitySegment)) {
      const asg = obj.activitySegment;
      const type = normalizeActivityType(
        asg.activityType ??
          (Array.isArray(asg.activities) &&
          isRecord((asg.activities as unknown[])[0])
            ? ((asg.activities as Loose[])[0].activityType as unknown)
            : null)
      );
      const dist = toNumber(asg.distance) ?? 0;
      const start = parseTimestamp(
        isRecord(asg.duration)
          ? asg.duration.startTimestampMs ?? asg.duration.startTimestamp
          : asg.startTimestampMs ?? asg.startTimestamp
      );
      const end = parseTimestamp(
        isRecord(asg.duration)
          ? asg.duration.endTimestampMs ?? asg.duration.endTimestamp
          : asg.endTimestampMs ?? asg.endTimestamp
      );
      mergeActivity(activities, type, dist, durationMinutesBetween(start, end));
      distanceMeters += dist;

      const startLoc = extractCoord(asg.startLocation);
      const endLoc = extractCoord(asg.endLocation);
      pushCoord(coords, startLoc, dates, start);
      pushCoord(coords, endLoc, dates, end);

      // waypointPath / simplifiedPath
      const path = Array.isArray(asg.waypointPath)
        ? asg.waypointPath
        : isRecord(asg.waypointPath) &&
            Array.isArray((asg.waypointPath as Loose).waypoints)
          ? ((asg.waypointPath as Loose).waypoints as unknown[])
          : Array.isArray(asg.simplifiedRawPath)
            ? asg.simplifiedRawPath
            : isRecord(asg.simplifiedRawPath) &&
                Array.isArray((asg.simplifiedRawPath as Loose).points)
              ? ((asg.simplifiedRawPath as Loose).points as unknown[])
              : [];

      let prev: Coordinate | null = startLoc;
      for (const wp of path) {
        if (!isRecord(wp)) continue;
        const c = extractCoord(wp);
        pushCoord(coords, c, dates, parseTimestamp(wp.timestampMs ?? wp.timestamp));
        if (c && prev && dist === 0) {
          distanceMeters += haversineMeters(prev, c);
        }
        if (c) prev = c;
      }
    }
  }

  return { coords, activities, places, dates, distanceMeters };
}

// ─── Format 3: Legacy locations[] ───────────────────────────────────

function parseLegacyLocations(data: Loose): {
  coords: Coordinate[];
  activities: Map<string, { distanceMeters: number; durationMinutes: number }>;
  places: Map<string, number>;
  dates: Date[];
  distanceMeters: number;
} {
  const coords: Coordinate[] = [];
  const activities = new Map<
    string,
    { distanceMeters: number; durationMinutes: number }
  >();
  const places = new Map<string, number>();
  const dates: Date[] = [];
  let distanceMeters = 0;

  const locations = data.locations as unknown[];
  let prev: Coordinate | null = null;
  let prevTime: Date | null = null;

  // Raw GPS pings are noisy: drop low-accuracy fixes, ignore sub-15m jitter,
  // and cap single hops so a bad fix cannot add hundreds of km.
  const MAX_ACCURACY_M = 500;
  const MIN_HOP_M = 15;
  const MAX_HOP_M = 50_000;

  for (const loc of locations) {
    if (!isRecord(loc)) continue;

    const accuracy = toNumber(loc.accuracy);
    if (accuracy !== null && accuracy > MAX_ACCURACY_M) continue;

    const c = extractCoord(loc);
    const t = parseTimestamp(loc.timestampMs ?? loc.timestamp ?? loc.time);
    pushCoord(coords, c, dates, t);

    if (c && prev) {
      const d = haversineMeters(prev, c);
      if (d >= MIN_HOP_M && d < MAX_HOP_M) distanceMeters += d;
    }

    // Records.json nests candidates as activity[].activity[]; older exports
    // put {type, confidence} directly in the outer array.
    const buckets = Array.isArray(loc.activity)
      ? loc.activity
      : Array.isArray(loc.activities)
        ? loc.activities
        : [];
    const durationMinutes =
      prevTime && t ? durationMinutesBetween(prevTime, t) : 0;

    for (const bucket of buckets) {
      if (!isRecord(bucket)) continue;
      const candidates = Array.isArray(bucket.activity)
        ? (bucket.activity as unknown[])
        : [bucket];
      const best = candidates
        .filter(isRecord)
        .sort((a, b) => (toNumber(b.confidence) ?? 0) - (toNumber(a.confidence) ?? 0))[0];
      if (!best) continue;
      const conf = toNumber(best.confidence) ?? 0;
      if (conf > 0 && conf < 50) continue;
      const type = normalizeActivityType(
        best.type ?? best.activity ?? best.activityType
      );
      mergeActivity(
        activities,
        type,
        0,
        durationMinutes / Math.max(buckets.length, 1)
      );
    }

    if (c) prev = c;
    if (t) prevTime = t;
  }

  return { coords, activities, places, dates, distanceMeters };
}

// ─── Public API ─────────────────────────────────────────────────────

function finalize(partial: {
  coords: Coordinate[];
  activities: Map<string, { distanceMeters: number; durationMinutes: number }>;
  places: Map<string, number>;
  dates: Date[];
  distanceMeters: number;
}): NormalizedData {
  const activities: ActivityStat[] = [...partial.activities.entries()]
    .map(([type, v]) => ({
      type,
      distanceMeters: v.distanceMeters,
      durationMinutes: Math.round(v.durationMinutes * 10) / 10,
    }))
    .filter((a) => a.type !== "정지")
    .sort(
      (a, b) =>
        b.distanceMeters + b.durationMinutes * 50 -
        (a.distanceMeters + a.durationMinutes * 50)
    );

  const topPlaces: TopPlace[] = [...partial.places.entries()]
    .map(([name, visitCount]) => ({ name, visitCount }))
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, 20);

  let start = new Date();
  let end = new Date(0);
  if (partial.dates.length > 0) {
    start = partial.dates[0];
    end = partial.dates[0];
    for (const d of partial.dates) {
      if (d < start) start = d;
      if (d > end) end = d;
    }
  } else {
    start = new Date();
    end = new Date();
  }

  return {
    coordinates: partial.coords,
    activities,
    topPlaces,
    totalDistanceKm: Math.round((partial.distanceMeters / 1000) * 10) / 10,
    dateRange: { start, end },
  };
}

/**
 * Parse a Google Timeline / Records JSON object into NormalizedData.
 * Safe for large payloads — single-pass, guarded with try/catch.
 */
export function parseTimelineJson(raw: unknown): NormalizedData {
  try {
    if (!isRecord(raw)) {
      throw new Error("JSON 루트가 객체가 아닙니다.");
    }

    let partial;
    if (hasSemanticSegments(raw)) {
      partial = parseSemantic(raw);
    } else if (hasTimelineObjects(raw)) {
      partial = parseTimelineObjects(raw);
    } else if (hasLegacyLocations(raw)) {
      partial = parseLegacyLocations(raw);
    } else {
      // Fallback: scan for any known nested keys
      if (isRecord(raw.timelineData) && hasSemanticSegments(raw.timelineData as Loose)) {
        partial = parseSemantic(raw.timelineData as Loose);
      } else {
        throw new Error(
          "지원하지 않는 JSON 형식입니다. Timeline.json 또는 Records.json을 확인해 주세요."
        );
      }
    }

    if (partial.coords.length === 0 && partial.places.size === 0) {
      throw new Error("위치 데이터를 찾을 수 없습니다. 파일 내용을 확인해 주세요.");
    }

    return finalize(partial);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("JSON 파싱 중 알 수 없는 오류가 발생했습니다.");
  }
}

/**
 * Read a File as text and parse it. Yields to the event loop before heavy work.
 */
export async function parseTimelineFile(file: File): Promise<NormalizedData> {
  const text = await file.text();
  // Yield so the browser can paint the loading UI before JSON.parse
  await new Promise<void>((r) => setTimeout(r, 0));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("유효한 JSON 파일이 아닙니다.");
  }
  await new Promise<void>((r) => setTimeout(r, 0));
  return parseTimelineJson(raw);
}

export function earthLaps(totalDistanceKm: number): number {
  return Math.round((totalDistanceKm / EARTH_CIRCUMFERENCE_KM) * 1000) / 1000;
}

export function moonPercent(totalDistanceKm: number): number {
  return Math.round((totalDistanceKm / MOON_DISTANCE_KM) * 10000) / 100;
}

export function wrappedTitle(totalDistanceKm: number): string {
  const laps = earthLaps(totalDistanceKm);
  if (laps >= 1) return `지구 ${laps.toFixed(1)}바퀴를 정복한 탐험가`;
  if (laps >= 0.1) return `지구 둘레 ${laps.toFixed(2)}바퀴를 정복한 방랑자`;
  if (totalDistanceKm >= 1000) return `천 킬로를 넘긴 로드트립퍼`;
  if (totalDistanceKm >= 100) return `동네를 넘어선 도시 유목민`;
  return `발걸음을 기록하는 산책가`;
}

export { EARTH_CIRCUMFERENCE_KM, MOON_DISTANCE_KM };
