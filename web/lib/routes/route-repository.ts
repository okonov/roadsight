import { Route } from "./types";

export type NewRoute = { name: string; description: string };

export type RoutePatch = Partial<
  Omit<Route, "id" | "userId" | "createdAt" | "updatedAt">
>;

export interface RouteRepository {
  list(userId: string): Promise<Route[]>;
  get(userId: string, id: string): Promise<Route | null>;
  create(userId: string, input: NewRoute): Promise<Route>;
  update(userId: string, id: string, patch: RoutePatch): Promise<Route | null>;
  remove(userId: string, id: string): Promise<boolean>;
}
