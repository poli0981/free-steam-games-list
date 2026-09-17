/**
 * The seven human-judgement fields as the edit screens present them, and the
 * client-side mirror of validateValue() in worker/routes/edit.ts.
 *
 * The mirror exists so a reviewer is told before a commit is attempted. It
 * is the weakest of three copies: the Worker re-validates, and the Python
 * validator in scripts/core/overrides.py is the authority. fields.test.ts runs
 * both TypeScript copies over the same inputs and fails if they disagree.
 */
import { MANUAL_FIELDS, type ManualField } from "../../../shared/admin-api";

export { MANUAL_FIELDS };

export interface FieldSpec {
  key: ManualField;
  label: string;
  kind: "genre" | "select" | "text" | "area";
  options?: { value: string; label: string }[];
  hint?: string;
}

export const FIELDS: FieldSpec[] = [
  { key: "genre", label: "Genre", kind: "genre", hint: "Pick from the catalogue's genres, or type a new one." },
  {
    key: "type_game",
    label: "Type",
    kind: "select",
    options: [
      { value: "online", label: "online" },
      { value: "offline", label: "offline" },
    ],
  },
  {
    key: "safe",
    label: "Safe",
    kind: "select",
    options: [
      { value: "y", label: "y · safe" },
      { value: "n", label: "n · not safe" },
      { value: "?", label: "? · not reviewed" },
    ],
  },
  { key: "anti_cheat", label: "Anti-cheat", kind: "text", hint: "For example: EasyAntiCheat, BattlEye, VAC." },
  {
    key: "is_kernel_ac",
    label: "Kernel anti-cheat",
    kind: "select",
    options: [
      { value: "true", label: "true · kernel level" },
      { value: "false", label: "false · user mode or none" },
      { value: "null", label: "null · unknown" },
    ],
  },
  { key: "anti_cheat_note", label: "Anti-cheat note", kind: "area" },
  { key: "notes", label: "Notes", kind: "area" },
];

export const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<ManualField, string>;

/** A stored value as a form control holds it. */
export function toForm(field: ManualField, value: unknown): string {
  if (field === "is_kernel_ac") return value === true ? "true" : value === false ? "false" : "null";
  return value === null || value === undefined ? "" : String(value);
}

/** A form control's text as the API expects it. */
export function toWire(field: ManualField, text: string): unknown {
  if (field === "is_kernel_ac") return text === "true" ? true : text === "false" ? false : null;
  return text.trim();
}

/** null when the value may be saved, else why not. */
export function validate(field: ManualField, text: string): string | null {
  if (field === "is_kernel_ac") {
    return ["true", "false", "null"].includes(text) ? null : "must be true, false or null";
  }
  const value = text.trim();
  if (!value) return "empty - retire the field instead of blanking it";
  if (field === "type_game" && value !== "online" && value !== "offline") return "must be 'online' or 'offline'";
  if (field === "safe" && !["y", "n", "?"].includes(value)) return "must be 'y', 'n' or '?'";
  if (value.length > 500) return "longer than 500 characters";
  return null;
}
