# City of Surrey traffic cameras — third camera source

Plan for adding the City of Surrey's intersection cameras as a third source, alongside DriveBC ([route-cameras-design.md](route-cameras-design.md)) and the City of Vancouver ([add-trafficcams-vancouver.md](add-trafficcams-vancouver.md)). DriveBC covers Highway 1, 99, 10, 15 and Fraser Hwy through Surrey but nothing on the arterial grid. Surrey has about 600 cameras on that grid. That is the most of any Lower Mainland municipality, and by far the cheapest to integrate.

Everything marked *measured* was checked against the live endpoints on 2026-09-24. The main differences from Vancouver: **the data is already structured** (§1), **7% of the published image URLs are dead** (§2), and **the images come with a real `Last-Modified`** (§3). Read those sections first.

### Why Surrey, and not Burnaby or Coquitlam

A survey of the other Lower Mainland municipalities on the same day found:

| Municipality | Own cameras | Machine-readable source |
|---|---|---|
| **Surrey** | ~600 | ArcGIS feature layer, point + image URL per camera |
| Richmond | 161 intersections | Leaflet markers inline in `richmond.ca/services/transportation/trafficcameras/default.aspx`, and one page per intersection with `<img alt="… Northbound">`. The same crawl pattern as Vancouver. |
| Township of Langley | 14 | ArcGIS feature layer (`services5.arcgis.com/frpHL0Fv8koQRVWY/…/TrafficCamerasTourPnts3`), with a per-camera `timeString` |
| Abbotsford | 7 | Road-weather cameras only |
| Burnaby, Coquitlam, Port Coquitlam, Port Moody, New Westminster, Delta, North Vancouver (City and District), Maple Ridge | none | Coquitlam's site sends people to DriveBC. Burnaby's Roads & Traffic page doesn't mention cameras. Aggregator listings for these cities are DriveBC and Windy feeds. |

Surrey comes next because it has the most cameras and is the cheapest to add. Richmond would follow on the Vancouver code path. Langley can reuse most of what is built here (§9 q.6).

## 1. The source, as it actually behaves

Surrey publishes the same camera list twice, as two ArcGIS feature layers:

| | **Operational layer** | **Open-data copy** |
|---|---|---|
| URL | `https://gisservices.surrey.ca/arcgis/rest/services/Public/Transportation/MapServer/2` | `https://services5.arcgis.com/YRpe0VKTJytZSSIB/arcgis/rest/services/Traffic%20Cameras/FeatureServer/0` |
| Host | City's own ArcGIS Server 11.5 | ArcGIS Online (item `94b17026e83d49d58b41fd75933166db`, owner `SurreyGIS`) |
| Used by | The City's own "Surrey Traffic Cameras" web map (item `fbb9bafd…`) and the Traffic Data Hub | The open-data catalogue (`data.surrey.ca` → `opendata-surrey.hub.arcgis.com`, dataset `traffic-cameras`) |
| Records *(measured)* | **701** | **703** |
| Fields | `LOCATION`, `CAMERA_NAME`, `OWNER`, `IMAGE`, `NVR`, install dates, `MAC_ADDRESS`, `COMMENTS` | `CAMERAID`, `LOCATION`, `ROTATION`, `IMAGE` |
| Freshness | Live: it has `96_120_pano` and the `80_134` pair, which the copy lacks | `dataLastEditDate` 2026-08-06: a periodic export. It has 6 image URLs the operational layer has since dropped. |
| CORS | Not needed (server-side fetch) | `Access-Control-Allow-Origin: *` |
| Licence | none stated on the service | The catalogue says its data is under the **Open Government Licence – Surrey**. The item's own `licenseInfo` is blank. |

Both are standard ArcGIS REST: `query?where=1=1&outFields=*&outSR=4326&f=json` returns every record, with WGS-84 point geometry, in **one request** (`maxRecordCount` 2000, `exceededTransferLimit` absent). Geometry is reprojected on request from NAD83 UTM 10N (`wkid 26910`), so the app never deals with UTM. Coordinates agree between the two layers to within 113 m in the worst case, and are identical for most records.

