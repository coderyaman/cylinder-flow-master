/**
 * Sunucu tarafı PDF geçerlilik denetimi.
 * Yalnızca "%PDF-" başlığı yeterli değildir: bozuk, kesilmiş veya sahte başlıklı
 * dosyalar reddedilir. Gövdede nesne sözlüğü, çapraz başvuru işaretçisi ve dosya
 * sonu işareti aranır.
 */
export type PdfCheck = { ok: true } | { ok: false; reason: string };

const MIN_BYTES = 400;

function ascii(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return s;
}

export async function validatePdf(blob: Blob): Promise<PdfCheck> {
  const size = blob.size;
  if (size < MIN_BYTES) {
    return { ok: false, reason: "Dosya geçerli bir PDF olamayacak kadar küçük." };
  }

  const head = ascii(new Uint8Array(await blob.slice(0, 1024).arrayBuffer()));
  if (!/^%PDF-\d\.\d/.test(head)) {
    return { ok: false, reason: "Dosya başlığı PDF sürüm bilgisi taşımıyor." };
  }

  const tailBytes = Math.min(size, 4096);
  const tail = ascii(new Uint8Array(await blob.slice(size - tailBytes).arrayBuffer()));
  if (!tail.includes("%%EOF")) {
    return { ok: false, reason: "Dosya sonu işareti yok; dosya kesilmiş görünüyor." };
  }
  if (!tail.includes("startxref")) {
    return { ok: false, reason: "Çapraz başvuru işaretçisi yok; dosya bozuk görünüyor." };
  }

  // Gövdede en az bir nesne ve belge kökü bulunmalıdır.
  const scanSize = Math.min(size, 4 * 1024 * 1024);
  const body = ascii(new Uint8Array(await blob.slice(0, scanSize).arrayBuffer())) + tail;
  if (!/\d+\s+\d+\s+obj/.test(body)) {
    return { ok: false, reason: "PDF nesnesi bulunamadı; dosya geçerli bir PDF değil." };
  }
  if (!body.includes("/Root") && !body.includes("/Catalog")) {
    return { ok: false, reason: "Belge kökü yok; dosya geçerli bir PDF değil." };
  }

  return { ok: true };
}
