# Add Route — Design & Implementation Plan

Design document for the first user story of RoadSight (see [specification.md](../specification.md)):

> **Add route**
> - user provides route description in general language, e.g. 'Lougheed Mall to Squamish waterfall'
> - user checks the origin/destination of the route are properly resolved, confirms the route

## 1. Overview

The user types a natural-language route description. The app creates a route record, resolves the description into a formal origin and destination with coordinates, shows them to the user for review, and — once the user confirms — fetches the recommended route polyline and persists it.

The work is split into three phases:

| Phase | Content | External dependencies |
|---|---|---|
| **1** | Full end-to-end flow with **mock** resolver and planner, Postgres persistence, extended data model, new API endpoints, multi-step UI | A Postgres: Docker locally **or** the existing Azure flexible server (see §8) — neither blocks starting, thanks to the in-memory fallback |
| **2** | Real NL parsing via **Azure Foundry** — description → origin/destination *labels* | Azure Foundry deployment |
| **3a** | Real geocoding via **Azure Maps** — labels → coordinates, folded into the resolve step | Azure Maps account |
| **3b** | Real route planning via **Azure Maps** — coordinates → polyline, one-line swap | Azure Maps account |

Phase 1 delivers the complete user story behaviour (with plausible mock data), so UI, API, and persistence are finished and demoable before any Azure account exists. Phases 2 and 3 change no UI, API, or DB code — that is the point of the service interfaces introduced here.

Phase 2 turned out to deliver only *half* of resolution: an LLM can name a place but cannot produce trustworthy coordinates, so the Foundry step emits labels and Phase 3a geocodes them. See §5.1 for why that split exists and §5.2 for why geocoding belongs in the resolve step rather than the confirm step.

## 2. Architecture

The codebase already uses an **interface + swap-point singleton** pattern: [`web/lib/routes/repository.ts`](../web/lib/routes/repository.ts) exports a `routeRepository` singleton (stashed on `globalThis` to survive Fast Refresh) with a comment marking where the in-memory implementation will later be replaced. The same pattern is used in [`web/auth.ts`](../web/auth.ts) for the future Microsoft Entra External ID swap.

This design adds two more swap points of exactly the same shape — a route resolver (NL description → origin/destination) and a route planner (coordinates → polyline) — and upgrades the repository swap point to be gated by `DATABASE_URL`. Phase 3a adds a third, a geocoder (place label → coordinates), which composes *behind* the resolver swap point rather than beside it.

```mermaid
flowchart LR
    B[Browser<br/>add-route wizard]

    subgraph next ["Next.js app (web/)"]
        P["Pages<br/>app/routes/"]
        A["API handlers<br/>app/api/routes/"]
    end

    subgraph sp ["Swap-point singletons (lib/)"]
        R["routeRepository<br/>lib/routes/repository.ts"]
        RES["routeResolver<br/>lib/route-resolution/resolver.ts"]
        PL["routePlanner<br/>lib/routing/planner.ts"]
    end

    IM["InMemoryRouteRepository<br/>(no DATABASE_URL)"]
    PG["PostgresRouteRepository"]
    DB[("PostgreSQL 17<br/>Docker")]
    MR["MockRouteResolver<br/>(Phase 1)"]
    GR["GeocodingRouteResolver<br/>(Phase 3a)"]
    AF["AzureFoundryDescriptionParser<br/>(Phase 2) — labels only"]
    GC["AzureMapsGeocoder<br/>(Phase 3a) — label → lat/lng"]
    MP["MockRoutePlanner<br/>(Phase 1)"]
    AM["AzureMapsRoutePlanner<br/>(Phase 3b)"]
    AUTH["NextAuth Credentials<br/>→ Entra External ID (later)"]

    B --> P
    B --> A
    P --> R
    A --> R
    A --> RES
    A --> PL
    A -.-> AUTH
    R --> IM
    R --> PG
    PG --> DB
    RES --> MR
    RES --> GR
    GR --> AF
    GR --> GC
    PL --> MP
    PL --> AM

    classDef future stroke-dasharray: 5 5,opacity:0.7
    class AUTH future
```

*Dashed boxes are still future swaps. Each singleton picks its implementation in one file — no other file changes when a swap happens. `GeocodingRouteResolver` is a composite: it satisfies the `RouteResolver` contract by chaining a parser and a geocoder, so the swap point above it is unaware that resolution became two calls.*

## 3. Route lifecycle

A route moves through three states. Derived data (origin, destination, polyline, distance, duration) only ever flows *forward* from the description; editing the description invalidates everything derived from it.

```mermaid
stateDiagram-v2
    [*] --> draft : POST /api/routes (description saved)
    draft --> resolved : resolve OK (origin/destination set)
    draft --> draft : resolve fails (422) or description edited
    resolved --> resolved : re-resolve (reworded) or confirm fails (502, retry)
    resolved --> confirmed : confirm OK (polyline saved)
    resolved --> draft : description edited (derived data cleared)
    confirmed --> draft : description edited (derived data cleared)
    draft --> [*] : DELETE
    resolved --> [*] : DELETE
    confirmed --> [*] : DELETE
```

