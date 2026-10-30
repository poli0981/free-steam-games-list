/**
 * Folding for SEARCH only. What a reader types and what a game is called are
 * compared after both pass through here, so ﾄﾛｲ (half-width), とろい
 * (hiragana) and トロイ find the same game, and a full-width ４ or ： matches
 * its ASCII twin. The catalogue holds games in every language since v4.6.0,
 * and a Japanese or Chinese keyboard types full-width forms by default.
 *
 * NFKC, then hiragana to katakana. Never applied to stored text: NFKC also
 * rewrites U+3000 and half-width kana, which the pipeline keeps as spelling.
 *
 * Not Fuse's `ignoreDiacritics`: its strip set includes the combining
 * (han)dakuten, which would make ガ equal カ.
 */

/** ぁ..ゖ and ゝゞ sit exactly 0x60 below their katakana. */
const KATAKANA_OFFSET = 0x60;

function isHiragana(code: number): boolean {
  return (code >= 0x3041 && code <= 0x3096) || code === 0x309d || code === 0x309e;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if ((text.codePointAt(i) ?? 0) > 0x7f) return false;
  }
  return true;
}

/** The text in the form both sides of a search are compared in. Case is left
 *  alone: Fuse lowercases both sides itself, and searchKey() does it for the
 *  plain substring searches. */
export function fold(text: string): string {
  // Nearly the whole catalogue is ASCII, which neither step changes.
  if (isAscii(text)) return text;
  let out = "";
  for (const ch of text.normalize("NFKC")) {
    const code = ch.codePointAt(0) ?? 0;
    out += isHiragana(code) ? String.fromCodePoint(code + KATAKANA_OFFSET) : ch;
  }
  return out;
}

/** fold() and lowercase: the key a plain `includes()` search compares. */
export function searchKey(text: string): string {
  return fold(text).toLowerCase();
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** One kanji, kana or Hangul syllable is already a word; one Latin letter is
 *  not. Where a search waits for two characters, a CJK one is enough. */
export function longEnough(query: string, min: number): boolean {
  return query.length >= min || CJK.test(query);
}
