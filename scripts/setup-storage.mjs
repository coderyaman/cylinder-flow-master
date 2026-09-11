#!/usr/bin/env node
// Tekrarlanabilir kurulum: özel `grafik-pdf` depolama alanı.
// Kullanım: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/setup-storage.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.");
  process.exit(78);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const BUCKET = "grafik-pdf";
const options = {
  public: false, // doğrudan okuma yok; erişim yalnızca sunucunun imzalı bağlantısıyla
  fileSizeLimit: "50MB",
  allowedMimeTypes: ["application/pdf"],
};

const { data: existing } = await admin.storage.getBucket(BUCKET);
const { error } = existing
  ? await admin.storage.updateBucket(BUCKET, options)
  : await admin.storage.createBucket(BUCKET, options);

if (error) {
  console.error("Depolama alanı ayarlanamadı:", error.message);
  process.exit(1);
}
console.log(`${BUCKET}: özel, 50 MB sınırı, yalnızca PDF. Hazır.`);
