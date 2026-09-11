#!/usr/bin/env node
/**
 * Boş bir TEST ortamına şemayı uygular.
 *
 * Hangi aracın hangi geçmişi yönettiği:
 *  - `supabase/migrations/*.sql`  → Aşama 1 ve Aşama 2 temel şeması. Canlı projede
 *    Supabase migration geçmişi tarafından yönetilir.
 *  - `drizzle/migrations/*.sql`   → Aşama 2 düzeltmeleri (0000…). Canlı projede
 *    Drizzle Kit journal'ı (`drizzle/migrations/meta/_journal.json`) tarafından yönetilir.
 *  - `supabase/setup/roles-asama2.sql` → tekrarlanabilir rol/izin kurulumu (idempotent).
 *
 * Uygulama sırası: supabase/migrations (dosya adı sırası) → drizzle/migrations (numara
 * sırası) → roles-asama2.sql → `node scripts/setup-storage.mjs`.
 *
 * Bu betik YALNIZCA boş bir veritabanında çalışır: `public.orders` tablosu varsa
 * hiçbir değişiklik yapmadan durur. Mevcut ortamda uygulanmış migration'lar
 * körlemesine tekrar çalıştırılmaz.
 *
 * Kullanım:  TEST_SUPABASE_DB_URL=postgresql://... node scripts/apply-schema.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.TEST_SUPABASE_DB_URL;
if (!url) {
  console.error("DURDU: TEST_SUPABASE_DB_URL tanımlı değil. Gerçek projeye uygulanmaz.");
  process.exit(78);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

const [{ exists }] =
  await sql`SELECT to_regclass('public.orders') IS NOT NULL AS exists`;
if (exists) {
  console.error("DURDU: Hedef veritabanı boş değil (public.orders var). Değişiklik yapılmadı.");
  await sql.end();
  process.exit(78);
}

const files = [
  ...readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join("supabase/migrations", f)),
  ...readdirSync("drizzle/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join("drizzle/migrations", f)),
  "supabase/setup/roles-asama2.sql",
];

for (const file of files) {
  process.stdout.write(`→ ${file}\n`);
  await sql.unsafe(readFileSync(file, "utf8"));
}

await sql.end();
console.log("SEMA_UYGULANDI — ardından: node scripts/setup-storage.mjs");