- **draft** — description saved, nothing resolved yet. Matches the spec's "creates new record for the route in DB and saves the description".
- **resolved** — origin and destination with coordinates set; awaiting user confirmation.
- **confirmed** — user accepted the endpoints; recommended polyline, distance, and duration persisted.

## 4. Data model

### TypeScript types (`web/lib/routes/types.ts`)

```ts
export type RouteStatus = "draft" | "resolved" | "confirmed";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ResolvedPlace extends GeoPoint {
  /** Formal resolved name, e.g. "Lougheed Town Centre, Burnaby, BC" */
  label: string;
}

/** GeoJSON LineString; coordinates are [lng, lat] pairs (GeoJSON order). */
export interface RoutePolyline {
  type: "LineString";
  coordinates: [number, number][];
}

export interface Route {
  id: string;
  userId: string;
  name: string; // auto-derived from description at creation; user-renameable
  description: string; // natural-language text as typed by the user
  status: RouteStatus;
  origin: ResolvedPlace | null; // null while draft
  destination: ResolvedPlace | null;
  polyline: RoutePolyline | null; // null until confirmed
  distanceMeters: number | null;
  durationSeconds: number | null;
  createdAt: string; // ISO strings (JSON-safe)
  updatedAt: string;
}
```

`name` is auto-derived at creation (description truncated to 100 chars) so the existing list/rename/delete UI keeps working unchanged. It never re-derives after that — once created it is user-owned (intended behaviour, see §10).

### Polyline persistence — decision

The spec flags "persisting route polyline should be confirmed" as an open question. **Decision: persist the polyline, as a GeoJSON LineString in a JSONB column, saved at confirm time.**

| Option | Verdict |
|---|---|
| Encoded polyline string (Google format) | Compact, but needs an encode/decode dependency; Azure Maps natively returns coordinate arrays — pointless transcoding for a POC |
| **GeoJSON LineString in JSONB** ✅ | Native Azure Maps output shape, renders directly in any map library, human-inspectable in psql, zero extra dependencies |
| PostGIS `geometry(LineString)` | Requires the postgis image + extension; there are no spatial queries yet. Documented migration path (`postgis/postgis` image) if spatial features arrive |

The polyline is a re-fetchable cache — it can always be recomputed from origin/destination — so storing it is low-risk, and it saves an Azure Maps call on every future map render.

### Postgres schema (`db/init/001_routes.sql`)

```sql
CREATE TABLE routes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL, -- no FK: users are in-memory until the Entra ID phase
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'resolved', 'confirmed')),
  origin_label      text,
  origin_lat        double precision,
  origin_lng        double precision,
  destination_label text,
  destination_lat   double precision,
  destination_lng   double precision,
  polyline          jsonb, -- GeoJSON LineString
  distance_meters   double precision,
  duration_seconds  double precision,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX routes_user_id_idx ON routes (user_id);
```

Origin/destination are flat columns (not JSONB): queryable, obvious, and consistent with the hand-rolled style. A row↔`Route` mapper in the repository handles snake_case→camelCase and folds `origin_label/lat/lng` into `ResolvedPlace | null` (null when `origin_label IS NULL`).

### Repository interface (`web/lib/routes/route-repository.ts`)

The current `update(userId, id, name)` is too narrow for status transitions. Widen to a patch-based interface:

```ts
export type NewRoute = { name: string; description: string };
export type RoutePatch = Partial<Omit<Route, "id" | "userId" | "createdAt" | "updatedAt">>;

export interface RouteRepository {
  list(userId: string): Promise<Route[]>;
  get(userId: string, id: string): Promise<Route | null>; // NEW — resolve/confirm handlers need it
  create(userId: string, input: NewRoute): Promise<Route>;
  update(userId: string, id: string, patch: RoutePatch): Promise<Route | null>;
  remove(userId: string, id: string): Promise<boolean>;
}
```

All methods stay `userId`-scoped (ownership enforced at the repository level, as today). The Postgres `update` uses **read-modify-write**: SELECT the row, merge the patch, UPDATE all columns, bump `updated_at`. This avoids dynamic SET-clause string building; fine at POC scale (no optimistic locking — see §10).

## 5. Service interfaces

New modules mirroring the `lib/routes/` layout exactly: interface file + implementations + `globalThis`-stashed singleton with a swap comment.

### 5.1 Route resolution — `web/lib/route-resolution/`

```ts
// route-resolver.ts
import type { ResolvedPlace } from "@/lib/routes/types";

export interface ResolvedEndpoints {
  origin: ResolvedPlace;
  destination: ResolvedPlace;
}

export interface RouteResolver {
  /** Returns null when the description cannot be resolved into two places. */
  resolve(description: string): Promise<ResolvedEndpoints | null>;
}
```

