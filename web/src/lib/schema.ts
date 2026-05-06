/**
 * Schema constants — port of scripts/core/constants.py.
 * Keep MANUAL_FIELDS, ARRAY_FIELDS, EXTENSION_FIELDS in sync with the Python source.
 */

export const REPO_OWNER = "poli0981";
export const REPO_NAME = "free-steam-games-list";
export const DEFAULT_BRANCH = "main";

/**
 * Only this GitHub login sees the edit/add/delete UI. Visitors signed in
 * with their own PATs would fail at API write anyway, but we hide the UI
 * to keep the experience unambiguous for non-owners.
 */
export const OWNER_LOGIN = "poli0981";

export const DATA_DIR = "data";
export const SHARD_PREFIX = "data_";
export const MAX_RECORDS_PER_FILE = 800;

export const TEMP_JSONL = "scripts/temp_info.jsonl";
export const REMOVED_JSONL = "scripts/removed_games.jsonl";

export const MANUAL_FIELDS = [
  "anti_cheat",
  "anti_cheat_note",
  "is_kernel_ac",
  "notes",
  "type_game",
  "safe",
  "genre",
] as const;

export const ARRAY_FIELDS = [
  "platforms",
  "languages",
  "language_details",
  "tags",
  "developer",
  "publisher",
] as const;

export const EXTENSION_FIELDS = [
  "name",
  "genre",
  "type_game",
  "has_paid_dlc",
  "developer",
  "publisher",
  "release_date",
  "description",
  "header_image",
  "anti_cheat",
  "anti_cheat_note",
  "is_kernel_ac",
  "platforms",
  "languages",
  "language_details",
  "tags",
  "notes",
  "safe",
] as const;

export const SKIP_GENRE_TAGS = new Set([
  "Free to Play",
  "Indie",
  "Casual",
  "Early Access",
  "Multiplayer",
  "Singleplayer",
  "Co-op",
  "Online Co-Op",
  "PvP",
  "Cross-Platform Multiplayer",
  "In-App Purchases",
  "Massively Multiplayer",
  "Competitive",
]);

export type ManualField = (typeof MANUAL_FIELDS)[number];
export type GameStatus = "active" | "delisted" | "queued" | "unknown";
export type GameType = "online" | "offline" | "";
export type Safe = "y" | "n" | "?" | "";

export interface LanguageDetail {
  name: string;
  interface: boolean;
  audio: boolean;
  subtitles: boolean;
}

export interface GameRecord {
  link: string;
  name: string;
  description: string;
  header_image: string;
  genre: string;
  type_game: GameType;
  has_paid_dlc: boolean;
  developer: string[];
  publisher: string[];
  release_date: string;
  reviews: string;
  current_players: string;
  peak_today: string;
  metacritic: string;
  anti_cheat: string;
  anti_cheat_note: string;
  is_kernel_ac: boolean | null;
  platforms: string[];
  languages: string[];
  language_details: LanguageDetail[];
  tags: string[];
  drm_notes: string;
  notes: string;
  safe: Safe;
  status: GameStatus;
  last_updated: string;
  added_at: string;
}

export interface ShardManifestEntry {
  name: string;
  count: number;
}

export interface DataIndex {
  max_per_file: number;
  total: number;
  last_updated: string;
  files: ShardManifestEntry[];
}

export const SKELETON_TEMPLATE: GameRecord = {
  link: "",
  name: "",
  description: "",
  header_image: "",
  genre: "",
  type_game: "",
  has_paid_dlc: false,
  developer: [],
  publisher: [],
  release_date: "",
  reviews: "N/A",
  current_players: "N/A",
  peak_today: "N/A",
  metacritic: "N/A",
  anti_cheat: "-",
  anti_cheat_note: "",
  is_kernel_ac: null,
  platforms: [],
  languages: [],
  language_details: [],
  tags: [],
  drm_notes: "-",
  notes: "",
  safe: "?",
  status: "active",
  last_updated: "",
  added_at: "",
};

export function isManualField(key: string): key is ManualField {
  return (MANUAL_FIELDS as readonly string[]).includes(key);
}

export function isArrayField(key: string): boolean {
  return (ARRAY_FIELDS as readonly string[]).includes(key);
}