**No crawl, no geocoding.** Everything that took most of the Vancouver design (§1–§2 there) is one GET here.

A record, as published:

```json
{
  "OBJECTID": 1, "LOCATION": "100 Ave And Whalley Blvd", "CAMERA_NAME": "100_whalley_cam1",
  "OWNER": "Surrey", "NVR": "TMCNVR11",
  "IMAGE": "https://stcameleonprod.blob.core.windows.net/prodcameleon-blob/TMCNVR11/enc_100_whalley_cam1.jpg",
  "COMMENTS": "Q6032-E (00408CDA09CB) replaced on Feb 27, 2020"
}
```

`NVR` is the network video recorder the camera writes through. It is also the folder in the image URL, and it sets the refresh cadence (§3).

## 2. Data quality — *measured on all 701 operational records*

The layer is the City's own asset inventory, not a curated public feed. Most of it is clean. The exceptions:

| Finding | Count | Handling |
|---|---|---|
| Empty records: no location, name or image | **13** | Skip anything without `IMAGE`. |
| `IMAGE` missing but name present | 2 (`28_160_pano`, `90_132_cam2`) | Skip. |
| **Provincial cameras**: `IMAGE` on `www.drivebc.ca/images/N.jpg` (35) or `images.drivebc.ca/bchighwaycam/pub/cameras/N.jpg` (3, `OWNER` null) | **38** | **All 38 ids are in `drivebc-snapshot.json`.** Drop anything whose image host is not Surrey's. Filter on the host rather than `OWNER`, because three of them have no owner. |
| Duplicate records: same `CAMERA_NAME` and `IMAGE`, one with `OWNER='Surrey'`, the other `OWNER` null, points 1–150 m apart | **5 pairs** | Dedupe on camera key (below) and prefer the `OWNER='Surrey'` row. |
| **Image 404s on the blob host** | **26** | See below. |
| **Image on `cosmos.surrey.ca/TrafficCameraImages/`**: an older on-prem host, which **404s for all 23** | **23** | See below. |
| Malformed `IMAGE` values | 3 | `enc_88_164_cam1.pano`, `enc_80 _120A_pano.jpg` (space), `enc_88_150_pano.jpg\n ` (trailing newline). Trim the value. Only the trailing whitespace can be fixed by trimming; the other two just 404. |
| Mixed case in names | a handful | `83A_140_cam1`, `108_kgbv_quadN`. The blob is case-sensitive, so **never lower-case the URL**. The camera key can be lower-cased. |

After those filters there are **643 unique Surrey cameras**. **595 of them return 200**, and 48 return 404.

**The dead-image rate is the design driver.** The operational layer is not kept in sync with the recorders: 26 blob URLs point at frames that don't exist, and the 23 `cosmos` URLs point at a host that no longer serves them. For **20 of the 23** `cosmos` cameras, the same filename exists under one of the `TMCNVR01…11` folders on the blob. It was found by probing all eleven. But those copies were 8–70 minutes old, not 1–5, so it is unclear whether they are live or left over from an archive job (§9 q.3). Without a filter, **about 1 card in 13 would say "Image unavailable"**, and it would take one of the 40 slots from a working camera. That is why this design keeps a sync step with an image probe (§5) instead of reading the layer at request time as DriveBC does.

### Grouping cameras into sites

`Camera.group` exists so that `dealByGroup` doesn't show four angles of one intersection before one angle of the next. Surrey has no site id. The measured options:

