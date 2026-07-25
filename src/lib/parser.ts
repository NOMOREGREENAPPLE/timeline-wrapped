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
  /** Epoch ms when known — used for date-range filtering */
  t?: number;
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

/** Full parse result with timed events so the UI can re-slice by date range. */
export interface TimelineBundle {
  points: Coordinate[];
  visits: { name: string; t: number | null }[];
  activities: {
    type: string;
    distanceMeters: number;
    durationMinutes: number;
    t: number | null;
  }[];
  /** Distance contributions recorded during parse (path hops + activity distances) */
  hops: { meters: number; t: number | null }[];
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

type ParseAcc = {
  points: Coordinate[];
  visits: { name: string; t: number | null }[];
  activities: {
    type: string;
    distanceMeters: number;
    durationMinutes: number;
    t: number | null;
  }[];
  hops: { meters: number; t: number | null }[];
};

function emptyAcc(): ParseAcc {
  return { points: [], visits: [], activities: [], hops: [] };
}

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
  return Math.abs(n) > 180 ? n / 1e7 : n;
}

function parseCoordPair(
  latRaw: unknown,
  lngRaw: unknown
): { lat: number; lng: number } | null {
  const lat = fromE7(latRaw);
  const lng = fromE7(lngRaw);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function parseLatLngString(s: string): { lat: number; lng: number } | null {
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

function extractCoord(node: unknown): { lat: number; lng: number } | null {
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
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
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

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
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

function pushPoint(
  acc: ParseAcc,
  c: { lat: number; lng: number } | null,
  date?: Date | null
) {
  if (!c) return;
  acc.points.push({
    lat: c.lat,
    lng: c.lng,
    ...(date ? { t: date.getTime() } : {}),
  });
}

function pushVisit(acc: ParseAcc, name: string, date?: Date | null) {
  const n = name.trim();
  if (!n || n === "Unknown" || n === "unknown") return;
  acc.visits.push({ name: n, t: date ? date.getTime() : null });
}

function pushActivity(
  acc: ParseAcc,
  type: string,
  distanceMeters: number,
  durationMinutes: number,
  date?: Date | null
) {
  acc.activities.push({
    type,
    distanceMeters: Math.max(0, distanceMeters),
    durationMinutes: Math.max(0, durationMinutes),
    t: date ? date.getTime() : null,
  });
}

function pushHop(acc: ParseAcc, meters: number, date?: Date | null) {
  if (meters <= 0) return;
  acc.hops.push({ meters, t: date ? date.getTime() : null });
}

function durationMinutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return ms > 0 ? ms / 60_000 : 0;
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function inRange(
  t: number | null | undefined,
  fromMs: number,
  toMs: number,
  includeUntimed: boolean
): boolean {
  if (t == null) return includeUntimed;
  return t >= fromMs && t <= toMs;
}

function hasSemanticSegments(data: Loose): boolean {
  return Array.isArray(data.semanticSegments) || Array.isArray(data.timelinePath);
}

function hasTimelineObjects(data: Loose): boolean {
  return Array.isArray(data.timelineObjects);
}

function hasLegacyLocations(data: Loose): boolean {
  return Array.isArray(data.locations);
}

function parseSemantic(data: Loose): ParseAcc {
  const acc = emptyAcc();
  const segments = Array.isArray(data.semanticSegments)
    ? (data.semanticSegments as unknown[])
    : [];

  for (const seg of segments) {
    if (!isRecord(seg)) continue;

    const start = parseTimestamp(seg.startTime ?? seg.startTimestamp);
    const end = parseTimestamp(seg.endTime ?? seg.endTimestamp);

    if (Array.isArray(seg.timelinePath)) {
      let prev: { lat: number; lng: number } | null = null;
      for (const p of seg.timelinePath) {
        if (!isRecord(p)) continue;
        const point = extractCoord(p);
        const t = parseTimestamp(p.time ?? p.timestamp) ?? start;
        pushPoint(acc, point, t);
        if (point && prev) pushHop(acc, haversineMeters(prev, point), t);
        prev = point;
      }
    }

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
        pushVisit(acc, nameCandidate, start);
      }
      pushPoint(acc, extractCoord(place), start);
    }

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
      pushActivity(acc, type, dist, dur, start);
      pushHop(acc, dist, start);
      pushPoint(acc, extractCoord(activity.start), start);
      pushPoint(acc, extractCoord(activity.end), end);
    }
  }

  if (Array.isArray(data.timelinePath)) {
    let prev: { lat: number; lng: number } | null = null;
    for (const p of data.timelinePath as unknown[]) {
      if (!isRecord(p)) continue;
      const point = extractCoord(p);
      const t = parseTimestamp(p.time ?? p.timestamp);
      pushPoint(acc, point, t);
      if (point && prev) pushHop(acc, haversineMeters(prev, point), t);
      prev = point;
    }
  }

  return acc;
}

