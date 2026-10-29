/**
 * Hand the viewer a file to save. Nothing leaves the browser: the bytes go
 * from memory to an object URL to the download bar.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  // The click has started the download; the URL is no longer needed.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