| Key | Sites | Problem |
|---|---|---|
| `LOCATION` as published | 580 | The same intersection appears as `96 Ave And 195 St` and `96 Ave & 195 St` (51 such pairs), as `King George Blvd & 74 Ave` and `74 Ave & King George Blvd`, and as `7100 Block 120 St` and `7100 Blk 120 St`. |
| `CAMERA_NAME` prefix (strip `_cam1`, `_pano`, `_quadN`…) | 502 | Names are hand-typed too: `colebrook_125a_cam2` is at `Colebrook Rd And 123 St`, 821 m from `colebrook_125a_cam1`. |
| **Normalised `LOCATION`**: lower-case, `and`→`&`, `blk`→`block`, collapse whitespace, **sort the two street names** | **510** | 387 single-camera sites, 118 with two, 5 with 3–5. Median spread within a site 0 m, p99 ~100 m. One outlier: `108 Ave & 140 St`, 636 m (a misplaced point, not a naming problem). |

**Decision:** use the normalised `LOCATION`, falling back to the name prefix when `LOCATION` is null (one record: `26_168_pano`). Store the result as `site_key` so it can be fixed by hand.

### What a camera is

The suffix of `CAMERA_NAME` says which kind of frame it is. It doesn't say which way the camera looks.

| Suffix | Count | Frame *(inspected)* | `orientation` to show |
|---|---|---|---|
| `cam1`, `cam2`, `cam1v` | 522 | One conventional view of the intersection | `""` (unknown) |
| `pano` | 108 | **360° fisheye** of the whole intersection, looking down from the pole | `"360°"` |
| `quad` | 7 | **Four views in one frame**, labelled `[N] [E] [S] [W]` in the overlay | `"4 views"` |
| `quadN/E/S/W`, `cam1N/S` | 14 | One direction of a quad or twin camera | `N`, `E`, `S`, `W` |

The open-data copy's `ROTATION` is `0` on all 135 Surrey records that have one. Only the 8 DriveBC records carry a real bearing, so it tells us nothing about direction.

## 3. Images — *measured*

| Property | Value | Consequence |
|---|---|---|
| Host | Azure Blob Storage, container `prodcameleon-blob`, path `TMCNVRnn/enc_<name>.jpg` | Hotlink, as with the other two sources. |
| Size | **800×450 (16:9)**, 21–66 KB, median 31 KB | Same as DriveBC. No cropping, and 40 cards is ~1.3 MB, a tenth of Vancouver's. |
| Overlay | Location, `[view]` and **local time** burned into the top of the frame (`100 Ave & Whalley Blvd 2026-09-24 14:35:55`) | A human can see how old the frame is. Code can't. |
| Refresh | **Set per recorder**: `TMCNVR02` every **1 min**, `TMCNVR01` every **2 min**, `TMCNVR11` every **5 min** (each sampled for 5 min). Out of 595 live frames, 580 were under 5 minutes old when fetched. | Much fresher than DriveBC's ~15 min. |
| Headers | `Last-Modified`, `ETag`, `Content-MD5`. **No `Cache-Control`.** `If-None-Match` → **304**. | Same as Vancouver: with no per-camera timestamp in the metadata, the `?t=` cache key has to come from the clock (§7). |
| CORS | No `Access-Control-Allow-Origin` on the blob | Doesn't matter for `<img>`. |
| Staleness | 14 frames 5–60 min old, 1 over an hour (`mcbride_railcrossing_cam1N`, 78 min) | Stale frames are detectable from `Last-Modified`, unlike Vancouver's (§5). |
| Hours | The TMC is staffed Mon–Fri 06:30–18:30, but frames are written around the clock | No time-of-day handling needed. |

### The container is publicly listable

`GET https://stcameleonprod.blob.core.windows.net/prodcameleon-blob?restype=container&comp=list` returns **200** with the blob list, 5,000 per page. Besides each camera's live `enc_<name>.jpg`, the list has a **15-minute archive going back about a month**: `enc_14_kgbv_cam1_20260823_1800.jpg` … `_20260924_1430.jpg`, 3,024 frames for that camera. Across ~600 cameras that is roughly two million blobs.