Returning `null` for "cannot resolve" (rather than throwing) matches the repository's existing convention (`update` → null, `remove` → false). Throws are reserved for infrastructure failures (Azure outage → HTTP 502 in Phase 2).

**`mock-route-resolver.ts` — `MockRouteResolver`:**
- A dictionary of ~10 real BC places with real coordinates, chosen so the spec's example works verbatim: Lougheed Mall / Lougheed Town Centre (49.2486, −122.8969), Squamish waterfall → Shannon Falls (49.6702, −123.1567), Metrotown, UBC, Stanley Park, Whistler Village, Horseshoe Bay, Grouse Mountain, Downtown Vancouver, SFU Burnaby. Each entry has a formal label plus aliases.
- Parsing: lowercase the description, strip a leading `"from "`, split on `" to "` / `"→"`; match each half against dictionary keys and aliases by case-insensitive substring containment.
- If either side matches nothing → return `null`. No fake fallback coordinates — honest failures exercise the error UI.
- Artificial 300–800 ms delay so the "Resolving…" state is visible in demos.

#### Parsing and geocoding are separate jobs

Phase 2 revealed that `RouteResolver` bundles two unrelated capabilities. An LLM is good at *"Lougheed Mall to Squamish waterfall"* → `("Lougheed Town Centre", "Shannon Falls Provincial Park")` and bad at coordinates — asking it for lat/lng invites plausible-looking hallucinations that no downstream check would catch. So the Foundry implementation targets a narrower interface:

```ts
// route-description-parser.ts
export interface EndpointLabels {
  origin: string;
  destination: string;
}

export interface RouteDescriptionParser {
  /** Returns null when the description cannot be split into two places. */
  parse(description: string): Promise<EndpointLabels | null>;
}
```

`AzureFoundryDescriptionParser` implements this (strict `json_schema` response format, Zod-validated, `null` on `confidence: "low"`), and `GeocodingRouteResolver` composes a parser with a geocoder to satisfy the unchanged `RouteResolver` contract:

```ts
export class GeocodingRouteResolver implements RouteResolver {
  constructor(parser: RouteDescriptionParser, geocoder: Geocoder) {}
  // parse → geocode both labels in parallel → null if either side fails
}
```

`MockRouteResolver` stays a direct `RouteResolver` — its dictionary already holds real coordinates, so it needs no geocoding and keeps offline development working.

**`resolver.ts`** — singleton over the same `repository.ts` pattern, now composing rather than picking:

```ts
// Both keys are required for the real path: a parser without a geocoder can only
// produce labels, and the review step is worthless without coordinates.
const impl = foundryKey && mapsKey
  ? new GeocodingRouteResolver(new AzureFoundryDescriptionParser(...), new AzureMapsGeocoder(mapsKey))
  : new MockRouteResolver();
```

### 5.2 Geocoding — `web/lib/geocoding/`

```ts
// geocoder.ts
import type { ResolvedPlace } from "@/lib/routes/types";

export interface Geocoder {
  /** Returns null when the query matches no place confidently enough to route to. */
  geocode(query: string): Promise<ResolvedPlace | null>;
}
```

#### Decision: geocode during **resolve**, not during **confirm**

