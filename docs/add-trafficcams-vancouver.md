# trafficcams.vancouver.ca — second camera source

Plan for integrating the City of Vancouver's intersection cameras as a second source of traffic camera images, alongside DriveBC ([route-cameras-design.md](route-cameras-design.md)). DriveBC covers highways; it has almost nothing inside the city, so a route that starts or ends in Vancouver currently shows its first camera at the Trans-Canada and nothing before it. This source fills that gap.

Everything below marked *measured* was checked against the live site on 2026-09-21. The most consequential findings are in §2 and §4; read those before anything else.

## 1. The site, as it actually behaves

https://trafficcams.vancouver.ca/ is a static ASP.NET site behind Cloudflare with no API and no metadata. The rules the plan was written against hold, with corrections:

| Rule | Measured |
|---|---|
| All cameras are listed on the root page | Yes — **216 distinct intersection pages**, but **398 links**: every intersection is listed twice, once under each street name (`E 1st Ave and Boundary Rd` under "1", `Boundary Rd and E 1st Ave` under "B"). Dedupe by `href`. |
| Links are `<a href="/boundary1.htm">…</a>` in accordion items | Yes, but the markup is hand-written: link text spans line breaks (`E 1st Ave and\n\t\tBoundary Rd`), and **some `href`s carry trailing whitespace inside the quotes** (`href="/alma10.htm\n\t\t"`). Trim and collapse whitespace on both. Case is inconsistent (`/Commercial01.htm`, `/ClarkHastings.htm`) but IIS is case-insensitive; normalise to lower-case as the key. |
| Every page has 4 images, N/S/E/W | **190 of 216** have four. 19 have three, 4 have two, 2 have one, and `mainKingsway7.htm` has **five** (`South Main`, `South Kingsway`). 832 images in total. |
| Image URLs are `https://trafficcams.vancouver.ca/cameraimages/X.jpg` | The `src` is **relative** (`cameraimages/X.jpg`); resolve against the page. All 832 are `.jpg` in that one folder. |
| The page title is `<h1 class="display-2">` | Yes, on all 216 pages. Three are not intersections at all: `Burrard Street Bridge`, `Cambie Bridge`, `Gladstone St midblock east of Kingsway`. |

The root page's `Last-Modified` was 2026-09-18 — the list changes on the order of weeks, not hours.

### Direction is in the `alt`, not the filename

```html
<img src="cameraimages/Boundary1stSNorth.jpg" alt="Boundary Road and E 1st Ave - North" width="720" height="480" />
```

The filename's `S` and the frame's burned-in overlay (`Boundary01 (South)`) name the **corner the camera is mounted on**; the `alt` suffix after ` - ` is the **direction it looks** — confirmed by the North Shore mountains in that frame's background. The alt suffix is what a driver wants ("looking north along Boundary"), so it is the field to store. It is a free label, not an enum: across 832 images the suffixes are `North`/`South`/`East`/`West` (810), plus `Northeast`, `South East`, `South West`, `South Main`, `South Kingsway`, `West exit`, `West approach`, `Seymour`, `Howe`, five with a trailing space, one with `Ave- East`, and **five with no ` - ` at all** (`clark4.htm`: `alt="Clark Drive"` ×4; `AngusMarineEast.jpg`: alt is just the intersection). For those, fall back to the filename's trailing `North|South|East|West`, which recovers all five.

### Images — *measured*

