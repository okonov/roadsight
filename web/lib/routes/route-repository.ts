import { Route } from "./types";

export interface RouteRepository {
  list(userId: string): Promise<Route[]>;
  create(userId: string, name: string): Promise<Route>;
  update(userId: string, id: string, name: string): Promise<Route | null>;
  remove(userId: string, id: string): Promise<boolean>;
}
