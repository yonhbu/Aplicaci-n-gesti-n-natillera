/** Presentation only. Stored civil dates and operation payloads remain ISO. */
export function displayDate(iso: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : iso;
}
