/**
 * Curated enums for dropdowns. Mirrors what's known/expected by the Python
 * pipeline so manual edits stay compatible with what the daily refetch
 * produces.
 *
 *   ANTI_CHEAT_ENUM — keys of ANTI_CHEAT_PATTERNS in scripts/core/constants.py:45
 *                     (extend both sides if you add a new AC).
 *   GENRE_ENUM     — curated short list of common Steam genre buckets.
 *                     Combobox-style: free-text new entries are allowed.
 *   TYPE_GAME_ENUM — fixed.
 *   SAFE_ENUM      — fixed.
 *   STATUS_ENUM    — fixed.
 */

export const ANTI_CHEAT_ENUM = [
  "-",
  "VAC",
  "EAC",
  "BattlEye",
  "Vanguard",
  "PunkBuster",
  "nProtect",
  "XIGNCODE",
  "Ricochet",
  "mHyprot",
  "FACEIT AC",
  "Denuvo AC",
  "KSS",
  "NetEase GS",
  "Hyperion",
] as const;

export type AntiCheatValue = (typeof ANTI_CHEAT_ENUM)[number];

/**
 * Common Steam genres, curated. Rendered as a combobox where users can pick
 * one of these or type a new value. The free-text fallback handles the
 * occasional one-off genre the daily pipeline derives from Steam tags.
 */
export const GENRE_ENUM = [
  "Action",
  "Action RPG",
  "Action-Adventure",
  "Adventure",
  "Arcade",
  "Auto Battler",
  "Battle Royale",
  "Beat 'em up",
  "Bullet Hell",
  "Card Game",
  "Casual",
  "Clicker",
  "Co-op",
  "Educational",
  "Family",
  "Fighting",
  "First-Person",
  "FPS",
  "Hack & Slash",
  "Hero Shooter",
  "Hidden Object",
  "Horror",
  "Idle",
  "MMO",
  "MMORPG",
  "MOBA",
  "Music",
  "Open World",
  "Party",
  "Platformer",
  "Puzzle",
  "Racing",
  "Real-Time Strategy",
  "Roguelike",
  "Roguelite",
  "RPG",
  "RTS",
  "Sandbox",
  "Shooter",
  "Simulation",
  "Sports",
  "Stealth",
  "Strategy",
  "Survival",
  "Survival Horror",
  "Tactical",
  "Tactical RPG",
  "Third-person Shooter",
  "Top-down Shooter",
  "Tower Defense",
  "TPS",
  "Trivia",
  "Turn-based RPG",
  "Turn-based Strategy",
  "Turn-based Tactics",
  "Visual Novel",
  "VR",
  "Walking Simulator",
] as const;

export type GenreValue = (typeof GENRE_ENUM)[number];

export const TYPE_GAME_ENUM = ["", "online", "offline"] as const;
export type TypeGameValue = (typeof TYPE_GAME_ENUM)[number];

export const SAFE_ENUM = ["?", "y", "n"] as const;
export type SafeValue = (typeof SAFE_ENUM)[number];

export const STATUS_ENUM = ["active", "delisted"] as const;
export type StatusValue = (typeof STATUS_ENUM)[number];

export function isKnownGenre(g: string): g is GenreValue {
  return (GENRE_ENUM as readonly string[]).includes(g);
}

export function isKnownAntiCheat(g: string): g is AntiCheatValue {
  return (ANTI_CHEAT_ENUM as readonly string[]).includes(g);
}