This is almost certainly a storage-account setting (`publicAccess: container` instead of `blob`) rather than a published interface. **The app must not depend on it**: no enumeration, no archive reads. If Surrey tightens the setting, the live frames stay readable and the listing disappears. It is recorded here for three reasons. It explains where the `cosmos` → blob copies (§2) may have come from. It is the answer if anyone asks "can we get history for the analysis service": yes technically, but ask the City first (§9 q.2). And it is a reason not to drive the sync from the listing.

## 4. Decision — which layer, and where it lives

| Question | Decision | Why |
|---|---|---|
| Which layer | **Operational layer** (`gisservices.surrey.ca`) as primary. The open-data copy is the licence anchor and the fallback. | It is the fresher of the two and has `OWNER`, `CAMERA_NAME` and `NVR`, which the filters in §2 use. The copy's data is the same, so the licence under which it is published covers what we use. If the operational endpoint disappears, the copy's `IMAGE` gives the name (`enc_<name>.jpg`) and the host gives the owner, so the same parser works with small changes. |
| Read at request time (like DriveBC) or sync into Postgres (like Vancouver)? | **Sync into Postgres.** | Fetching the layer at request time would be simplest, but it can't remove the 7% of dead images without HEADing 640 blobs every hour, which the Vancouver design already rejected for 830 images. A sync can probe once a day, keep a `manual` override for a bad point or a bad `site_key`, keep `first_seen`/`retired_at` history, and give the analysis service a foreign key. These are the same reasons as Vancouver §3. It also reuses the pool, the `CompositeCameraSource` and the script shape that already exist, so there is nothing new to learn. |
| Relocate the 20 `cosmos` cameras to the blob? | **Not in v1.** Keep the layer's URL, probe it, and treat a 404 as unavailable. | Finding them means probing 11 folders per camera, and the copies found were 8–70 min old, which is not obviously live. 3% of cameras don't justify guessing (§9 q.3). |

## 5. Data model

One table. Vancouver needed a separate sites table because the site was the unit being geocoded. Here every camera has its own published point, and the site is just a grouping key.

```sql
-- db/init/003_surrey_cameras.sql
CREATE TABLE surrey_cameras (
  id                serial PRIMARY KEY,
  camera_key        text NOT NULL UNIQUE,     -- lower-cased CAMERA_NAME, or the image filename stem when the name is null: the natural key
  camera_name       text NOT NULL,            -- as published: '108_kgbv_quadN'
  location          text NOT NULL DEFAULT '', -- LOCATION as published: '108 Ave & King George Blvd'
  site_key          text NOT NULL,            -- normalised LOCATION (§2): '108 ave & king george blvd'
  kind              text NOT NULL CHECK (kind IN ('view', 'pano', 'quad')),
  heading           text CHECK (heading IN ('N','E','S','W')), -- from a quadN / cam1S suffix; NULL otherwise
  image_url         text NOT NULL,            -- trimmed, case preserved
  nvr               text,
  lat               double precision NOT NULL,
  lng               double precision NOT NULL,
  location_source   text NOT NULL DEFAULT 'arcgis' CHECK (location_source IN ('arcgis', 'manual')),
  -- Result of the sync-time probe (§6 step 3):
  image_status      integer,                  -- HTTP status of the HEAD; NULL before the first probe
  image_modified_at timestamptz,              -- its Last-Modified
  probed_at         timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  retired_at        timestamptz               -- set when absent from the layer; cleared if it returns
);

GRANT USAGE, SELECT ON surrey_cameras_id_seq TO roadsight_app;
```

Decisions:

- **The natural key is the camera name, not `OBJECTID`.** The five duplicate pairs have different object ids for the same camera, and ArcGIS may renumber object ids when the layer is republished.
- **`location_source='manual'` protects both `lat`/`lng` and `site_key`** from being overwritten by the sync. That is how the `108 Ave & 140 St` outlier gets fixed if anyone cares enough.
- **The probe result is stored, not only used to filter.** The source reads `image_status = 200` (§7). `image_modified_at` is the start of real staleness support if it is ever wanted. Vancouver §5 couldn't do this at all.
- **Nothing is deleted**, as in Vancouver.
- **No generic `municipal_cameras` table yet.** Two city-specific table sets is fine. Richmond would make three, and that is the point to fold them into one table with a `source` column (§9 q.6).

