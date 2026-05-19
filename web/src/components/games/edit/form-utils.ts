import type { GameRecord } from "../../../lib/schema";
import type { EditPatch } from "../../../lib/edits";
import type { FormState } from "./types";

export function gameToForm(g: GameRecord): FormState {
  return {
    genre: g.genre ?? "",
    type_game: (g.type_game as FormState["type_game"]) ?? "",
    anti_cheat: g.anti_cheat ?? "",
    anti_cheat_note: g.anti_cheat_note ?? "",
    is_kernel_ac:
      g.is_kernel_ac === true ? "yes" : g.is_kernel_ac === false ? "no" : "unknown",
    notes: g.notes ?? "",
    safe: (g.safe as FormState["safe"]) ?? "?",
    status: (g.status === "delisted" ? "delisted" : "active") as FormState["status"],
  };
}

export function formToPatch(g: GameRecord, form: FormState): EditPatch {
  const patch: EditPatch = {};
  const isKernelAC =
    form.is_kernel_ac === "yes" ? true : form.is_kernel_ac === "no" ? false : null;

  if (form.genre !== (g.genre ?? "")) patch.genre = form.genre;
  if (form.type_game !== (g.type_game ?? "")) patch.type_game = form.type_game;
  if (form.anti_cheat !== (g.anti_cheat ?? "")) patch.anti_cheat = form.anti_cheat;
  if (form.anti_cheat_note !== (g.anti_cheat_note ?? ""))
    patch.anti_cheat_note = form.anti_cheat_note;
  if (isKernelAC !== (g.is_kernel_ac ?? null)) patch.is_kernel_ac = isKernelAC;
  if (form.notes !== (g.notes ?? "")) patch.notes = form.notes;
  if (form.safe !== (g.safe ?? "?")) patch.safe = form.safe;
  if (form.status !== (g.status === "delisted" ? "delisted" : "active"))
    patch.status = form.status;
  return patch;
}
