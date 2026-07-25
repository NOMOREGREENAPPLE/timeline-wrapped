# Timeline Wrapped

Google 타임라인에서 내보낸 JSON을 **브라우저 안에서만** 분석해 위치 통계, 히트맵,
인스타그램 스토리용 카드(9:16)를 만들어 주는 Next.js 앱입니다.

## Privacy first

업로드한 파일은 서버로 전송되지 않습니다. 파싱·통계 계산·이미지 생성이 모두
클라이언트에서 일어나며, 앱에는 API 라우트나 백엔드 저장소가 없습니다.
페이지를 새로고침하면 메모리에 있던 데이터는 사라집니다.

## 시작하기

```bash
npm install
npm run dev
```

<http://localhost:3000> 에 접속한 뒤 `Timeline.json` 또는 `Records.json`을 끌어다 놓으세요.

실제 데이터 없이 UI를 확인하려면 샘플을 생성할 수 있습니다.

```bash
npm run sample     # samples/Timeline.sample.json 생성 (300일치)
```

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (Turbopack) |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint |
| `npm run verify:parser` | 3종 JSON 포맷 파서 검증 |
| `npm run sample` | 테스트용 샘플 타임라인 생성 |

## 지원하는 JSON 포맷

파서는 루트 키를 보고 형식을 자동으로 판별합니다.

| 형식 | 판별 키 | 비고 |
| --- | --- | --- |
| 온디바이스 백업 | `semanticSegments`, `timelinePath` | `"37.566535°, 126.977969°"` 문자열 좌표 |
| 구형 Takeout | `timelineObjects` | `placeVisit`, `activitySegment` |
| 레거시 Records | `locations` | `latitudeE7` / `longitudeE7` 정수 좌표 |

`*E7` 필드는 항상 `1e7`로 나눠 정규화하므로 적도 근처의 작은 값도 소수 좌표로
오인되지 않습니다. 레거시 포맷은 정확도 500m 초과 지점을 버리고, 15m 미만 지터는
거리에 더하지 않으며, 단일 구간 이동을 50km로 제한해 GPS 노이즈가 총 거리를
부풀리지 않게 합니다.

모든 형식은 아래 형태로 정규화됩니다.

```ts
interface NormalizedData {
  coordinates: { lat: number; lng: number }[];
  activities: { type: string; distanceMeters: number; durationMinutes: number }[];
  topPlaces: { name: string; visitCount: number }[];
  totalDistanceKm: number;
  dateRange: { start: Date; end: Date };
}
```

## 구조

```
src/
├── app/
│   ├── layout.tsx        # 폰트, 메타데이터
│   ├── page.tsx          # 업로드 → 대시보드 상태 전환
│   └── globals.css       # 다크 테마 + 스토리 카드 스타일
├── components/
│   ├── FileUploader.tsx  # 드래그앤드롭, 파싱 진행 표시
│   ├── QuickStats.tsx    # 총 거리, Top 3 장소, 이동 수단 비율
│   ├── HeatmapView.tsx   # Leaflet 히트맵 (SSR 비활성)
│   └── StoryCards.tsx    # 1080×1920 카드 3종 + PNG 저장
├── lib/parser.ts         # 포맷 판별 및 정규화
└── types/                # leaflet.heat 타입 선언
```

## 구현 노트

- **지도 SSR** — `leaflet`은 `window`에 의존하므로 `HeatmapView`를
  `dynamic(..., { ssr: false })`로 불러옵니다.
- **히트맵 성능** — 좌표가 5만 개를 넘으면 약 0.01°(≈1km) 격자로 묶어 방문 밀도를
  가중치로 환산하고, 밀도가 높은 상위 4만 개 셀만 렌더링합니다.
- **PNG 내보내기** — 카드는 1080×1920 원본으로 레이아웃한 뒤 CSS `transform`으로
  축소해 미리 보여 줍니다. `html-to-image`로 저장할 때는 스케일을 1로 되돌려
  정확히 1080×1920 PNG가 나옵니다.
- **대용량 파일** — `JSON.parse` 전후로 이벤트 루프를 양보해 로딩 UI가 그려지도록
  하고, 각 포맷을 단일 패스로 순회합니다.
