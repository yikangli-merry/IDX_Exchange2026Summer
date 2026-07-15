import type { ActiveListing } from "./mlsQueries.ts";

export interface UserSession {
  city?: string;
  maxPrice?: number;
  beds?: number;
  baths?: number;
  type?: string;
  pool?: "True";
  lastResults?: ActiveListing[];
  conversationStep: number;
  currentPage?: number;
}

const sessions = new Map<string, UserSession>();

export function getSession(userId: string): UserSession {
  if (!sessions.has(userId)) {
    sessions.set(userId, { conversationStep: 0, lastResults: [] });
  }

  return sessions.get(userId)!;
}

export function updateSession(userId: string, updates: Partial<UserSession>): UserSession {
  const session = getSession(userId);
  const nextSession = { ...session, ...updates };
  sessions.set(userId, nextSession);
  return nextSession;
}

export function clearSession(userId: string): void {
  sessions.delete(userId);
}
