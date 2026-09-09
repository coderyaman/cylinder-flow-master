/**
 * Aşama 1 güvenlik regresyon testleri — doğrudan API/veritabanı seviyesinde.
 *
 * ÖNEMLİ: Bu testler YALNIZCA ayrı bir test veritabanında çalışır.
 * Gerçek/üretim projesi hedeflendiğinde hiçbir değişiklik yapmadan durur.
 *
 * Gerekli ortam değişkenleri:
 *   TEST_SUPABASE_URL
 *   TEST_SUPABASE_PUBLISHABLE_KEY
 *   TEST_SUPABASE_SERVICE_ROLE_KEY
 *   TEST_SUPABASE_DB_URL           (denetim geri alma testi için, psql)
 *
 * Çalıştırma:  bun run test:security
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const TEST_DOMAIN = "@rotagravur.test";
const PASSWORD = "TestParola!2026";

const URL = process.env.TEST_SUPABASE_URL;
const SERVICE = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const DB_URL = process.env.TEST_SUPABASE_DB_URL;

function halt(reason) {
  console.log(`DURDURULDU (hiçbir değişiklik yapılmadı): ${reason}`);
  process.exit(78);
}

if (!URL || !SERVICE || !PUBLISHABLE) {
  halt("TEST_SUPABASE_* ortam değişkenleri tanımlı değil. Ayrı bir test projesi gerekir.");
}

// Üretim/proje ortamı hedeflenmişse kesinlikle çalışma.
for (const file of [".env", ".env.local"]) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/^\s*[A-Z_]*SUPABASE_URL\s*=\s*"?([^"\n]+)"?/gm)) {
    if (m[1].trim().replace(/\/$/, "") === URL.replace(/\/$/, "")) {
      halt("Hedef, projenin gerçek Supabase ortamı. Testler yalnızca ayrı test projesinde çalışır.");
    }
  }
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

// Güvenlik kilidi: test projesinde test hesapları dışında kullanıcı bulunmamalı.
{
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) halt(`Test projesine bağlanılamadı: ${error.message}`);
  const foreign = data.users.filter((u) => !(u.email ?? "").endsWith(TEST_DOMAIN));
  if (foreign.length) {
    halt(
      `Hedef veritabanında gerçek hesaplar var (${foreign.length} adet). Testler gerçek verilere dokunmaz.`,
    );
  }
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const stamp = Date.now();
const emails = {
  admin: `admin.${stamp}${TEST_DOMAIN}`,
  admin2: `admin2.${stamp}${TEST_DOMAIN}`,
  operator: `operator.${stamp}${TEST_DOMAIN}`,
  norole: `norole.${stamp}${TEST_DOMAIN}`,
  davetli: `davetli.${stamp}${TEST_DOMAIN}`,
  sahtekar: `sahtekar.${stamp}${TEST_DOMAIN}`,
};

function anonClient() {
  return createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
}

async function invite(email, role) {
  const { error } = await admin
    .from("user_invites")
    .upsert({ email, role, full_name: email }, { onConflict: "email" });
  if (error) throw new Error(`Davet oluşturulamadı: ${error.message}`);
}

/** Gerçek kullanıcı akışı: kayıt → e-posta doğrulama bağlantısı → oturum. */
async function signUpAndConfirm(email) {
  const c = anonClient();
  const { error } = await c.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`Kayıt yapılamadı (${email}): ${error.message}`);
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password: PASSWORD,
  });
  if (linkErr) throw new Error(`Doğrulama bağlantısı üretilemedi: ${linkErr.message}`);
  const verifier = anonClient();
  const { error: vErr } = await verifier.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "signup",
  });
  if (vErr) throw new Error(`E-posta doğrulanamadı: ${vErr.message}`);
  return verifier;
}

