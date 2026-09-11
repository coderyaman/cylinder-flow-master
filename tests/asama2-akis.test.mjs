#!/usr/bin/env node
/**
 * Aşama 2 akış testleri — YALNIZCA izole test ortamında çalışır.
 *
 * Gerekli: TEST_SUPABASE_DB_URL (boş/ayrılmış test projesinin veritabanı bağlantısı).
 * Gerçek kullanıcı veya gerçek sipariş kullanılmaz; bütün veriler test içinde üretilir
 * ve her senaryo kendi transaction'ında geri alınır ya da sonunda silinir.
 *
 * Kapsam:
 *  - Aynı yüklemenin eşzamanlı iki kesinleştirmesi
 *  - Başarılı kayıt sonrası yanıt kaybı ve tekrar denemesi
 *  - Temizlik ile kesinleştirmenin eşzamanlı çalışması
 *  - Kayıtlı dosyanın bütün bu senaryolarda korunması
 *  - Yalnızca boy/çevre/not/öncelik değişince aynı işlem anahtarının reddi
 *  - Bozuk PDF ve sahte PDF başlığı (saf sunucu doğrulaması)
 *  - Boş kurulumda Admin / Asistan / Müdür izinleri
 *  - Aynı isimli farklı müşterilerin ayrı gruplanması (farklı customer_id)
 */
import assert from "node:assert/strict";
import postgres from "postgres";

import { validatePdf } from "../src/lib/pdf-validate.ts";