function parseTimelineObjects(data: Loose): ParseAcc {
  const acc = emptyAcc();
  const objects = data.timelineObjects as unknown[];

  for (const obj of objects) {
    if (!isRecord(obj)) continue;

    if (isRecord(obj.placeVisit)) {
      const pv = obj.placeVisit;
      const loc = isRecord(pv.location) ? pv.location : null;
      const name =
        (typeof loc?.name === "string" && loc.name) ||
        (typeof loc?.address === "string" && loc.address) ||
        (typeof loc?.placeId === "string" && loc.placeId) ||
        "";
      const start =
        parseTimestamp(
          isRecord(pv.duration)
            ? pv.duration.startTimestampMs ?? pv.duration.startTimestamp
            : null
        ) ?? parseTimestamp(pv.startTimestampMs ?? pv.startTimestamp);

      if (name) pushVisit(acc, name, start);
      pushPoint(acc, extractCoord(loc), start);
    }

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
      pushActivity(acc, type, dist, durationMinutesBetween(start, end), start);
      pushHop(acc, dist, start);

      const startLoc = extractCoord(asg.startLocation);
      const endLoc = extractCoord(asg.endLocation);
      pushPoint(acc, startLoc, start);
      pushPoint(acc, endLoc, end);

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

      let prev: { lat: number; lng: number } | null = startLoc;
      for (const wp of path) {
        if (!isRecord(wp)) continue;
        const c = extractCoord(wp);
        const t = parseTimestamp(wp.timestampMs ?? wp.timestamp) ?? start;
        pushPoint(acc, c, t);
        if (c && prev && dist === 0) {
          pushHop(acc, haversineMeters(prev, c), t);
        }
        if (c) prev = c;
      }
    }
  }

  return acc;
}

function parseLegacyLocations(data: Loose): ParseAcc {
  const acc = emptyAcc();
  const locations = data.locations as unknown[];
  let prev: { lat: number; lng: number } | null = null;
  let prevTime: Date | null = null;

  const MAX_ACCURACY_M = 500;
  const MIN_HOP_M = 15;
  const MAX_HOP_M = 50_000;

  for (const loc of locations) {
    if (!isRecord(loc)) continue;

    const accuracy = toNumber(loc.accuracy);
    if (accuracy !== null && accuracy > MAX_ACCURACY_M) continue;

    const c = extractCoord(loc);
    const t = parseTimestamp(loc.timestampMs ?? loc.timestamp ?? loc.time);
    pushPoint(acc, c, t);

    if (c && prev) {
      const d = haversineMeters(prev, c);
      if (d >= MIN_HOP_M && d < MAX_HOP_M) pushHop(acc, d, t);
    }

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
        .sort(
          (a, b) =>
            (toNumber(b.confidence) ?? 0) - (toNumber(a.confidence) ?? 0)
        )[0];
      if (!best) continue;
      const conf = toNumber(best.confidence) ?? 0;
      if (conf > 0 && conf < 50) continue;
      const type = normalizeActivityType(
        best.type ?? best.activity ?? best.activityType
      );
      pushActivity(
        acc,
        type,
        0,
        durationMinutes / Math.max(buckets.length, 1),
        t
      );
    }

    if (c) prev = c;
    if (t) prevTime = t;
  }

  return acc;
}

function spanOf(acc: ParseAcc): { start: Date; end: Date } {
  let min = Infinity;
  let max = -Infinity;
  const consider = (t: number | null | undefined) => {
    if (t == null) return;
    if (t < min) min = t;
    if (t > max) max = t;
  };
  for (const p of acc.points) consider(p.t);
  for (const v of acc.visits) consider(v.t);
  for (const a of acc.activities) consider(a.t);
  for (const h of acc.hops) consider(h.t);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const now = new Date();
    return { start: now, end: now };
  }
  return { start: new Date(min), end: new Date(max) };
}

function toBundle(acc: ParseAcc): TimelineBundle {
  return {
    points: acc.points,
    visits: acc.visits,
    activities: acc.activities,
    hops: acc.hops,
    dateRange: spanOf(acc),
  };
}