async function signIn(email) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Giriş yapılamadı (${email}): ${error.message}`);
  return c;
}

async function userId(email) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data.users.find((u) => u.email === email)?.id ?? null;
}

async function main() {
  const ids = {};

  // --- Davetin uçtan uca gerçek kullanıcı akışı ---------------------------
  await invite(emails.davetli, "operator");

  // (a) Davet adresini bilen ama posta kutusuna erişemeyen kişi
  {
    const c = anonClient();
    const { error: suErr } = await c.auth.signUp({
      email: emails.sahtekar,
      password: PASSWORD,
    });
    check("Davetsiz adresle kayıt engellenir", !!suErr, suErr?.message ?? "hata yok");

    const c2 = anonClient();
    await c2.auth.signUp({ email: emails.davetli, password: PASSWORD });
    const { data: sess } = await c2.auth.getSession();
    let claimErr = null;
    let roles = [];
    if (sess.session) {
      const r = await c2.rpc("claim_invite");
      claimErr = r.error;
    }
    ids.davetli = await userId(emails.davetli);
    if (ids.davetli) {
      const { data } = await admin.from("user_roles").select("role").eq("user_id", ids.davetli);
      roles = data ?? [];
    }
    check(
      "E-posta doğrulanmadan davet üstlenilemez",
      !sess.session || !!claimErr,
      claimErr?.message ?? (sess.session ? "hata yok" : "doğrulanmamış hesaba oturum verilmedi"),
    );
    check("Doğrulanmamış hesaba rol verilmez", roles.length === 0, `${roles.length} rol`);
  }

  // (b) Posta kutusunun gerçek sahibi doğrulama bağlantısını kullanır
  {
    const verified = await signUpAndConfirm(emails.davetli);
    ids.davetli = await userId(emails.davetli);
    const claim = await verified.rpc("claim_invite");
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", ids.davetli);
    check("Doğrulanmış davetli rolünü alır", !claim.error && (roles ?? []).some((r) => r.role === "operator"), claim.error?.message ?? "");
    const { data: inv } = await admin
      .from("user_invites")
      .select("accepted_at, accepted_user_id")
      .eq("email", emails.davetli)
      .single();
    check("Davet kabul edilmiş olarak işaretlenir", !!inv?.accepted_at && inv.accepted_user_id === ids.davetli);
    const again = await verified.rpc("claim_invite");
    check("Kullanılmış davet ikinci kez rol vermez", !again.error && again.data?.claimed === false);
  }

  // --- Diğer test hesapları (gerçek akışla oluşturulur) -------------------
  for (const [key, role] of [
    ["admin", "admin"],
    ["admin2", "admin"],
    ["operator", "operator"],
    ["norole", null],
  ]) {
    await invite(emails[key], role);
    const c = await signUpAndConfirm(emails[key]);
    await c.rpc("claim_invite");
    ids[key] = await userId(emails[key]);
  }

  const asAdmin = await signIn(emails.admin);
  const asAdmin2 = await signIn(emails.admin2);
  const asOperator = await signIn(emails.operator);
  const asNoRole = await signIn(emails.norole);

  // 1) İstemci denetim tablosuna doğrudan yazamaz / silemez
  {
    const { error } = await asOperator.from("audit_log").insert({
      actor_id: ids.operator,
      action: "sahte.kayit",
      entity_type: "test",
    });
    check("İstemci denetim kaydı ekleyemez", !!error, error?.message ?? "hata yok");
    const del = await asAdmin.from("audit_log").delete().eq("action", "role.granted");
    check("Admin dahil denetim kaydı silinemez", !!del.error || del.count === 0);
  }

  // 2) Yetkisiz kullanıcı rol atayamaz, denetim kaydı da oluşmaz
  {
    const before = await admin.from("audit_log").select("id", { count: "exact", head: true });
    const { error } = await asOperator.rpc("admin_set_user_role", {
      _user_id: ids.norole,
      _role: "depo",
      _on: true,
    });
    const roles = await admin.from("user_roles").select("role").eq("user_id", ids.norole);
    const after = await admin.from("audit_log").select("id", { count: "exact", head: true });
    check("Yetkisiz kullanıcı rol atayamaz", !!error, error?.message ?? "hata yok");
    check("Reddedilen işlem rol satırı oluşturmaz", (roles.data ?? []).length === 0);
    check("Reddedilen işlem denetim kaydı üretmez", before.count === after.count);
  }

  // 3) Admin rol atar, denetim kaydı aynı işlemde oluşur
  {
    const { error } = await asAdmin.rpc("admin_set_user_role", {
      _user_id: ids.norole,
      _role: "depo",
      _on: true,
      _reason: "Test",
    });
    const { data: log } = await admin
      .from("audit_log")
      .select("actor_id, action, new_value")
      .eq("entity_id", ids.norole)
      .eq("action", "role.granted")
      .order("created_at", { ascending: false })
      .limit(1);
    check("Admin rol atayabilir", !error, error?.message ?? "");
    check(
      "Denetim kaydında gerçek kullanıcı ve yeni değer sunucudan gelir",
      log?.[0]?.actor_id === ids.admin && log?.[0]?.new_value?.role === "depo",
    );
    await asAdmin.rpc("admin_set_user_role", { _user_id: ids.norole, _role: "depo", _on: false });
  }

  // 4) Rol atanmamış kullanıcı personel bilgilerini okuyamaz
  {
    const p = await asNoRole.from("profiles").select("id");
    const r = await asNoRole.from("user_roles").select("user_id");
    const s = await asNoRole.from("stations").select("id");
    check(
      "Rol atanmamış kullanıcı yalnızca kendi profilini görür",
      (p.data ?? []).length === 1 && p.data[0].id === ids.norole,
      `${(p.data ?? []).length} satır`,
    );
    check("Rol atanmamış kullanıcı başkalarının rollerini göremez", (r.data ?? []).length === 0);
    check("Rol atanmamış kullanıcı istasyon tanımlarını göremez", (s.data ?? []).length === 0);
  }

  // 5) Pasif kullanıcı korumalı işlem yapamaz ve kendini aktifleştiremez
  {
    await asAdmin.rpc("admin_set_user_active", {
      _user_id: ids.admin2,
      _active: false,
      _reason: "Test",
    });
    const rpc = await asAdmin2.rpc("admin_set_user_role", {
      _user_id: ids.norole,
      _role: "depo",
      _on: true,
    });
    check("Pasif Admin korumalı işlem yapamaz", !!rpc.error, rpc.error?.message ?? "hata yok");

    const upd = await asAdmin2.from("profiles").update({ is_active: true }).eq("id", ids.admin2);
    const { data: prof } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", ids.admin2)
      .single();
    check(
      "Pasif kullanıcı kendini aktifleştiremez",
      prof.is_active === false,
      upd.error?.message ?? "sessiz reddedildi",
    );
    await asAdmin.rpc("admin_set_user_active", { _user_id: ids.admin2, _active: true });
  }

  // 6) admin.configure kişisel izinle kaldırıldığında sunucu da reddeder
  {
    const set = await asAdmin.rpc("admin_set_permission_override", {
      _user_id: ids.admin2,
      _permission_code: "admin.configure",
      _granted: false,
      _reason: "Test",
    });
    check("Kişisel izin kaldırma kaydedilir", !set.error, set.error?.message ?? "");
    const rpc = await asAdmin2.rpc("admin_set_user_role", {
      _user_id: ids.norole,
      _role: "depo",
      _on: true,
    });
    check("İzni kaldırılan Admin sunucuda reddedilir", !!rpc.error, rpc.error?.message ?? "hata yok");
    await asAdmin.rpc("admin_set_permission_override", {
      _user_id: ids.admin2,
      _permission_code: "admin.configure",
      _granted: null,
    });
  }

  // 7) Son aktif Admin kaldırılamaz / pasifleştirilemez
  {
    await asAdmin.rpc("admin_set_user_role", { _user_id: ids.admin2, _role: "admin", _on: false });

    const revoke = await asAdmin.rpc("admin_set_user_role", {
      _user_id: ids.admin,
      _role: "admin",
      _on: false,
    });
    check(
      "Son aktif Admin'in rolü alınamaz",
      !!revoke.error && revoke.error.message.includes("SON_ADMIN"),
      revoke.error?.message ?? "hata yok",
    );

    const deact = await asAdmin.rpc("admin_set_user_active", {
      _user_id: ids.admin,
      _active: false,
    });
    check("Son aktif Admin kendini pasifleştiremez", !!deact.error, deact.error?.message ?? "hata yok");

    const stillAdmin = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", ids.admin)
      .eq("role", "admin");
    check("Engellenen işlem sonrası Admin rolü yerinde", (stillAdmin.data ?? []).length === 1);
  }

  // 8) Eşzamanlılık: iki Admin aynı anda birbirinin rolünü almaya çalışır
  {
    await asAdmin.rpc("admin_set_user_role", { _user_id: ids.admin2, _role: "admin", _on: true });
    const [r1, r2] = await Promise.all([
      asAdmin.rpc("admin_set_user_role", { _user_id: ids.admin2, _role: "admin", _on: false }),
      asAdmin2.rpc("admin_set_user_role", { _user_id: ids.admin, _role: "admin", _on: false }),
    ]);
    const remaining = await admin
      .from("user_roles")
      .select("user_id")
      .in("user_id", [ids.admin, ids.admin2])
      .eq("role", "admin");
    const successes = [r1, r2].filter((r) => !r.error).length;
    check(
      "Eşzamanlı iki kaldırma isteğinden yalnızca biri geçer",
      successes === 1 && (remaining.data ?? []).length === 1,
      `${successes} başarılı, kalan admin: ${(remaining.data ?? []).length}`,
    );
    // admin rolünü test yöneticisine geri ver
    const survivor = (remaining.data ?? [])[0]?.user_id;
    const asSurvivor = survivor === ids.admin ? asAdmin : asAdmin2;
    await asSurvivor.rpc("admin_set_user_role", {
      _user_id: survivor === ids.admin ? ids.admin2 : ids.admin,
      _role: "admin",
      _on: true,
    });
  }

  // 9) Denetim kaydı yazılamazsa değişiklik geri alınır (gerçek yönetim fonksiyonu)
  {
    if (!DB_URL) {
      check("Denetim hatasında işlem geri alınır", false, "TEST_SUPABASE_DB_URL tanımlı değil");
    } else {
      try {
        const out = execFileSync(
          "psql",
          [
            DB_URL,
            "-v",
            "ON_ERROR_STOP=1",
            "-v",
            `admin_id=${ids.admin}`,
            "-v",
            `target_id=${ids.norole}`,
            "-v",
            `jwt_claims={"sub":"${ids.admin}","role":"authenticated"}`,
            "-f",
            "tests/audit-rollback.sql",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
        check("Denetim hatasında işlem geri alınır", out.includes("AUDIT_ROLLBACK_OK"), out.trim());
      } catch (e) {
        check("Denetim hatasında işlem geri alınır", false, String(e.stderr ?? e.message).trim());
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} test geçti.`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