| Property | Value | Consequence |
|---|---|---|
| Size | **720×480 (3:2)**, 210–480 KB | DriveBC is 800×450 at 34–92 KB. Four to five times heavier; 40 cards is ~12 MB. §6. |
| Refresh | Every **5 minutes**, each camera at a fixed offset within the cycle (23:11:47 → 23:16:47 → 23:21:46 → 23:26:47). The page text says "10 to 15 minutes". | Fresher than DriveBC's ~15 min. |
| Headers | `ETag`, `Last-Modified`, `Accept-Ranges`. **No `Cache-Control`.** `If-None-Match` → **304**. | With no `Cache-Control`, browsers apply heuristic freshness (10% of the `Last-Modified` age — up to ~30 s here). Harmless, but the `?t=` cache key must be clock-based, because there is no per-camera timestamp in any metadata (§6). |
| CORS | **No `Access-Control-Allow-Origin`.** | Irrelevant for `<img>`; means the browser can never read the pixels (no canvas/`fetch`). A future server-side analysis service is unaffected. |
| Dark camera | Unknown. Every one of 20 sampled images was a live frame with a fresh timestamp. | There is no `is_on` equivalent anywhere; see §5. |
| Bot management | Cloudflare sets `__cf_bm` on every response; plain `curl` was never challenged across ~500 requests at 8-way concurrency. | The crawler should still be polite: one pass, low concurrency, daily. |

## 2. Geolocation — the City already publishes the coordinates

The root page says *"Find the intersection's pin on the map"*. That map is an iframe to `vanmapp1.vancouver.ca/gmaps/m_covmap.htm?map=traffic_cameras`, whose script loads a KML layer from

```
https://vanmapp1.vancouver.ca/googleKml/traffic_cameras/
```

**219 placemarks, each with WGS-84 coordinates, the intersection name, and a link to its `trafficcams.vancouver.ca` page.** *Measured* against the crawled root list:

- **All 216 root-listed pages are in the KML.** The KML also has two pages the root list has dropped but which still serve (`granville33.htm`, `main41.htm`), and one placemark with no page link (`Rupert St and E 22nd Av`).
- Links carry the same trailing-whitespace defect as the root page; trim before matching.
- Where Azure geocoding *did* find the intersection (below), it agrees with the KML pin to a **median of 5 m, p90 17 m**.

**The KML carries no image URLs.** It is a list of *sites* — one pin per intersection, linking to that intersection's HTML page — and nothing below that level. It replaces the geocoding step, not the crawl: populating `vancouver_cameras` still requires fetching all ~218 pages and reading their `<img>` tags, because that is the only place the image list and its direction labels exist.

Nor can the image paths be derived from the page path. *Measured across all 832 images:* **266 do not contain their page's slug at all**, and there is no rule to recover them — `/alma10.htm` serves `AlmaNorthW10th.jpg` and `W10thEastAlma.jpg` (street order flips with the direction), `/almaPtGrey.htm` serves `PtGreyEastAlma.jpg`, and `/oak4.htm` serves `Oak70north.jpg`, `Oak70EastEast.jpg`, `Oak70EastWest.jpg` and — for its south view — `Oakbridge.jpg`, which shares nothing with any of the others. Case varies within a single page (`Oak70north` beside `Oak70EastEast`). The crawl is not an optimisation; it is the only way to get these.

This is an undocumented internal endpoint (`x-aspnet-version: 2.0.50727`, `Cache-Control: private`, `content-disposition: attachment`) and could disappear. It is nonetheless the primary source, because of what geocoding turned out to look like.

### Azure Maps geocoding, as the plan proposed — *measured on all 216 titles*

The plan's query form — `and` → `&`, URL-encoded, with the app's existing `coordinates=-123.1,49.3` bias — was run for every `<h1>`:

| Query form | Lands in Vancouver | True intersection hit† |
|---|---|---|
| `Oak St & W 10th Ave` + coordinate bias (as planned) | **105 / 216** | — |
| … + `bbox` around the city | 105-ish, mostly `Low` | — (consistent with the geocoder's existing bbox note) |
| `Oak St & W 10th Ave, Vancouver, BC` + coordinate bias | 216 / 216 | **189 / 216** |
| Structured: `addressLine=Oak St & W 10th Ave&locality=Vancouver&adminDistrict=BC&countryRegion=CA` | 215 / 216 | **193 / 216** |
| Union of the two | | **199 / 216** |

† *A true hit is one whose returned `address.addressLine` still contains `&`.*

Two things in that table matter more than the numbers:

1. **The planned query form fails half the time, silently.** Unqualified `Bute St & Davie St` resolves to El Paso, Denver, Manhattan… at **`Medium` confidence**, so the geocoder's existing `Low` gate does not catch it. The city suffix (or the structured form) is mandatory.
2. **`confidence` and `matchCodes` do not tell you whether you got the intersection.** When Azure cannot find `A & B` it rolls up to *one street* and returns `Address`/`Medium`/`Ambiguous` — identical to some real hits — with a point anywhere along that street: `Arbutus and Broadway` → a point on Arbutus St **2.8 km** south of Broadway; `Main St and Marine Dr` → **13 km** off; `Cambie St and W 2nd Ave - East intersection` → 5.7 km. The only reliable gate is *the returned `addressLine` echoing `A & B`*. This is not something `AzureMapsGeocoder.geocode()` exposes, so the sync step needs its own call rather than reusing the route resolver's geocoder.

The 17 titles that fail under both forms are the bridges and the mid-block camera (not intersections), site typos (`Renfew`, `Vanables`, `Granville St and E Georgia St` — it is W Georgia), suffix-less names (`Arbutus and W 16th`), and five on **Boundary Rd**, which Azure appears to attribute to Burnaby. All 17 are in the KML.

### Decision

| Step | Source | Why |
|---|---|---|
| Discover sites and their coordinates | **KML** | Complete, authoritative, 5 m agreement, no API cost, no false positives. |
| Discover cameras per site | **HTML crawl of every page — unavoidable** | The KML stops at the site. Image paths and direction labels exist nowhere else and cannot be derived from the page path. |
| Coordinates for a site absent from the KML | **Azure geocode, city-qualified, gated on `addressLine` containing `&`** | Insurance against the KML vanishing; today it would be exercised for zero sites. |
| Coordinates for a site that fails both | `NULL` + manual fix | The list is 216 rows and changes by a few a year; a `manual` override column is cheaper than any cleverer geocoding. |

Provenance is stored per site (`location_source`) so a KML outage that leaves the table half-geocoded is visible rather than silent.

## 3. Data model

Two tables, as the plan states. This is the second schema change and therefore the migration-tooling trigger named in route-cameras-design §8 / add-route-design §8. **Recommendation: spend it later, not here** — add `db/init/002_vancouver_cameras.sql` in the existing numbered-file style, and adopt tooling in its own PR when the .NET analysis service needs per-route persistence. Two `CREATE TABLE`s do not justify a new dependency.

```sql
CREATE TABLE vancouver_camera_sites (
  id               serial PRIMARY KEY,
  page_path        text NOT NULL UNIQUE,          -- '/boundary1.htm', lower-cased, trimmed: the natural key
  kml_id           text,                          -- 'TCM001'; NULL when the site is only on the root page
  name             text NOT NULL,                 -- the <h1>: 'Boundary Rd and E 1st Ave'
  lat              double precision,
  lng              double precision,
  location_source  text CHECK (location_source IN ('kml', 'azure', 'manual')),
  location_note    text,                          -- Azure's formattedAddress, or why a manual fix was made
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  retired_at       timestamptz                    -- set when absent from the root page AND the KML
);

CREATE TABLE vancouver_cameras (
  id               serial PRIMARY KEY,
  site_id          integer NOT NULL REFERENCES vancouver_camera_sites (id),
  image_path       text NOT NULL UNIQUE,          -- 'cameraimages/Boundary1stSNorth.jpg': the natural key
  direction_label  text NOT NULL DEFAULT '',      -- alt suffix as published: 'North', 'South Main', 'West exit'
  heading          text CHECK (heading IN ('N','NE','E','SE','S','SW','W','NW')), -- parsed from the label; NULL when it is not a compass point
  alt              text NOT NULL DEFAULT '',
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  retired_at       timestamptz
);

CREATE INDEX vancouver_cameras_site_id_idx ON vancouver_cameras (site_id);
```

Decisions:

- **Natural keys are the URL paths**, not the names. Names have typos the City may fix; paths are what the images hang off. The KML id is kept but not relied on (one placemark has no page).
- **Nothing is ever deleted.** `retired_at` is set when a site or camera is missing from a sync; cleared if it comes back. A camera image path that is gone from the page but still serves is still retired — the page is the City's statement of what is live.
- **`lat`/`lng` nullable.** A site is inserted the moment it is discovered; a site without a location is simply never matched to a route. That is what keeps the crawl and geocode steps independent.
- **`heading` is derived, `direction_label` is the truth.** `South Main` → `S`, `Northeast` → `NE`, `West exit` → `W`, `Seymour` → `NULL`. The label is what is shown; the heading is there for the day the matcher wants to prefer cameras looking along the direction of travel (it does not today, and DriveBC's design explicitly ruled out filtering on orientation).

### Why a database rather than a committed snapshot

`drivebc-snapshot.json` is regenerated by hand and lives in git. That would work here too — the list is 216 rows that change monthly — and it would be one file instead of two tables and a sync. The reasons to persist anyway, in order of weight: the `manual` location overrides need somewhere to live that a regeneration does not wipe; `first_seen`/`retired_at` history is only possible with state; and the specification's image-analysis service will need these rows as a foreign key. If those reasons ever stop applying, the snapshot is the simpler design.

## 4. Sync — two idempotent steps, one script

The plan calls for "separate async services". Next.js has no background worker, so concretely this is a script, run by hand now and by a scheduled GitHub Action later, in the same place and shape as `web/scripts/fetch-camera-snapshot.mjs`:

```
node scripts/sync-vancouver-cameras.mjs            # both steps
node scripts/sync-vancouver-cameras.mjs crawl      # step 1 only
node scripts/sync-vancouver-cameras.mjs geocode    # step 2 only
```

**Step 1 — crawl** (network: 1 KML + 1 root page + ~218 intersection pages; ~30 s at concurrency 4):

1. Fetch the KML; parse placemarks → `{kml_id, name, page_path, lat, lng}`. Trim, lower-case, dedupe on `page_path`.
2. Fetch the root page; extract `href`s → trim, lower-case, dedupe. Union with the KML's page set.
3. For each page: fetch, take `<h1 class="display-2">`, take every `<img src="cameraimages/…">` with its `alt`. Parse direction from the alt suffix, falling back to the filename suffix.
4. Upsert sites on `page_path`: set `name`, `kml_id`, `last_seen_at`; set `lat`/`lng`/`location_source='kml'` **only if** the current `location_source` is not `manual`. Upsert cameras on `image_path` likewise. Anything not seen this pass gets `retired_at = now()` if it is not already set.
5. Print a summary — sites seen/new/retired, cameras seen/new/retired, sites without a location — and exit non-zero if the root page yielded fewer than, say, 150 pages or the KML fewer than 150 placemarks. A layout change on the City's side must fail loudly, not quietly retire everything (the `MIN_VALID_FRACTION` idea from the DriveBC source, applied to a crawl).

**Step 2 — geocode** (network: one Azure call per site with `lat IS NULL AND location_source IS DISTINCT FROM 'manual'`; today, zero calls):

1. Query `addressLine = name.replace(' and ', ' & ')`, `locality=Vancouver`, `adminDistrict=BC`, `countryRegion=CA`, `top=1`. Fall back to the freeform `"… , Vancouver, BC"` form if the structured one returns nothing (the union gained 6 over either alone).
2. Accept only when the result's `address.addressLine` contains `&`. Store `location_source='azure'`, `location_note=formattedAddress`.
3. Otherwise leave `lat`/`lng` null and log the title. These are the rows for a human to fix with a one-line `UPDATE … SET lat, lng, location_source='manual', location_note='…'`.

The parser (`parseRootPage`, `parseIntersectionPage`, `parseKml`, `parseDirection`) belongs in `web/lib/cameras/vancouver/` as pure functions with no I/O, imported by both the script and — via a committed fixture — a future test. The `.mjs` script can `import` them if they are written as `.mjs` too, or the script can be `tsx`-free by keeping the parsers dependency-free plain modules. Either way: **no HTML parser dependency.** The markup is six regexes' worth, and adding `cheerio` for it is exactly the kind of new tooling this repo avoids.

A `test/httpYac/trafficcams-vancouver.http` file should be written **first**, as `drivebc-cameras.http` was, recording the KML endpoint, one intersection page, one image with its `If-None-Match` 304, and the three geocoding cases (unqualified → El Paso; qualified → hit; `Arbutus and Broadway` → street roll-up). Those are the traps someone will otherwise rediscover.

## 5. Liveness — there isn't any, and the design has to say so

DriveBC's whole camera-state model (`isOn`, `isStale`, `isDelayed`, `lastUpdated`, `updatePeriodSeconds`) comes from its catalogue. The City publishes none of it. What exists:

- `Last-Modified` on the image response — visible to the browser, invisible to the server without a `HEAD` per camera per page view.
- The burned-in timestamp in the frame — visible to a human, not to code.
- Whatever a dead camera serves — **unobserved**. It might 404, might serve a stale frame with an old `Last-Modified`, might serve a placeholder. The DriveBC design's most important finding was that dark cameras answer 200 with a black frame; the equivalent here is unknown.

**v1 decision:** every Vancouver camera is `isOn: true`, `isStale: false`, `lastUpdated: null`, `updatePeriodSeconds: 300`. The card shows no age line (it already omits it when there is no timestamp) and shows "Image unavailable" on `onError`. This is honest — the app does not know — and it is the same rule DriveBC's design set: *never infer liveness from the image response*, except that here there is nothing else to infer it from.

**Later, if it matters:** the sync script (or a lighter hourly job) can `HEAD` each of the 832 images and store `last_modified_at` on `vancouver_cameras`; a camera whose frame is more than, say, 30 min old is then rendered stale, using the existing `overdue` logic in `CameraCard`. That is ~830 requests an hour against the City's site, which is why it is not in v1.

## 6. Fitting a second source into the app

`Camera`, `CameraSource`, `camerasAlongRoute`, `cameraImageUrl` and `CameraCard` are all DriveBC-shaped. The changes, smallest first:

| Piece | Change |
|---|---|
| `Camera.id: number` | Becomes a `string` with a source prefix — `"drivebc:123"`, `"vancouver:45"`. Ids from two sources collide otherwise, and `id` is a React key and the image-URL input. |
| `Camera.group: number` | Same: `"drivebc:9"`, `"vancouver:12"`. `dealByGroup` keys on it; a DriveBC group 42 and a Vancouver site 42 would be dealt as one site. |
| `Camera.source` | New: `"drivebc" \| "vancouver"`. `cameraImageUrl` and the card's attribution switch on it. Fields with no Vancouver meaning (`highway`, `regionName`, `dbcMark`) default to `""`; the card already hides an empty highway chip. |
| `cameraImageUrl` | DriveBC: unchanged. Vancouver: `https://trafficcams.vancouver.ca/${imagePath}?t=${floor(now / 60s)}`. Clock-bucketed to the minute because there is no `lastUpdated` to key on; a minute is the shortest bucket that keeps a re-render a memory-cache hit while still refreshing on the 5-minute cycle. The bucket must be computed on the server (the page is server-rendered) or the URL differs between server and client HTML. |
| `CameraSource` | New `VancouverCameraSource` reading the two tables through `getPool()`, same 1 h in-process TTL, single in-flight promise, stale-while-error; **no snapshot fallback** — a cold process with no DB simply contributes zero cameras, and the route page already renders without any. New `CompositeCameraSource([...])` that awaits both, concatenates, and reports `origin` as the weaker of the two. `catalogue.ts` composes it; `CAMERA_SOURCE=snapshot` still pins DriveBC alone. |
| `camerasAlongRoute` | **No change.** The bbox prefilter and per-site dealing already do the right thing; 832 more candidates cost nothing outside Vancouver and inside it the corridor is the only lever, as before. Worth measuring on a Burnaby → Squamish route that starts in the city: expect the first few km to fill with intersections, which is the point. |
| `CameraCard` | Attribution: `City of Vancouver` when `source === "vancouver"`. The 3:2 frame is cropped to the 16:9 box like everything else; acceptable, and a per-source aspect would reflow the grid. Orientation chip shows `direction_label`. |
| Page footer | Add the City's attribution beside the DriveBC/OGL-BC line (§8 q.1). |

Page weight: 40 × ~300 KB is 12 MB if a route is entirely inside the city. `next/image` lazy-loads below the fold by default, so the cost is bandwidth over the scroll, not a 12 MB first paint. If it turns out to matter, `MAX_CAMERAS` is already one constant, and the corridor-size option just added to the grid is the other.

## 7. Phasing

**Phase 0 — record the traps** *(no app code)*
- [x] `test/httpYac/trafficcams-vancouver.http`: KML, one page, one image + 304, the three geocode cases.

**Phase 1 — data** *(no UI change; can ship alone)*
- [x] `db/init/002_vancouver_cameras.sql`
- [x] `lib/cameras/vancouver/parse-*.mjs` — pure parsers + a committed fixture of one intersection page and a trimmed KML. Written as `.mjs` rather than `.ts`: the sync script runs under plain `node`, and this keeps it dependency-free with no build step, same as `fetch-camera-snapshot.mjs`. Validated against the live site: all 219 pages / 844 images parsed with zero fallback failures, and every documented anomaly (`Northeast`, `South Main`, `West exit`, `Seymour`, …) reproduced exactly.
- [x] `scripts/sync-vancouver-cameras.mjs` — `crawl` + `geocode`, summary line, loud failure on a short list
- [x] Migration applied to `roadsight_dev` on Azure (`vancouver_camera_sites`, `vancouver_cameras` confirmed present) — via `pg` directly with the admin role, not the VS Code extension, which failed to negotiate SSL for that connection despite `ssl: true`
- [x] Ran the sync script against `roadsight_dev`: crawl found 219 sites / 844 cameras (all new), 0 retired, 0 without a location; geocode ran with 0 sites needing it (0 Azure calls) — no manual fixes needed
- [x] `.env.local.example`: nothing new — `DATABASE_URL` and `AZURE_MAPS_KEY` already exist

**Phase 2 — the page**
- [x] `Camera.id`/`group` → string, `source` added; DriveBC mapper updated; snapshot still parses. Also added `sourceKey` (DriveBC's numeric id / the City's image path), so `cameraImageUrl` never has to parse the prefixed `id` back apart.
- [x] `VancouverCameraSource`, `CompositeCameraSource`, `catalogue.ts`. The Vancouver source is only composed in when `DATABASE_URL` is set, the same gate as the route repository.
- [x] `cameraImageUrl` by source; card attribution; footer. Attribution goes through the existing `credit` field (`"City of Vancouver"`) rather than a switch in the card. The render timestamp for the `?t=` bucket is read once in `RouteCameras` (server) and passed down as `renderedAtMs`.
- [x] Measure a city-origin route — results below

*Measured 2026-09-24*, live DriveBC (1066) + `roadsight_dev` (844 Vancouver cameras), 1 km corridor, `MAX_CAMERAS = 40`. Match time is the warm median of 20 runs.

| Route | Matched (DriveBC + Vancouver) | Shown (DriveBC + Vancouver) | Match time, before → after | First card km, before → after |
|---|---|---|---|---|
| Waterfront Stn → Squamish | 19 + 139 | 19 + 21 | 2.8 → 41.7 ms | 2.4 → **0.1** |
| Metrotown → Squamish | 39 + 59 | 31 + 9 | 8.0 → 102.6 ms | 7.1 → 4.8 |
| SFU → UBC | 4 + 235 | 4 + 36 | 0.4 → 45.0 ms | 11.3 → 11.3 |
| Lougheed Mall → YVR | 26 + 22 | 26 + 14 | 2.3 → 23.4 ms | 2.1 → 2.1 |

Findings:
- **The gap is filled.** Waterfront → Squamish now opens at km 0.1 instead of at the Stanley Park causeway; SFU → UBC goes from 4 cameras at 2 sites to 40 across 34.
- **§6's "no change to `camerasAlongRoute`, costs nothing" is wrong inside the city.** Every Vancouver candidate passes the bbox prefilter, so each one pays a full `nearestOnPolyline` scan over ~700–1700 segments: match time goes up 10–100×, to ~100 ms on Metrotown → Squamish. Tolerable per page view for a POC. If it matters, the fix is a coarser prefilter (bbox per chunk of ~50 segments) inside `nearestOnPolyline`, not a spatial index.
- **§8.7 mostly holds: the highway is not starved.** Waterfront → Squamish keeps all 19 DriveBC cameras and the last card is still at km 62. Metrotown → Squamish is the one where the cap binds: 98 matches, and 8 DriveBC cameras give way to 9 intersections in the first 8 km. The mix is skewed, though: on Waterfront → Squamish, 21 of 40 cards are in the first 2.1 km, because empty highway buckets hand their slots back to the dense city ones.
- **1 km is too wide for a street grid.** It reaches parallel streets five blocks away. At the grid's 200 m choice, SFU → UBC keeps 20 of 40 and Waterfront → Squamish 28. A per-source corridor (e.g. 250 m for Vancouver) is the obvious next lever, ahead of a per-source cap.
  - **Done instead, globally:** the choices are now 100 / 200 / 500 m, default 200 m. The server matches at 500 m without thinning, and the grid thins to 40 for each choice in the browser, so a narrow corridor gets its own evenly spread 40 rather than whatever survived the widest one's cut. What 200 m costs DriveBC compared with 1 km: Lougheed → Abbotsford 31 → 25, Lougheed → YVR 26 → 19, Waterfront → Squamish 19 → 17, Lougheed → Kelowna 108 → 103. Those are cameras on crossing roads at interchanges, or on a parallel highway. At most ~220 matches go to the browser (Art Gallery → UBC).

**Phase 3 — later, if needed**
- [ ] Scheduled Action running the sync weekly and opening a PR with the summary
- [ ] `HEAD`-based staleness (§5)
- [ ] Heading-aware ranking in the matcher, once there is a reason

## 8. Open questions & risks

1. **Terms of use.** The site footer points at the City of Vancouver's general [Terms of Use](https://vancouver.ca/your-government/terms-of-use.aspx) and Privacy policy; there is no camera-specific licence and these images are *not* in the City's Open Data catalogue. The same reasoning as DriveBC's §9.1 applies — hotlinking, not copying; the viewer's browser fetches from the City directly — and the same safeguard: **never proxy**. The KML and the crawl do copy metadata (names, coordinates) into our DB, which is a different question from the images; it is public map data of a kind the City publishes elsewhere as open data, but it was not read from the open-data portal. Worth a 3-1-1 email before this leaves POC.
2. **The KML is an internal endpoint from a 2005-era ASP.NET app.** If it goes, sites still get discovered from the root page and geocoded by Azure at 92% coverage with the manual column for the rest. That is why both paths stay in the plan even though only one is exercised today. A sync that finds the KML gone should log it prominently, not fail.
3. **What a dead camera serves is unknown** (§5). The first time one is seen, record it in the `.http` file the way the black-frame finding was.
4. **Cloudflare.** ~500 requests from a residential IP were never challenged; a cloud egress IP might be. The crawl runs once and is small; if it is challenged, run it from a developer machine — it is a weekly job, not a runtime dependency.
5. **Site data quality is the City's.** Typos (`Renfew`, `Vanables`), wrong street (`E Georgia` for W Georgia at Granville/Hornby/Howe), and alt texts missing their direction. None of it affects the app once the KML supplies coordinates, but the names are shown as published. Do not "fix" them in the sync — a manual `name` override is another thing to maintain, and the City may fix them.
6. **`Main St and Marine Dr`** is the one site where Azure's structured and freeform answers disagreed by 420 m (SE vs SW Marine Dr). The KML settles it, but it is the example to use when someone asks why the geocode result is gated on `addressLine`.
7. **Two sources now share `MAX_CAMERAS = 40` and one corridor.** A route through the city and up the Sea-to-Sky will spend more of its 40 on intersections than before. The bucketing spreads them along the route, so the highway is not starved, but the mix is worth looking at on a real route before deciding whether the cap should be per-source.
