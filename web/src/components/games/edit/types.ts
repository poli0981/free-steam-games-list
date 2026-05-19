export interface FormState {
  genre: string;
  type_game: "online" | "offline" | "";
  anti_cheat: string;
  anti_cheat_note: string;
  is_kernel_ac: "yes" | "no" | "unknown";
  notes: string;
  safe: "y" | "n" | "?" | "";
  status: "active" | "delisted";
}

export type View = "form" | "json";