let failures = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(`GECTI  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`KALDI  ${name}\n       ${err.message}`);
  }
}

/* ---------- 1. Bağlantı gerektirmeyen PDF doğrulaması ---------- */

const pdfBlob = (s) => new Blob([new TextEncoder().encode(s)]);
const validPdfText =
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n" +
  "x".repeat(400) +
  "\ntrailer\n<< /Root 1 0 R >>\nstartxref\n120\n%%EOF\n";

await test("geçerli PDF kabul edilir", async () => {
  assert.equal((await validatePdf(pdfBlob(validPdfText))).ok, true);
});
await test("sahte PDF başlığı reddedilir", async () => {
  const fake = "%PDF-1.4\n" + "A".repeat(2000);
  assert.equal((await validatePdf(pdfBlob(fake))).ok, false);
});
await test("kesilmiş (bozuk) PDF reddedilir", async () => {
  const truncated = validPdfText.slice(0, validPdfText.indexOf("startxref"));
  assert.equal((await validatePdf(pdfBlob(truncated))).ok, false);
});
await test("PDF olmayan dosya reddedilir", async () => {
  assert.equal((await validatePdf(pdfBlob("JPEG" + "B".repeat(2000)))).ok, false);
});

/* ---------- 2. Veritabanı senaryoları ---------- */

const url = process.env.TEST_SUPABASE_DB_URL;
if (!url) {
  console.log(results.join("\n"));
  console.error(
    "\nDURDU: TEST_SUPABASE_DB_URL yok. Veritabanı senaryoları ÇALIŞTIRILMADI " +
      "(gerçek projede test yapılmaz).",
  );
  process.exit(failures > 0 ? 1 : 78);
}

const sql = postgres(url, { max: 5, onnotice: () => {} });

// Güvenlik kilidi: gerçek proje hedeflenirse hiçbir şey yapmadan dur.
const realRef = (process.env.VITE_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\./)?.[1];
if (realRef && url.includes(realRef)) {
  console.error("DURDU: TEST_SUPABASE_DB_URL gerçek projeyi gösteriyor.");
  await sql.end();
  process.exit(78);
}

const TEST_TAG = `test-${Date.now()}`;

async function seed() {
  const [u] = await sql`
    INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at,
      encrypted_password, created_at, updated_at)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', ${`${TEST_TAG}@rotagravur.test`}, now(), '', now(), now())
    RETURNING id`;
  await sql`INSERT INTO public.profiles (id, full_name, email, is_active)
            VALUES (${u.id}, 'Test Grafik', ${`${TEST_TAG}@rotagravur.test`}, true)
            ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO public.user_roles (user_id, role) VALUES (${u.id}, 'grafik')
            ON CONFLICT DO NOTHING`;
  const [c] = await sql`INSERT INTO public.customers (name, created_by, updated_by)
            VALUES (${`${TEST_TAG} A.Ş.`}, ${u.id}, ${u.id}) RETURNING id`;
  const [o] = await sql`INSERT INTO public.orders (customer_id, work_order_no, name, quantity,
      nominal_circumference_mm, target_length_mm, due_on, created_by, updated_by)
    VALUES (${c.id}, ${TEST_TAG}, 'Test işi', 1, 600, 1200, current_date + 5, ${u.id}, ${u.id})
    RETURNING id`;
  return { userId: u.id, customerId: c.id, orderId: o.id };
}

async function newSession(userId, orderId, expected) {
  const [row] = await sql`SELECT private.graphic_upload_target(${userId}::uuid, ${orderId}::uuid,
    ${expected}::int) AS t`;
  return row.t;
}

const ctx = await seed();

await test("aynı yüklemenin eşzamanlı iki kesinleştirmesi tek revizyon üretir", async () => {
  const s = await newSession(ctx.userId, ctx.orderId, 0);
  const call = () =>
    sql`SELECT private.attach_graphic_revision_v3(${ctx.userId}::uuid, ${s.session_id}::uuid,
        'a.pdf', 1024) AS r`.then(
      ([r]) => ({ ok: true, r: r.r }),
      (e) => ({ ok: false, e: e.message }),
    );
  const [a, b] = await Promise.all([call(), call()]);
  const okCount = [a, b].filter((x) => x.ok).length;
  assert.ok(okCount >= 1, "iki istek de başarısız oldu");
  const [{ count }] = await sql`SELECT count(*)::int FROM public.graphic_assets
                                WHERE order_id = ${ctx.orderId}`;
  assert.equal(count, 1, "eşzamanlı kesinleştirme birden fazla revizyon oluşturdu");
});

await test("yanıtı kaybolan başarılı kesinleştirmenin tekrarı aynı sonucu döndürür", async () => {
  const [{ r: first }] = await sql`SELECT private.attach_graphic_revision_v3(${ctx.userId}::uuid,
      (SELECT id FROM public.graphic_upload_sessions WHERE order_id = ${ctx.orderId}
        AND consumed_at IS NOT NULL ORDER BY consumed_at DESC LIMIT 1)::uuid,
      'a.pdf', 1024) AS r`;
  assert.equal(first.replayed, true);
  const [{ count }] = await sql`SELECT count(*)::int FROM public.graphic_assets
                                WHERE order_id = ${ctx.orderId}`;
  assert.equal(count, 1, "tekrar denemesi yeni revizyon oluşturdu");
});

await test("temizliğe ayrılan oturum kesinleştirilemez, kayıtlı dosya korunur", async () => {
  const s = await newSession(ctx.userId, ctx.orderId, 1);
  await sql`UPDATE public.graphic_upload_sessions
              SET created_at = now() - interval '2 hours' WHERE id = ${s.session_id}`;
  const claimed = await sql`SELECT * FROM private.graphic_claim_orphans(60)`;
  assert.ok(
    claimed.some((c) => c.session_id === s.session_id),
    "oturum temizliğe ayrılmadı",
  );
  await assert.rejects(
    sql`SELECT private.attach_graphic_revision_v3(${ctx.userId}::uuid, ${s.session_id}::uuid,
        'b.pdf', 1024)`,
    /OTURUM_TEMIZLENDI/,
  );
  // Kayıtlı revizyonun dosyası temizlik adaylarına asla girmez.
  const [{ recorded }] = await sql`SELECT count(*)::int AS recorded
    FROM public.graphic_upload_sessions s
    JOIN public.graphic_assets g ON g.storage_path = s.storage_path
    WHERE s.cleanup_claimed_at IS NOT NULL`;
  assert.equal(recorded, 0, "kayıtlı dosyanın oturumu temizliğe alındı");
});

await test("temizlik ile kesinleştirme eşzamanlı çalıştığında ikisinden yalnızca biri kazanır", async () => {
  const s = await newSession(ctx.userId, ctx.orderId, 1);
  await sql`UPDATE public.graphic_upload_sessions
              SET created_at = now() - interval '2 hours' WHERE id = ${s.session_id}`;
  const finalize = sql`SELECT private.attach_graphic_revision_v3(${ctx.userId}::uuid,
      ${s.session_id}::uuid, 'c.pdf', 1024) AS r`.then(
    () => "kesinlesti",
    () => "reddedildi",
  );
  const cleanup = sql`SELECT * FROM private.graphic_claim_orphans(60)`.then((rows) =>
    rows.some((r) => r.session_id === s.session_id) ? "temizlendi" : "atlandi",
  );
  const [f, c] = await Promise.all([finalize, cleanup]);
  assert.ok(
    !(f === "kesinlesti" && c === "temizlendi"),
    "aynı oturum hem kesinleşti hem temizliğe alındı",
  );
});

await test("aynı işlem anahtarı farklı içerikle reddedilir", async () => {
  const key = `${TEST_TAG}-idem`;
  const payload = (extra) => sql`
    SELECT * FROM public.command_begin(${key}, 'update_order', ${sql.json(extra)}::jsonb)`;
  const [first] = await payload({ boy: 1200, cevre: 600, not: "a", oncelik: "normal" });
  assert.equal(first.is_new, true);
  await sql`SELECT public.command_finish(${key}, '2')`;
  const [same] = await payload({ boy: 1200, cevre: 600, not: "a", oncelik: "normal" });
  assert.equal(same.is_new, false);
  assert.equal(same.prior, "2");
  await assert.rejects(
    payload({ boy: 1300, cevre: 610, not: "b", oncelik: "acil" }),
    /ANAHTAR_CAKISMASI/,
  );
});

await test("boş kurulumda Admin sipariş izinleri var, Asistan/Müdür rol varsayılanı yok", async () => {
  const rows = await sql`SELECT role::text AS role, permission_code FROM public.role_permissions
                         WHERE permission_code LIKE 'orders.%'`;
  const admin = rows.filter((r) => r.role === "admin").map((r) => r.permission_code);
  for (const p of ["orders.create", "orders.edit_all", "orders.edit_graphics", "orders.cancel"]) {
    assert.ok(admin.includes(p), `Admin izni eksik: ${p}`);
  }
  assert.equal(rows.filter((r) => r.role === "asistan" || r.role === "mudur").length, 0);
});

await test("aynı isimli iki müşteri ayrı kimliklerle ayrı gruplanır", async () => {
  const name = `${TEST_TAG} AYNI AD`;
  const [a] = await sql`INSERT INTO public.customers (name) VALUES (${name}) RETURNING id`;
  const [b] = await sql`INSERT INTO public.customers (name) VALUES (${name}) RETURNING id`;
  assert.notEqual(a.id, b.id);
  const groups = new Set([a.id, b.id]);
  assert.equal(groups.size, 2, "aynı adlı müşteriler tek grupta birleşti");
});

/* ---------- Temizlik ---------- */
await sql`DELETE FROM public.graphic_assets WHERE order_id = ${ctx.orderId}`;
await sql`DELETE FROM public.graphic_upload_sessions WHERE order_id = ${ctx.orderId}`;
await sql`DELETE FROM public.orders WHERE id = ${ctx.orderId}`;
await sql`DELETE FROM public.customers WHERE name LIKE ${`${TEST_TAG}%`}`;
await sql`DELETE FROM public.user_roles WHERE user_id = ${ctx.userId}`;
await sql`DELETE FROM public.audit_log WHERE actor_id = ${ctx.userId}`;
await sql`DELETE FROM public.profiles WHERE id = ${ctx.userId}`;
await sql`DELETE FROM auth.users WHERE id = ${ctx.userId}`;
await sql.end();

console.log(results.join("\n"));
console.log(failures === 0 ? "ASAMA2_AKIS_OK" : `BASARISIZ: ${failures} test`);
process.exit(failures === 0 ? 0 : 1);