/**
 * Aggregate a timeline bundle into dashboard stats.
 * When `range` is given, only events whose timestamp falls inside
 * [startOfDay(from), endOfDay(to)] are included. Events without a
 * timestamp stay in only when the selected range covers the full span.
 */
export function aggregateBundle(
  bundle: TimelineBundle,
  range?: { start: Date; end: Date } | null
): NormalizedData {
  const fullFrom = startOfLocalDay(bundle.dateRange.start).getTime();
  const fullTo = endOfLocalDay(bundle.dateRange.end).getTime();

  const fromMs = range ? startOfLocalDay(range.start).getTime() : fullFrom;
  const toMs = range ? endOfLocalDay(range.end).getTime() : fullTo;

  const isFullSpan = fromMs <= fullFrom && toMs >= fullTo;
  const includeUntimed = isFullSpan;

  const coordinates = bundle.points.filter((p) =>
    inRange(p.t, fromMs, toMs, includeUntimed)
  );

  const placeMap = new Map<string, number>();
  for (const v of bundle.visits) {
    if (!inRange(v.t, fromMs, toMs, includeUntimed)) continue;
    placeMap.set(v.name, (placeMap.get(v.name) ?? 0) + 1);
  }
  const topPlaces: TopPlace[] = [...placeMap.entries()]
    .map(([name, visitCount]) => ({ name, visitCount }))
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, 30);

  const actMap = new Map<
    string,
    { distanceMeters: number; durationMinutes: number }
  >();
  for (const a of bundle.activities) {
    if (!inRange(a.t, fromMs, toMs, includeUntimed)) continue;
    if (a.type === "정지") continue;
    const prev = actMap.get(a.type) ?? {
      distanceMeters: 0,
      durationMinutes: 0,
    };
    prev.distanceMeters += a.distanceMeters;
    prev.durationMinutes += a.durationMinutes;
    actMap.set(a.type, prev);
  }
  const activities: ActivityStat[] = [...actMap.entries()]
    .map(([type, v]) => ({
      type,
      distanceMeters: v.distanceMeters,
      durationMinutes: Math.round(v.durationMinutes * 10) / 10,
    }))
    .sort(
      (a, b) =>
        b.distanceMeters +
        b.durationMinutes * 50 -
        (a.distanceMeters + a.durationMinutes * 50)
    );

  let meters = 0;
  for (const h of bundle.hops) {
    if (!inRange(h.t, fromMs, toMs, includeUntimed)) continue;
    meters += h.meters;
  }

  let start = range ? startOfLocalDay(range.start) : bundle.dateRange.start;
  let end = range ? endOfLocalDay(range.end) : bundle.dateRange.end;
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const coordinate of coordinates) {
    if (coordinate.t == null) continue;
    if (coordinate.t < minTime) minTime = coordinate.t;
    if (coordinate.t > maxTime) maxTime = coordinate.t;
  }
  if (Number.isFinite(minTime) && Number.isFinite(maxTime)) {
    start = new Date(minTime);
    end = new Date(maxTime);
  }

  return {
    coordinates,
    activities,
    topPlaces,
    totalDistanceKm: Math.round((meters / 1000) * 10) / 10,
    dateRange: { start, end },
  };
}

export function parseTimelineJson(raw: unknown): TimelineBundle {
  try {
    if (!isRecord(raw)) {
      throw new Error("JSON 루트가 객체가 아닙니다.");
    }

    let acc: ParseAcc;
    if (hasSemanticSegments(raw)) {
      acc = parseSemantic(raw);
    } else if (hasTimelineObjects(raw)) {
      acc = parseTimelineObjects(raw);
    } else if (hasLegacyLocations(raw)) {
      acc = parseLegacyLocations(raw);
    } else if (
      isRecord(raw.timelineData) &&
      hasSemanticSegments(raw.timelineData as Loose)
    ) {
      acc = parseSemantic(raw.timelineData as Loose);
    } else {
      throw new Error(
        "지원하지 않는 JSON 형식입니다. Timeline.json 또는 Records.json을 확인해 주세요."
      );
    }

    if (acc.points.length === 0 && acc.visits.length === 0) {
      throw new Error(
        "위치 데이터를 찾을 수 없습니다. 파일 내용을 확인해 주세요."
      );
    }

    return toBundle(acc);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("JSON 파싱 중 알 수 없는 오류가 발생했습니다.");
  }
}

export async function parseTimelineFile(file: File): Promise<TimelineBundle> {
  const text = await file.text();
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

export function toInputDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromInputDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
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
