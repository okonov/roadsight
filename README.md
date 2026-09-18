# RoadSight

RoadSight is a proof-of-concept and coding exercise to get familiar with several technologies; it also serves as a portfolio application.

The application lets a user create routes and check images from publicly available traffic cameras along them. It is geographically limited to the province of BC, with a possible later extension to the state of WA.

## Documentation
- [Add Route — design & implementation plan](docs/add-route-design.md)
- [Route Cameras — design & implementation](docs/route-cameras-design.md)

## User stories

### Add route
- The user describes a route in plain language, e.g. `Lougheed Mall to Squamish waterfall`.
- The user checks that the origin and destination were resolved correctly, then confirms the route.

Underlying processing:
1. The web app creates a `draft` route record in the DB and saves the description (`POST /api/routes`).
2. The description is sent to Azure Foundry, which returns formal origin/destination *place names*; Azure Maps then geocodes those names to latitude/longitude. The route becomes `resolved` (`POST /api/routes/[id]/resolve`).
3. The page shows the origin and destination on a static map for the user to review; the user can go back and edit the description, or confirm.
4. On confirm, the coordinates are sent to Azure Maps for directions; the recommended route's polyline, distance and duration are saved to the route record and it becomes `confirmed` (`POST /api/routes/[id]/confirm`).

The polyline is persisted as a GeoJSON `LineString` in a `jsonb` column of the `routes` table — plain Postgres was confirmed as sufficient, no PostGIS.

### Cameras along a route
- Once a route is confirmed, the route detail page (`/routes/[id]`) shows the current DriveBC camera images along it, in travel order.

Cameras within a 2 km corridor of the polyline are selected and ordered by distance from the origin (capped at 40). Images are loaded by the browser directly from DriveBC; camera liveness is taken from the catalogue metadata, not from the image response, because DriveBC answers dark cameras with a 200 placeholder.

## Tech stack

### Infrastructure (Azure)
- **Authentication:** Microsoft Entra External ID (via Auth.js / next-auth v5)
- **Hosting:** Azure App Service (`roadsight-webapp`), deployed from GitHub Actions on push to `main`
- **Route planning & geocoding & static maps:** Azure Maps
- **NL parsing of the route description:** Azure Foundry (`gpt-oss-120b` deployment, structured JSON output)
- **DB:** Azure Database for PostgreSQL flexible server (`roadsightpostgres` / `roadsight_dev`) in the cloud; `postgres:17` in Docker for local development

Every external dependency has a local fallback so the app runs with no Azure account at all: an in-memory route repository without `DATABASE_URL`, a mock resolver without the Foundry + Maps keys, a mock planner without the Maps key, and a committed DriveBC camera snapshot when DriveBC is unreachable. See [web/.env.local.example](web/.env.local.example).

### Traffic camera source
The camera catalogue comes from DriveBC's live JSON API, `https://www.drivebc.ca/api/webcams/` (~1060 cameras, fetched server-side and cached for an hour), with images at `https://www.drivebc.ca/images/{id}.jpg`. The [BC HighwayCams open-data set](https://catalogue.data.gov.bc.ca/dataset/bc-highwaycams) was evaluated and rejected — its image URLs return a placeholder for every camera — and the Open511 API is not used. Details in [docs/route-cameras-design.md](docs/route-cameras-design.md).

### Languages and frameworks
- **Web:** Next.js (App Router), TypeScript, Tailwind CSS
- **Backend:** all server logic currently lives in the Next.js app (route handlers + server components). Separate auxiliary services in .NET/C# remain a possibility; the repository layer is designed so routes could move behind an HTTP service without touching other code.

### Repository
GitHub

### Deployment
- **Web app:** GitHub Actions ([azure-webapp-deploy.yml](.github/workflows/azure-webapp-deploy.yml)) builds `web/` and deploys it to Azure App Service with a publish profile. No container image is involved.
- **Docker:** used for local development only — [docker-compose.yml](docker-compose.yml) runs Postgres and applies [db/init/](db/init/) on first start.

### Not yet implemented
- AI analysis of webcam images (planned for Azure Foundry)
- WA extension

## Setup
Docker is used for local development.  
Install WSL2. PowerShell (admin):
```
wsl --install
```
Check WSL2 is installed
```
wsl --list --verbose
```

Start the local database and the web app:
```
docker compose up -d
cd web
copy .env.local.example .env.local   # fill in the Entra ID values; the rest are optional
npm install
npm run dev
```
Open http://localhost:3000.