Azure Maps offers no "route from an address string" endpoint — [Post Route Directions](https://learn.microsoft.com/en-us/rest/api/maps/route/post-route-directions?view=rest-maps-2025-01-01) accepts a GeoJSON `FeatureCollection` of `Point` features and nothing else. Coordinates must therefore be obtained somewhere; the only question is when.

| Option | Verdict |
|---|---|
| **Geocode inside resolve** ✅ | The review step shows the coordinates that will actually be routed. A place Azure Maps cannot find fails as **422 at resolve**, where the UI already offers "reword your description". Fills `origin_lat/lng` for the eventual map render. `RoutePlanner.plan(GeoPoint, GeoPoint)` is unchanged. |
| Geocode inside confirm (planner) | The review card would show `0.0000, 0.0000` — the user confirms endpoints nobody verified. An unfindable place surfaces as a **502 at confirm**, which the §3 state machine treats as a retryable outage rather than a description problem, so the user is offered "Retry" for something retrying cannot fix. |

The second row is not hypothetical: it is what the code does today, because Phase 2's placeholder returns `lat: 0, lng: 0`.

#### `AzureMapsGeocoder` — call shape

`GET https://atlas.microsoft.com/geocode?api-version=2026-01-01`, following [Best practices for Azure Maps Search](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-use-best-practices-for-search):

- **Freeform `query=`, not the structured parameters.** The parser emits a place name, not parsed address components. Search v1's `Get Search Fuzzy` — the old way to match landmarks — is [superseded by `Get Geocoding`](https://learn.microsoft.com/en-us/azure/azure-maps/migrate-search-v1-api), whose own reference example is `query=empire state building`. One endpoint covers addresses, localities, and landmarks; no fuzzy fallback tier is needed.
- **Geobias with `coordinates` only — no `bbox`, no `countryRegion`.** `countryRegion`, `locality`, `addressLine`, `postalCode` and friends [must not be combined with `query`](https://learn.microsoft.com/en-us/rest/api/maps/search/get-geocoding?view=rest-maps-2026-01-01), and a country filter would break the WA extension regardless. A BC+WA bounding box looked like the natural substitute, but **measurement against the live service showed it makes landmark queries worse**: `Simon Fraser University` returns the correct `HigherEducationFacility` at `High` confidence with `coordinates` alone, and collapses to `Low`-confidence noise (`Fraser, CO`, `Fraser, AB`) the moment a `bbox` is added. Out-of-area candidates are filtered by the confidence gate instead — `Stanley Park, United Kingdom` comes back `Low` and is dropped.

  `coordinates=-123.1,49.3` is downtown Vancouver, **not** a centroid of the service area, because the API defines the parameter as *the user's location* for ranking rather than as a search region. A/B'd against no bias and against the centroid of the rejected bbox (`-126.3,52.3`):

  | query | no bias | centroid | Vancouver |
  |---|---|---|---|
  | `Richmond` | Richmond, **VA** | Richmond, **VA** | Richmond, BC ✅ |
  | `Surrey` | Surrey, **UK** | Surrey, **UK** | Surrey, BC ✅ |
  | `Fraser Lake` | BC (High) | BC (High) | BC (Medium) |

  So the bias is load-bearing for *unqualified* names — unbiased, the app routes to Virginia — and a region centroid is no better than sending nothing, because it is 340 km from anywhere a user is. The cost is a confidence erosion for far-northern BC (same coordinates returned, one step lower, still above the `Low` gate).

  **Do not "fix" that by biasing the destination lookup with the resolved origin.** It is not circular (the origin lookup would still use the constant, and only the destination would use the returned coordinates, serialized), but measured, it trades one failure for a worse one: with a Prince George origin, `Richmond` → Richmond, **VA** and `Surrey` → **UK**, both at `High` — straight through the gate. A confident match against a bad bias point is more dangerous than a hesitant match against a good one.

  **The real lever is upstream.** Any label carrying its province resolves at `High` to identical coordinates under *every* bias point tested, including none:

  | query | no bias | Vancouver | Prince George |
  |---|---|---|---|
  | `Richmond, BC` | BC (High) | BC (High) | BC (High) |
  | `Mackenzie, BC` | BC (High) | BC (High) | BC (High) |
  | `Fraser Lake, BC` | BC (High) | BC (High) | BC (High) |

  (Unqualified, `Mackenzie` under the Vancouver bias returns a university in **Brazil**.) The parser already tends to qualify — `"Horseshoe Bay, West Vancouver, British Columbia, Canada"` — so making that a guaranteed contract rather than a tendency is worth more than any tuning of the constant. See §10 item 10.
- **Prefer the `Route` geocode point.** Each feature carries `geocodePoints[]` tagged with `usageTypes`; `"Route"` is a vehicle-accessible entrance, `"Display"` is the visual centre of the park or building. Fall back to `feature.geometry.coordinates`. In practice BC landmarks come back with a `Display` point only and the fallback carries them; street addresses are where the distinction actually appears, so the preference costs nothing and is correct when it fires. All Azure Maps coordinates are `[lon, lat]` — with an optional third altitude element, so a strict 2-tuple schema is wrong — and must be flipped into `GeoPoint`.
- **Overwrite the label with `properties.address.formattedAddress`.** This is the honesty rule: when the service rolls up, the review card must say *"Squamish, BC"*, not the parser's optimistic *"Shannon Falls Provincial Park"*. Live behaviour makes the case: `"Squamish waterfall"` really does resolve to `Squamish, BC` (`PopulatedPlace`), and `"Lougheed Town Centre"` to the neighbouring `Lougheed Plaza`. Both are things the user can see and correct; neither would be visible if the query text were echoed back.
- **Quality gate → `null` → 422.** Reject an empty `features` array (Get Geocoding "prioritizes correctness and may return no results" — a 200 with no match is the normal no-match signal, not an error) and `confidence: "Low"`. `top=1`.
  - Gate on `confidence` **only**. `matchCodes` is documented as a quality signal but is absent from every landmark and place response observed — only plain street addresses carried it (`["Good"]`), so a rule keyed on `UpHierarchy` would be dead code. `type` is likewise unusable as a filter: the live service returns values well outside the documented enum (`ShoppingCenter`, `Park`, `Mountain`, `HigherEducationFacility`, `TouristStructure`), so an allowlist would reject good matches.
  - Rejecting `Low` is recoverable, which is what makes it the right strictness: `"Metropolis at Metrotown"` is rejected, `"Metrotown"` resolves — exactly the reword loop the 422 path offers.
- Two geocodes per resolve, issued with `Promise.all`. `geocode:batch` exists but bills per item and buys nothing at n=2.

### 5.3 Route planning — `web/lib/routing/`

```ts
// route-planner.ts
import type { GeoPoint, RoutePolyline } from "@/lib/routes/types";

export interface RoutePlan {
  polyline: RoutePolyline; // the "most recommended" route only (per spec)
  distanceMeters: number;
  durationSeconds: number;
}

export interface RoutePlanner {
  plan(origin: GeoPoint, destination: GeoPoint): Promise<RoutePlan | null>;
}
```

A single recommended plan, not alternatives — that is what the spec asks to persist. A `planAlternatives()` method is a possible later extension.

**`mock-route-planner.ts` — `MockRoutePlanner`:**
- LineString of 4–6 points interpolated between origin and destination, with a small perpendicular offset at the midpoints (so it does not look like a ruler line on a map).
- `distanceMeters` = haversine distance × 1.25 road factor; `durationSeconds` = distance at 60 km/h; ~300 ms delay.

**`planner.ts`** — same singleton pattern with `// Later: swap to \`new AzureMapsRoutePlanner(...)\`` comment.

#### `AzureMapsRoutePlanner` — call shape (Phase 3b)

`POST https://atlas.microsoft.com/route/directions?api-version=2025-01-01`, body `application/geo+json`. The `GET /route/directions` of v1.0 is gone; the POST form is the supported replacement.

```jsonc
{ "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [oLng, oLat] },
      "properties": { "pointIndex": 0, "pointType": "waypoint" } },
    { "type": "Feature", "geometry": { "type": "Point", "coordinates": [dLng, dLat] },
      "properties": { "pointIndex": 1, "pointType": "waypoint" } }
  ],
  "travelMode": "driving", "optimizeRoute": "fastestWithTraffic",
  "routeOutputOptions": ["routePath"], "maxRouteCount": 1 }
```

`routeOutputOptions: ["routePath"]` matters — the default is `itinerary`, which returns turn-by-turn guidance this story never displays.

Response mapping: take the feature whose `properties.type === "RoutePath"`; `distanceInMeters` and `durationInSeconds` sit on that same `properties`. **Its geometry is a `MultiLineString`, not a `LineString`** — the segments are contiguous, so concatenate them (dropping duplicated joint points) into the single `RoutePolyline` LineString of §4. Flattening keeps the persisted JSONB shape and the §4 decision intact; widening `RoutePolyline` to a MultiLineString would ripple into the DB and the future map renderer for no gain at one leg.

## 6. API design

Separate endpoints per step, rather than resolving inside `POST /api/routes`. Rationale: the story requires an explicit human review between resolution and confirmation, and per-step endpoints give each failure its own retry without re-creating the record. It also matches the spec's wording — "creates new record… saves the description" *then* "sends the general description to Azure Foundry".

All handlers follow the existing conventions in [`web/app/api/routes/[id]/route.ts`](../web/app/api/routes/%5Bid%5D/route.ts): `await auth()` → 401 without session; Zod `safeParse` → 400 with `parsed.error.flatten()`; `params` is `Promise`-typed (Next 16); responses return the full `Route` JSON.

| Endpoint | Body | Success | Errors |
|---|---|---|---|
| `POST /api/routes` *(extended)* | `{ description }` — Zod: trim, 1–200 chars | 201, Route `status:"draft"`, name auto-derived | 400, 401 |
| `POST /api/routes/[id]/resolve` *(new)* | none | 200, origin/destination set, `status:"resolved"` | 401; 404 not found / not owner; 409 already `confirmed`; **422** resolver returned null — route stays `draft` |
| `POST /api/routes/[id]/confirm` *(new)* | none | 200, polyline/distance/duration set, `status:"confirmed"` | 401; 404; **409** status ≠ `resolved`; **502** planner failed — stays `resolved`, retryable |
| `PATCH /api/routes/[id]` *(extended)* | `{ name?, description? }` — at least one | 200 | 400, 401, 404 |
| `GET /api/routes` | — | 200, Route[] | 401 |
| `DELETE /api/routes/[id]` | — | 204 | 401, 404 |

Behavioural rules:
- **Editing `description` resets the route**: status → `draft`, origin/destination/polyline/distance/duration → null. Derived data must not survive a description change.
- **`resolve` is idempotent** from `draft` or `resolved` (re-running overwrites the endpoints) — supports "that's not what I meant, let me reword and retry".

New handler files: `web/app/api/routes/[id]/resolve/route.ts` and `web/app/api/routes/[id]/confirm/route.ts`.

```mermaid
sequenceDiagram
    actor U as User
    participant W as Wizard (client)
    participant API as API handlers
    participant RES as routeResolver
    participant PL as routePlanner
    participant DB as routeRepository / DB

    U->>W: types "Lougheed Mall to Squamish waterfall"
    W->>API: POST /api/routes { description }
    API->>DB: create draft (description, auto name)
    API-->>W: 201 Route (draft)
    W->>API: POST /api/routes/:id/resolve
    API->>RES: resolve(description)
    alt resolved
        RES-->>API: { origin, destination }
        API->>DB: update (origin, destination, status=resolved)
        API-->>W: 200 Route (resolved)
        W-->>U: show origin / destination for review
        U->>W: Confirm route
        W->>API: POST /api/routes/:id/confirm
        API->>PL: plan(origin, destination)
        alt plan OK
            PL-->>API: { polyline, distance, duration }
            API->>DB: update (polyline, status=confirmed)
            API-->>W: 200 Route (confirmed)
            W-->>U: done — route saved
        else planner failed
            PL-->>API: error
            API-->>W: 502 (route stays resolved)
            W-->>U: "Route service unavailable" + Retry
        end
    else cannot resolve
        RES-->>API: null
        API-->>W: 422 (route stays draft)
        W-->>U: "Couldn't identify origin/destination — reword?"
    end
```

## 7. UI flow

The current [`route-form.tsx`](../web/components/route-form.tsx) single-shot `onSubmit(name)` contract cannot express the multi-step flow, so:

- **`route-form.tsx`** stays as-is for the rename-in-place edit path (label becomes "Route name"); it is no longer used for creation.
- **New `web/components/add-route-wizard.tsx`** (client) owns the flow with a discriminated-union state machine:

| Step | UI | Transition |
|---|---|---|
| `describe` | Textarea with placeholder *"e.g. 'Lougheed Mall to Squamish waterfall'"* | Submit → `POST /api/routes`, then immediately `POST …/resolve` (two calls, one user action — the draft exists even if resolve fails, matching the spec's "create record first") |
| `resolving` | Spinner "Resolving…" | 200 → `review`; 422 → `error` |
| `review` | Origin/destination cards (label + coordinates, 4 decimals). Buttons: **Confirm route**, **Edit description** (back to `describe` prefilled; on submit `PATCH` description then re-resolve), **Discard** (`DELETE`) | Confirm → `confirming` |
| `confirming` | Spinner "Fetching route…" | 200 → `done`; 502 → `error` |
| `done` | Brief success; calls `onCreated(route)` up to the list; resets to `describe` | — |
| `error` | 422 → "Couldn't identify origin and destination — try rewording" (draft kept; Edit/Discard offered). 502 → "Route service unavailable" + Retry (stays resolved). Network errors → generic retry | — |

```mermaid
flowchart TD
    D[describe<br/>textarea] -->|"POST + resolve"| RV[resolving]
    RV -->|200 resolved| R["review<br/>origin / destination cards"]
    RV -->|422 unresolvable| E4["error: reword suggestion<br/>(draft kept)"]
    E4 -->|Edit description| D
    E4 -->|Discard| X[deleted]
    R -->|Confirm| C[confirming]
    R -->|Edit description| D
    R -->|Discard| X
    C -->|200 confirmed| OK[done — route in list]
    C -->|502 planner failed| E5["error: service unavailable<br/>(stays resolved)"]
    E5 -->|Retry| C
```

- **`route-list.tsx`**: the creation slot renders `<AddRouteWizard onCreated={…}>` instead of `RouteForm`. List rows gain a status badge (`draft` / `resolved` / `confirmed`) and show `origin → destination` labels when present, plus distance/duration text on confirmed rows. Because drafts are persisted server-side, a draft abandoned mid-wizard (e.g. page reload) appears in the list with a **Resume** affordance that re-enters the wizard at the right step. Rename/delete unchanged.
- **Out of scope for this story**: rendering the polyline on an actual map — follow-up story. Confirmed rows show distance/duration as text only.

## 8. Postgres + Docker

- **`docker-compose.yml`** (repo root):

```yaml
services:
  db:
    image: postgres:17-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: roadsight
      POSTGRES_PASSWORD: roadsight
      POSTGRES_DB: roadsight
    volumes:
      - roadsight-pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U roadsight"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  roadsight-pgdata:
```

- **Migrations**: plain SQL scripts in `db/init/` run automatically on first container start; reset with `docker compose down -v`. A migration tool (node-pg-migrate / drizzle-kit) is deliberately deferred — one table, POC stage. Trigger point: adopt a tool at the second schema change (§10).
- **Client**: **`pg` (node-postgres)** — the boring standard. No ORM: it would drag in its own schema tooling and fight the init-script approach, and the repo's style is hand-rolled. (`postgres.js` is an acceptable alternative; rejected only for being less universally documented.)
- **`web/lib/db.ts`**: `Pool` singleton stashed on `globalThis` (same Fast Refresh rationale as `repository.ts`), reads `DATABASE_URL`.
- **`web/lib/routes/postgres-route-repository.ts`**: implements the widened `RouteRepository`; parameterized queries only; row mapper per §4; `update` via read-modify-write.
- **Swap point** ([`web/lib/routes/repository.ts`](../web/lib/routes/repository.ts)) becomes env-gated:

```ts
const impl = process.env.DATABASE_URL
  ? new PostgresRouteRepository(pool)
  : new InMemoryRouteRepository();
```

This is the one deliberate deviation from the pure comment-swap: it lets `npm run dev` work without Docker running. The existing swap comment is updated rather than adding a second mechanism.

- **Env** (`web/.env.local.example`): add `DATABASE_URL=postgres://roadsight:roadsight@localhost:5432/roadsight`.

### Alternative: Azure Database for PostgreSQL (no Docker)

Docker is a local convenience, not a code dependency — `PostgresRouteRepository` works against any Postgres reachable via `DATABASE_URL`, and with no `DATABASE_URL` set the app falls back to the in-memory repository. Since an **Azure Database for PostgreSQL flexible server is already provisioned** for this project, Phase 1 can start before WSL/Docker is installed:

- Create a **separate dev database** on the flexible server (e.g. `roadsight_dev`) rather than developing against the future production database.
- Run `db/init/001_routes.sql` **manually** (via `psql`, the Azure portal query editor, or Azure Data Studio) — there is no `docker-entrypoint-initdb.d` outside Docker.
- Add a **firewall rule** on the flexible server for the local development IP.
- Azure enforces TLS: the connection string needs `sslmode=require`, and the `pg` Pool may need `ssl: true`:

  ```
  DATABASE_URL=postgres://<user>:<password>@<server>.postgres.database.azure.com:5432/roadsight_dev?sslmode=require
  ```

Suggested development sequence: build Phase 1 against the in-memory fallback (no `DATABASE_URL`), then point `DATABASE_URL` at the Azure dev database to validate `PostgresRouteRepository` against a real server. The docker-compose path remains documented above for offline/free/resettable local development (`docker compose down -v`) and can be adopted later — WSL/Docker installation is a non-blocking side task, not a Phase 1 prerequisite.

- **Known impedance mismatch**: users live in memory with `randomUUID()` ids ([`web/lib/users/user-store.ts`](../web/lib/users/user-store.ts)), so a server restart + re-register yields a new `userId` and orphans persisted routes. Phase 1 mitigation (one line): derive the dev user id deterministically from the normalized email (e.g. use the email itself as id). The user store is already marked disposable pending Entra ID, so this is safe.

## 9. Phasing & implementation checklist

> Per [`web/AGENTS.md`](../web/AGENTS.md): this Next.js version has breaking changes vs prior knowledge — consult `web/node_modules/next/dist/docs/` before touching route handlers or pages. Note the existing quirks: middleware lives in `web/proxy.ts`, and handler `params` are `Promise`-typed.

### Phase 1 — mocks + Postgres + full UI flow

- [ ] Extend `Route` and add `GeoPoint` / `ResolvedPlace` / `RoutePolyline` / `RouteStatus` in `web/lib/routes/types.ts`
- [ ] Widen `RouteRepository` (`get`, `NewRoute`, `RoutePatch`) in `web/lib/routes/route-repository.ts`
- [ ] Update `InMemoryRouteRepository` to the new interface
- [ ] Add `db/init/001_routes.sql`
- [ ] Add `docker-compose.yml` *(deferrable — not needed when using the Azure flexible server, see §8; requires WSL/Docker install)*
- [ ] Add `pg` dependency; create `web/lib/db.ts` (Pool singleton)
- [ ] Implement `web/lib/routes/postgres-route-repository.ts`; env-gate the swap in `repository.ts`
- [ ] Create `web/lib/route-resolution/` (interface, `MockRouteResolver`, singleton)
- [ ] Create `web/lib/routing/` (interface, `MockRoutePlanner`, singleton)
- [ ] Extend `POST /api/routes` (description body) and `PATCH /api/routes/[id]` (description + reset rule)
- [ ] Add `resolve` and `confirm` handlers under `web/app/api/routes/[id]/`
- [ ] Build `web/components/add-route-wizard.tsx`; wire into `route-list.tsx` (status badges, endpoints display, Resume for drafts)
- [ ] Deterministic dev user id in `web/lib/users/user-store.ts`
- [ ] Add `DATABASE_URL` to `web/.env.local.example`
- [ ] Drive-by: rename `web/package.json` `"name"` from `"frontend"` to `"web"`

### Phase 2 — real Azure Foundry parsing ✅

- [x] `AzureFoundryDescriptionParser implements RouteDescriptionParser`: strict `json_schema` response format returning `{ origin, destination, confidence }`, Zod-validated; `null` on low confidence / malformed output
- [x] Env: `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`, `AZURE_FOUNDRY_DEPLOYMENT`
- [x] Swap in `web/lib/route-resolution/resolver.ts`

No UI, API, or DB changes. *(Originally scoped as returning coordinates too; narrowed to labels in Phase 3a — see §5.1.)*

### Phase 3a — real Azure Maps geocoding ✅

- [x] Add `web/lib/geocoding/geocoder.ts` (`Geocoder` interface) and `azure-maps-geocoder.ts` (§5.2 call shape: freeform `query`, `coordinates` bias, `Route` geocode point, `formattedAddress` label, Low-confidence/empty → `null`)
- [x] Narrow the Foundry implementation to `RouteDescriptionParser`; drop the `lat: 0, lng: 0` placeholder
- [x] Add `web/lib/route-resolution/geocoding-route-resolver.ts`
- [x] Compose in `resolver.ts`, gated on `AZURE_FOUNDRY_API_KEY` **and** `AZURE_MAPS_KEY`
- [x] Env: `AZURE_MAPS_KEY`
- [x] Wrap `routeResolver.resolve()` in the resolve handler with try/catch → **502**, mirroring the confirm handler. Without it an Azure outage returns 500, which §6 never specified and the wizard does not handle
- [x] Give the wizard a distinct 502 message on the resolve path (an outage is not a rewording problem) — the one small UI change this phase needed

No API or DB changes.

### Phase 3b — real Azure Maps planner

- [x] `AzureMapsRoutePlanner implements RoutePlanner`: Post Route Directions (§5.3); flatten the `RoutePath` MultiLineString into the GeoJSON LineString
- [x] One-line swap in `web/lib/routing/planner.ts` (reuses `AZURE_MAPS_KEY`)

No UI, API, or DB changes.

### Cross-cutting (out of this story's scope)

- Entra External ID swap (replaces the user store; requires a `users` table or stable subject ids — `routes.user_id` then gains an FK)
- Map rendering of polylines
- Automated tests
- Migration tooling

## 10. Open questions & risks

1. **Polyline persistence** — *resolved by this document*: persist GeoJSON JSONB at confirm time (§4). Revisit toward PostGIS only if spatial queries appear. This closes the question flagged in specification.md.
2. **Sync vs async resolution** — Phase 1 mocks are fast; real Foundry calls may take seconds. Decision: keep synchronous request/response (single-user POC). If latency exceeds ~10 s or serverless function timeouts bite, move to fire-and-poll with an added `resolving` status.
3. **Azure cost/quota** — every resolve is an LLM call, every confirm a Maps call. Mocks keep development free; rate limiting is absent and acceptable at POC scale.
4. **Ambiguity handling** — "Squamish waterfall" could match multiple places; the current design returns a single candidate pair. A multi-candidate `RouteResolver` v2 (returning a candidates array for a pick-list) is flagged now so Phase 2 can decide. Phase 3a keeps the single-pair shape and leans on the honest-label rule (§5.2) to make a wrong pick visible in review.
5. **User identity durability** — routes persist, users don't (until Entra ID). Mitigated by deterministic dev user ids; fully fixed in the Entra phase.
6. **Concurrency** — read-modify-write updates have no optimistic locking. Acceptable single-user; an `updated_at`-based check is the future fix.
7. **`name` vs `description` divergence** — the auto-derived name never re-derives after description edits; once created it is user-owned. Intended behaviour.
8. **Rollups are accepted, not rejected** — Phase 3a keeps a geocode that degraded to a coarser entity (`"Squamish waterfall"` → `Squamish, BC`) and shows the rolled-up label, rather than treating it as unresolvable. Rejecting would fail on legitimate rural BC landmarks that genuinely only resolve to the nearest settlement, and the honesty rule already puts the degradation in front of the user. Note this cannot be implemented as a `matchCodes: ["UpHierarchy"]` check anyway — see §5.2, the field is not returned for place results.
9. **Geocoding is a second network hop inside resolve** — resolve is now one Foundry call plus two Azure Maps calls, worsening the latency risk already noted in item 2. Geocoding is cheap (~70–300 ms per call, measured), but the parser is not: `gpt-oss-120b` spent 4–15 s on descriptions it struggled with. Item 2's fire-and-poll trigger point is closer than it looked.
10. **Parser reliability is now the weak link** — with geocoding real, end-to-end failures traced to the Phase 2 parser rather than Azure Maps. Measured over repeated calls: `"SFU to UBC"` fails 3/3 (acronyms → low confidence, 4–15 s); one run emitted a token-split artifact (`"Lou gheed Mall"`) that then geocoded up-hierarchy to `Burnaby, BC`; one run returned HTTP 400 `finish_reason: "content_filter"` after 4264 completion tokens. Candidate fixes, all Phase 2 territory: expand acronyms in the system prompt, cap reasoning effort / `max_tokens`, or move to a non-reasoning deployment. The 502 path (§6) covers the throw correctly; the silent nulls are the part worth fixing.

    Add one more to that list, and it is the cheapest of them: **require the parser to region-qualify every label** (`"Richmond, BC"`, never bare `"Richmond"`). §5.2 shows qualification collapses the entire geobias problem — qualified labels geocode to the same coordinates at `High` confidence under any bias point. The prompt currently asks for "the most specific real-world place name", which produces qualification most of the time but not reliably, and pushes toward over-specific brand names (`"Metropolis at Metrotown"`, which fails where `"Metrotown"` succeeds). Asking for *commonly-used name + province* directly targets both failure modes.
