// The shapes the server's JSON API returns, shared so the server and its clients agree on them.
import type { CalView } from "./calendar.ts";
import type { List } from "./tasks.ts";

export type Integrations = {
  manager: boolean;
  icsToken: string | null;
  syncToken: string | null;
  discord: boolean;
  notion: boolean;
  google: { available: boolean; linked: boolean; connected: boolean; mine: boolean };
  syncedAt: number | null;
  syncError: string | null;
};

export type Share = { token: string; view: CalView; at: string };

// What a calendar link shows: one shared period (locked) or a workspace's whole calendar.
export type SharedView = { lists: List[]; start?: { view: CalView; at: string }; locked: boolean };

// `verifiesEmail`: the server sends confirmation emails, and unconfirmed accounts are deleted after 7 days.
export type Config = { github: boolean; google: boolean; verifiesEmail?: boolean };