## 6. Sync — one script, three steps

```
node --env-file=.env.local scripts/sync-surrey-cameras.mjs
```

The same shape as `sync-vancouver-cameras.mjs`. Pure parsing lives in `web/lib/cameras/surrey/parse-layer.mjs`, with a committed fixture of ~20 records that covers every case in §2. No new dependencies.

**Step 1 — fetch** (1 request): `query?where=1=1&outFields=LOCATION,CAMERA_NAME,OWNER,IMAGE,NVR&outSR=4326&f=json`. Fail loudly if the response has `error`, `exceededTransferLimit: true`, or **fewer than 500 features**. That is the same tripwire as Vancouver's `MIN_VALID_PAGES`. If the operational layer returns a network error, retry once against the open-data copy and log that it was used.

**Step 2 — normalise** (pure):
1. Trim `IMAGE`. Drop records with no image or with a host other than `stcameleonprod.blob.core.windows.net` / `cosmos.surrey.ca` (this removes the provincial cameras).
2. `camera_key` = lower-cased `CAMERA_NAME`, or the filename stem when the name is null. Dedupe on it, preferring `OWNER='Surrey'`.
3. Derive `kind`, `heading` and `site_key` (§2).

**Step 3 — probe** (~640 `HEAD` requests, concurrency 8, ~15 s *measured*): store `image_status`, `image_modified_at` and `probed_at`. A timeout or network error leaves the previous probe result in place and does not retire anything: a failed request says nothing about the camera. If fewer than 400 images answer 200, the run stops before writing anything (§9 q.4).

**Step 4 — upsert** on `camera_key`: update everything except `lat`/`lng`/`site_key` when the row is `manual`. Set `retired_at` on rows missing from this run, and clear it on rows that came back. Print a summary: seen/new/retired, how many are live (200) and dead (404), how many frames are older than 30 min, and which `site_key`s changed.

Run it by hand for now, then daily in the same scheduled Action that Vancouver's Phase 3 plans. Daily rather than weekly because the probe is what keeps dead cards out of the grid, and cameras break more often than the list changes.

## 7. Fitting it into the app

Vancouver's Phase 2 already added a string `id`/`group`, a `source` field, `sourceKey`, `CompositeCameraSource` and per-source image URLs, so this source needs very little new code:

| Piece | Change |
|---|---|
| `CameraSourceName` | Add `"surrey"`. |
| `SurreyCameraSource` | A copy of `VancouverCameraSource` (1 h TTL, one query in flight, stale-while-error, no snapshot) reading `surrey_cameras WHERE retired_at IS NULL AND image_status = 200`. `id: "surrey:<id>"`, `group: "surrey:<site_key>"`, `sourceKey: image_url`, `name: location`, `orientation`: see §2, `credit: "City of Surrey"`, `updatePeriodSeconds: 300`, `lastUpdated: null`. If the two sources grow a third twin, extract the caching into a shared `PgCameraSource` base. |
| `catalogue.ts` | Add it to the composite under the same `DATABASE_URL` gate. |
| `cameraImageUrl` | Generalise `vancouverImageUrl` into a clock-bucketed URL for any source without a per-camera timestamp: Vancouver builds `base + sourceKey`, Surrey uses `sourceKey` directly (it is already a full URL). The 60 s bucket fits the 1–5 min refresh. |
| `CameraCard` | Nothing new: the attribution comes from `credit`, and 800×450 already matches the 16:9 box. Update the aspect comment. |
| `camerasAlongRoute` | No change to the logic. One thing to measure (Phase 2): with ~600 more candidates, a route along King George Blvd will run the `nearestOnPolyline` scan on each of them, the same cost Vancouver's measurements found. The chunked-bbox prefilter noted there is the fix if it matters. |
| Page footer | Add *"Intersection camera images © City of Surrey. Contains information licensed under the Open Government Licence – Surrey."*, linked to the licence page on `opendata-surrey.hub.arcgis.com`. |

