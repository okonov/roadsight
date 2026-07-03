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
| **2** | Real NL resolution via **Azure Foundry** — one-line swap | Azure Foundry deployment |
| **3** | Real route planning via **Azure Maps** — one-line swap | Azure Maps account |

Phase 1 delivers the complete user story behaviour (with plausible mock data), so UI, API, and persistence are finished and demoable before any Azure account exists. Phases 2 and 3 change no UI, API, or DB code — that is the point of the service interfaces introduced here.

## 2. Architecture

The codebase already uses an **interface + swap-point singleton** pattern: [`web/lib/routes/repository.ts`](../web/lib/routes/repository.ts) exports a `routeRepository` singleton (stashed on `globalThis` to survive Fast Refresh) with a comment marking where the in-memory implementation will later be replaced. The same pattern is used in [`web/auth.ts`](../web/auth.ts) for the future Microsoft Entra External ID swap.

This design adds two more swap points of exactly the same shape — a route resolver (NL description → origin/destination) and a route planner (coordinates → polyline) — and upgrades the repository swap point to be gated by `DATABASE_URL`.

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
    AF["AzureFoundryRouteResolver<br/>(Phase 2)"]
    MP["MockRoutePlanner<br/>(Phase 1)"]
    AM["AzureMapsRoutePlanner<br/>(Phase 3)"]
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
    RES -.-> AF
    PL --> MP
    PL -.-> AM

    classDef future stroke-dasharray: 5 5,opacity:0.7
    class AF,AM,AUTH future
```

*Solid boxes are implemented in Phase 1; dashed boxes are future swaps. Each singleton picks its implementation in one file — no other file changes when a swap happens.*

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

Two new modules mirroring the `lib/routes/` layout exactly: interface file + mock implementation + `globalThis`-stashed singleton with a swap comment.

### Route resolution — `web/lib/route-resolution/`

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

**`resolver.ts`** — singleton, verbatim copy of the `repository.ts` pattern:

```ts
// Later: swap to `new AzureFoundryRouteResolver(...)` — no other file changes.
```

### Route planning — `web/lib/routing/`

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

### Phase 2 — real Azure Foundry resolver

- [ ] `AzureFoundryRouteResolver implements RouteResolver`: prompt returns strict JSON `{ origin: { label, lat, lng }, destination: { … } }`, Zod-validated; return `null` on low confidence / malformed output
- [ ] Env: `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`, deployment name
- [ ] One-line swap in `web/lib/route-resolution/resolver.ts`

No UI, API, or DB changes.

### Phase 3 — real Azure Maps planner

- [ ] `AzureMapsRoutePlanner implements RoutePlanner`: Route Directions API; map the top-ranked route's leg points to the GeoJSON LineString
- [ ] Env: `AZURE_MAPS_KEY`
- [ ] One-line swap in `web/lib/routing/planner.ts`

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
4. **Ambiguity handling** — "Squamish waterfall" could match multiple places; the current design returns a single candidate pair. A multi-candidate `RouteResolver` v2 (returning a candidates array for a pick-list) is flagged now so Phase 2 can decide.
5. **User identity durability** — routes persist, users don't (until Entra ID). Mitigated by deterministic dev user ids; fully fixed in the Entra phase.
6. **Concurrency** — read-modify-write updates have no optimistic locking. Acceptable single-user; an `updated_at`-based check is the future fix.
7. **`name` vs `description` divergence** — the auto-derived name never re-derives after description edits; once created it is user-owned. Intended behaviour.
