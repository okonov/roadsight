import { randomUUID } from "crypto";
import { User } from "./types";

// Mock auth only — plaintext passwords in an in-memory map are fine for this POC's
// Credentials provider, but this whole file is disposable once real Entra External ID
// auth is wired in.
const globalForUsers = globalThis as unknown as {
  userStore?: Map<string, User>;
};

const users: Map<string, User> =
  globalForUsers.userStore ?? new Map<string, User>();

if (process.env.NODE_ENV !== "production") {
  globalForUsers.userStore = users;
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function findUser(email: string): User | undefined {
  return users.get(normalize(email));
}

export function createUser(input: {
  email: string;
  password: string;
  name?: string;
}): User {
  const email = normalize(input.email);
  if (users.has(email)) {
    throw new Error("User already exists");
  }
  const user: User = { id: randomUUID(), email, password: input.password, name: input.name };
  users.set(email, user);
  return user;
}
