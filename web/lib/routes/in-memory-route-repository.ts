import { randomUUID } from "crypto";
import { Route } from "./types";
import { RouteRepository } from "./route-repository";

export class InMemoryRouteRepository implements RouteRepository {
  private routesByUser = new Map<string, Route[]>();

  async list(userId: string): Promise<Route[]> {
    return this.routesByUser.get(userId) ?? [];
  }

  async create(userId: string, name: string): Promise<Route> {
    const route: Route = { id: randomUUID(), userId, name };
    const existing = this.routesByUser.get(userId) ?? [];
    this.routesByUser.set(userId, [...existing, route]);
    return route;
  }

  async update(userId: string, id: string, name: string): Promise<Route | null> {
    const list = this.routesByUser.get(userId) ?? [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const updated = { ...list[idx], name };
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
