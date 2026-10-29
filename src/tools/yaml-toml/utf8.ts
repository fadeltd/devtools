/**
 * The UTF-8 size of a string, counted without encoding it.
 *
 * `new Blob([text]).size` and `TextEncoder` both allocate the whole encoding
 * just to read its length; on a multi-MB paste that is a copy per render. A
 * lone surrogate counts 3, because both encode it as U+FFFD.
 */
export function utf8Length(text: string): number {
  let n = 0
  const len = text.length
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}
