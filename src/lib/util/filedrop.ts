export interface DroppedFile {
  name: string
  text: string
  bytes: number
}

export const MAX_DROP_BYTES = 8_000_000

export type DropResult =
  | { ok: true; file: DroppedFile }
  | { ok: false; reason: string }

/** Read a dropped or picked file as text, rejecting on size BEFORE reading. */
export async function readTextFile(file: File): Promise<DropResult> {
  if (file.size > MAX_DROP_BYTES) {
    return {
      ok: false,
      reason: `“${file.name}” is ${(file.size / 1_000_000).toFixed(1)} MB. The limit is 8 MB.`,
    }
  }
  try {
    const text = await file.text()
    return { ok: true, file: { name: file.name, text, bytes: file.size } }
  } catch {
    return { ok: false, reason: `Could not read “${file.name}”.` }
  }
}
