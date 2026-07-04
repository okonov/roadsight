import { randomUUID } from "crypto";
import { Route } from "./types";
import { NewRoute, RoutePatch, RouteRepository } from "./route-repository";

export class InMemoryRouteRepository implements RouteRepository {
  private routesByUser = new Map<string, Route[]>();

  async list(userId: string): Promise<Route[]> {
    return this.routesByUser.get(userId) ?? [];
  }

  async get(userId: string, id: string): Promise<Route | null> {
    const list = this.routesByUser.get(userId) ?? [];
    return list.find((r) => r.id === id) ?? null;
  }

  async create(userId: string, input: NewRoute): Promise<Route> {
    const now = new Date().toISOString();
    const route: Route = {
      id: randomUUID(),
      userId,
      name: input.name,
      description: input.description,
      status: "draft",
      origin: null,
      destination: null,
      polyline: null,
      distanceMeters: null,
      durationSeconds: null,
      createdAt: now,
      updatedAt: now,
    };
    const existing = this.routesByUser.get(userId) ?? [];
    this.routesByUser.set(userId, [...existing, route]);
    return route;
  }

  async update(userId: string, id: string, patch: RoutePatch): Promise<Route | null> {
    const list = this.routesByUser.get(userId) ?? [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const updated: Route = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
    list[idx] = updated;
    return updated;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const list = this.routesByUser.get(userId) ?? [];
    const next = list.filter((r) => r.id !== id);
    const removed = next.length !== list.length;
    this.routesByUser.set(userId, next);
    return removed;
  }
}
