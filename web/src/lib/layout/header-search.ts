/**
 * Whether typing in the header search takes the reader to /games, where the
 * box filters the table.
 *
 * Not while an input method is still composing. A Japanese, Chinese or Korean
 * reader's first keystroke is a kana or jamo they have not chosen yet, and the
 * jump used to come right then, mid-word; it now waits for compositionend.
 * Only the jump waits: the value itself is still written on every keystroke,
 * because Android keyboards compose Latin words too, and holding the value
 * back would stop the table filtering as an English reader types.
 */
export function jumpsToGames(search: string, pathname: string, composing: boolean): boolean {
  return !composing && search !== "" && !pathname.startsWith("/games");
}
