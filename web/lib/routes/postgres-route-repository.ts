import { Pool } from "pg";
import { ResolvedPlace, Route, RoutePolyline, RouteStatus } from "./types";
import { NewRoute, RoutePatch, RouteRepository } from "./route-repository";

interface RouteRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: RouteStatus;
  origin_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  polyline: RoutePolyline | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  created_at: Date;
  updated_at: Date;
}

function toPlace(
  label: string | null,
  lat: number | null,
  lng: number | null,
): ResolvedPlace | null {
  if (label === null || lat === null || lng === null) return null;
  return { label, lat, lng };
}

function toRoute(row: RouteRow): Route {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    status: row.status,
    origin: toPlace(row.origin_label, row.origin_lat, row.origin_lng),
    destination: toPlace(row.destination_label, row.destination_lat, row.destination_lng),
    polyline: row.polyline,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresRouteRepository implements RouteRepository {
  constructor(private pool: Pool) {}

  async list(userId: string): Promise<Route[]> {
    const result = await this.pool.query<RouteRow>(
      "SELECT * FROM routes WHERE user_id = $1 ORDER BY created_at",
      [userId],
    );
    return result.rows.map(toRoute);
  }

  async get(userId: string, id: string): Promise<Route | null> {
    const result = await this.pool.query<RouteRow>(
      "SELECT * FROM routes WHERE user_id = $1 AND id = $2",
      [userId, id],
    );
    return result.rows[0] ? toRoute(result.rows[0]) : null;
  }

  async create(userId: string, input: NewRoute): Promise<Route> {
    const result = await this.pool.query<RouteRow>(
      "INSERT INTO routes (user_id, name, description) VALUES ($1, $2, $3) RETURNING *",
      [userId, input.name, input.description],
    );
    return toRoute(result.rows[0]);
  }

  // Read-modify-write: merge the patch in JS and write all columns back. Avoids
  // dynamic SET-clause building; no optimistic locking (acceptable single-user POC).
  async update(userId: string, id: string, patch: RoutePatch): Promise<Route | null> {
    const current = await this.get(userId, id);
    if (!current) return null;
    const merged: Route = { ...current, ...patch };

    const result = await this.pool.query<RouteRow>(
      `UPDATE routes SET
         name = $1, description = $2, status = $3,
         origin_label = $4, origin_lat = $5, origin_lng = $6,
         destination_label = $7, destination_lat = $8, destination_lng = $9,
         polyline = $10, distance_meters = $11, duration_seconds = $12,
         updated_at = now()
       WHERE user_id = $13 AND id = $14
       RETURNING *`,
      [
        merged.name,
        merged.description,
        merged.status,
        merged.origin?.label ?? null,
        merged.origin?.lat ?? null,
        merged.origin?.lng ?? null,
        merged.destination?.label ?? null,
        merged.destination?.lat ?? null,
        merged.destination?.lng ?? null,
        merged.polyline ? JSON.stringify(merged.polyline) : null,
        merged.distanceMeters,
        merged.durationSeconds,
        userId,
        id,
      ],
    );
    return result.rows[0] ? toRoute(result.rows[0]) : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM routes WHERE user_id = $1 AND id = $2",
      [userId, id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