**Fisheye frames.** 108 of the 643 cameras are `pano`, and a 360° fisheye is harder to read at card size than a normal view. Where a site has both, the card should show the `view` camera first. `dealByGroup` keeps input order within a site, and cameras at one site sit within a few metres of each other, so ordering the rows `kind = 'view'` first in the source's `SELECT` should be enough. Check this in Phase 2 on a real route rather than assuming it.

## 8. Phasing

**Phase 0 — record the traps** *(no app code)*
- [x] `test/httpYac/surrey-cameras.http`: both layer queries (count and a sample page), one live image plus its 304, a blob 404 (`enc_83A_140_cam1.jpg`), a `cosmos` 404, and the container-listing request with a comment explaining why it must not be used.

**Phase 1 — data** *(no UI change)*
- [x] `db/init/003_surrey_cameras.sql`
- [x] `lib/cameras/surrey/parse-layer.mjs` + fixture (`fixtures/layer-sample.json`: 23 live records covering every case in §2)
- [x] `scripts/sync-surrey-cameras.mjs`: fetch, normalise, probe, upsert, summary. Dry run on 2026-09-24 (no DB): 701 features → 643 cameras, 598 live, 508 sites, ~20 s.
- [x] Apply to `roadsight_dev`. Expected result: ~643 rows, ~595 live, 510 sites. Actual (2026-09-24): 643 rows, 598 live, 45 not 200, 508 sites, 8 frames older than 30 min.

**Phase 2 — the page**
- [x] `"surrey"` source name, `SurreyCameraSource`, composite, `cameraImageUrl`, footer. `vancouverImageUrl` became `clockBucketedUrl`, shared by both cities. The footer uses the licence's own attribution statement verbatim: *"Contains information licensed under the Open Government License – City of Surrey."* (its spelling, not "Licence – Surrey"). It links to the catalogue's licence page, `opendata-surrey.hub.arcgis.com/pages/55089a19491a4fe59a41e059fd8af708`.
- [x] Measure, as in Vancouver's Phase 2: a Surrey-origin route (Surrey Central → Waterfront, Guildford → Langley, White Rock → YVR). Record matches per source, match time, the km of the first card, and how many `pano` cards appear. Results below.

*Measured 2026-09-24*: live DriveBC (1066), plus `roadsight_dev` with 844 Vancouver cameras and 598 Surrey cameras (502 view, 81 pano, 7 quad, 8 with a heading). Routes come from Azure Maps, and the corridor is the default 200 m with `MAX_CAMERAS = 40`, thinned as the grid thins them. Match time is the warm median of 20 runs at the server's 500 m.

| Route | Matched at 200 m (DriveBC + Van + Surrey) | Shown (same) | Match time, before → after | First card km, before → after | `pano` cards shown |
|---|---|---|---|---|---|
| Surrey Central → Waterfront (34.8 km) | 9 + 54 + 23 | 9 + 17 + 14 | 30.1 → 57.4 ms | 6.0 → **0.1** | 1 |
| Guildford → Langley (17.7 km) | 12 + 0 + 11 | 12 + 0 + 11 | 2.6 → 10.2 ms | 5.6 → **0.2** | 1 |
| White Rock → YVR (42.7 km) | 26 + 0 + 7 | 26 + 0 + 7 | 14.0 → 47.4 ms | 5.2 → 1.3 | 0 |
| Surrey Central → Newton, King George Blvd (7.2 km) | 0 + 0 + 48 | 0 + 0 + 40 | 0.1 → 2.4 ms | none → **0.0** | 9 |

Findings:
- **The gap is filled.** All three Surrey-origin routes now open within 1.3 km instead of 5–6 km, and King George Blvd, which had no cameras at all, now has 40.
- **§9 q.5 holds: the highway is not starved.** DriveBC keeps every camera it had on all three mixed routes. On Surrey Central → Waterfront the Surrey cameras take their slots from Vancouver's (31 → 17), not from DriveBC's.
- **Match time roughly doubles or triples**, to ~57 ms at most. That is the same cost that Vancouver's Phase 2 found, and the same chunked-bbox fix applies if it ever matters.
- **Fisheyes rarely lead a site.** 9 of 40 cards on King George Blvd are `pano`, but 8 of them are at sites that have no other camera. In one case a pano is shown ahead of a conventional view at the same site: `96 Ave & King George Blvd`, where the pano is 4 m from the road and the views 35 m and 135 m. §7 assumed the `SELECT` order (`kind = 'view'` first) would decide this. It doesn't: `thin` re-sorts each stretch by distance from the road before `dealByGroup`, so the `SELECT` order only settles exact ties. The order is kept as a tiebreak. Changing `thin` to prefer non-pano cameras isn't worth it for one card in 40.

**Phase 3 — later, if needed**
- [ ] Scheduled daily sync (shared with Vancouver's)
- [ ] Mark a card stale when `image_modified_at` at the last probe was more than 30 min old
- [ ] `cosmos` relocation, once §9 q.3 is answered
- [ ] Township of Langley on the same code (§9 q.6)

## 9. Open questions & risks

1. **Terms of use.** The open-data catalogue says its datasets are under the Open Government Licence – Surrey, and the traffic-cameras dataset is in that catalogue. The licence covers the *records* (locations, names, image URLs). The frames are hotlinked from the viewer's browser and never proxied or copied, which is the same position as DriveBC and Vancouver. Attribute as the licence asks (§7). This is on firmer ground than Vancouver, where there is no licence at all.
2. **The listable container and its archive** (§3). It is useful for the future analysis service (a month of frames at 15-minute intervals), but reading it goes beyond hotlinking a live image, and the City probably doesn't know it is open. Don't build on it without asking the City's TMC. Asking might also get it closed, which costs this plan nothing.
3. **The 23 `cosmos` cameras.** Are the blob copies under `TMCNVRnn` live cameras whose layer record was never updated, or leftovers from an archive job? The 8–70 min ages point to the second. A second probe on another day would settle it: if their `Last-Modified` keeps advancing on a 1–5 min cadence, relocation is safe.
4. **The operational endpoint is internal.** `gisservices.surrey.ca` is behind the City's own map, not a published API. The fallback to the open-data copy (§6 step 1) covers that. What would break both is a change of image host: then every probe would 404, and the summary line (live count far below ~595) should catch it. Consider failing the run if fewer than 400 cameras are live.
5. **More candidates share `MAX_CAMERAS = 40`.** A route that crosses Surrey on Highway 1 now gets intersections a few hundred metres off the highway at every interchange. The 200 m default corridor handles most of this, and the Phase 2 measurements will show whether it's enough.
6. **Langley, Richmond, and generic tables.** Langley's layer is the same kind of ArcGIS query, with `pic_url`, a direction in the HTML `name` (`(Looking West)`) and a per-camera `timeString`. `parse-layer.mjs` and the probe step would cover it with a different field mapping. Richmond is a Vancouver-style crawl. By the third municipal source, `surrey_cameras` and `vancouver_*` should become one `municipal_cameras (source, …)` table and one `PgCameraSource`. That is a migration of data that is already live, so it should be its own PR, not part of this one.
7. **Data quality belongs to the City.** Typos (`colebrook_125a` at 123 St), a misplaced point (`108 Ave & 140 St`), inconsistent `And`/`&`. Show the names as published and normalise only the grouping key, as in Vancouver §8.5.
