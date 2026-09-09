/**
 * Aşama 1 güvenlik regresyon testleri — doğrudan API/veritabanı seviyesinde.
 *
 * Çalıştırma:  bun tests/asama1-guvenlik.test.mjs
 *
 * Kapsam:
 *  - Denetim kaydı yazılamazsa değişikliğin geri alınması (atomiklik)
 *  - İstemcinin denetim tablosuna doğrudan yazamaması
 *  - Pasif kullanıcının korumalı işlem yapamaması / kendini aktifleştirememesi
 *  - Kişisel izinle admin.configure kaldırıldığında sunucunun da reddetmesi
 *  - Rol atanmamış kullanıcının personel bilgilerini okuyamaması
 *  - Son aktif Admin'in kaldırılamaması ve eşzamanlı işlemlerde kilitleme
 *  - Davet olmadan kayıt olunamaması, davetli kullanıcıya rolün otomatik verilmesi
 */
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const PASSWORD = "TestParola!2026";
const ACCOUNTS = {
  admin: { email: "test.admin@rotagravur.test", role: "admin" },
  admin2: { email: "test.admin2@rotagravur.test", role: "admin" },
  operator: { email: "test.operator@rotagravur.test", role: "operator" },
  norole: { email: "test.norole@rotagravur.test", role: null },
};

async function ensureUser(acc) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = list.users.find((u) => u.email === acc.email);
  if (found) {
    await admin.from("profiles").update({ is_active: true }).eq("id", found.id);
    if (acc.role) {
      await admin.from("user_roles").upsert(
        { user_id: found.id, role: acc.role },
        { onConflict: "user_id,role" },
      );
    }
    await admin.from("user_permission_overrides").delete().eq("user_id", found.id);
    return found.id;
  }
  // Davet olmadan kayıt engelli: önce davet satırı.
  await admin.from("user_invites").upsert(
    { email: acc.email, role: acc.role, full_name: acc.email },
    { onConflict: "email" },
  );
  const { data, error } = await admin.auth.admin.createUser({
    email: acc.email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Test kullanıcısı oluşturulamadı: ${error.message}`);
  return data.user.id;
}

async function signIn(email) {
  const c = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Giriş yapılamadı (${email}): ${error.message}`);
  return c;
}

async function main() {
  const ids = {};
  for (const [key, acc] of Object.entries(ACCOUNTS)) ids[key] = await ensureUser(acc);

  const asAdmin = await signIn(ACCOUNTS.admin.email);
  const asAdmin2 = await signIn(ACCOUNTS.admin2.email);
  const asOperator = await signIn(ACCOUNTS.operator.email);
  const asNoRole = await signIn(ACCOUNTS.norole.email);

  // 1) Davetli kullanıcı rolünü otomatik almış olmalı
  {
    const { data } = await admin.from("user_roles").select("role").eq("user_id", ids.operator);
    check(
      "Davetli kullanıcı davetteki rolü otomatik alır",
      (data ?? []).some((r) => r.role === "operator"),
    );
  }

  // 2) Davetsiz kayıt engellenir
  {
    const anon = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
    const { error } = await anon.auth.signUp({
      email: `davetsiz.${Date.now()}@rotagravur.test`,
      password: PASSWORD,
    });
    check("Davetsiz açık kayıt engellenir", !!error, error?.message ?? "hata yok");
  }

  // 3) İstemci denetim tablosuna doğrudan yazamaz
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

  // 4) Yetkisiz kullanıcı rol atayamaz, denetim kaydı da oluşmaz
  {
    const before = await admin
      .from("audit_log")
      .select("id", { count: "exact", head: true });
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

  // 5) Admin rol atar, denetim kaydı aynı işlemde oluşur
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

  // 6) Rol atanmamış kullanıcı personel bilgilerini okuyamaz
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

  // 7) Pasif kullanıcı korumalı işlem yapamaz ve kendini aktifleştiremez
  {
    await admin.from("profiles").update({ is_active: false }).eq("id", ids.admin2);
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
    await admin.from("profiles").update({ is_active: true }).eq("id", ids.admin2);
  }

  // 8) admin.configure kişisel izinle kaldırıldığında sunucu da reddeder
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

  // 9) Denetim kaydı yazılamazsa değişiklik geri alınır (atomiklik)
  {
    const probe = await asAdmin.rpc("audit_atomicity_probe", { _user_id: ids.norole });
    const roles = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", ids.norole)
      .eq("role", "grafik");
    check("Denetim kaydı yazılamazsa işlem hata verir", !!probe.error, probe.error?.message ?? "hata yok");
    check("Denetim hatasında değişiklik geri alınır", (roles.data ?? []).length === 0);
  }

  // 10) Son aktif Admin kaldırılamaz / pasifleştirilemez
  const { data: adminRows } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const adminIds = (adminRows ?? []).map((r) => r.user_id);
  const { data: activeRows } = await admin
    .from("profiles")
    .select("id, is_active")
    .in("id", adminIds);
  const previouslyActive = (activeRows ?? []).filter((p) => p.is_active).map((p) => p.id);

  try {
    // Yalnızca test.admin aktif Admin kalacak şekilde geçici durum
    const others = previouslyActive.filter((id) => id !== ids.admin);
    if (others.length) await admin.from("profiles").update({ is_active: false }).in("id", others);
    await admin.from("profiles").update({ is_active: true }).eq("id", ids.admin);

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

    const deact = await asAdmin.rpc("admin_set_user_active", { _user_id: ids.admin, _active: false });
    check("Son aktif Admin kendini pasifleştiremez", !!deact.error, deact.error?.message ?? "hata yok");

    const stillAdmin = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", ids.admin)
      .eq("role", "admin");
    check("Engellenen işlem sonrası Admin rolü yerinde", (stillAdmin.data ?? []).length === 1);

    // 11) Eşzamanlılık: iki Admin aynı anda birbirinin rolünü almaya çalışır
    await admin.from("profiles").update({ is_active: true }).eq("id", ids.admin2);
    await admin.from("user_roles").upsert(
      { user_id: ids.admin2, role: "admin" },
      { onConflict: "user_id,role" },
    );

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
  } finally {
    // Geri yükleme: test admin rolleri ve önceki aktiflik durumları
    for (const id of [ids.admin, ids.admin2]) {
      await admin.from("user_roles").upsert({ user_id: id, role: "admin" }, { onConflict: "user_id,role" });
    }
    if (previouslyActive.length) {
      await admin.from("profiles").update({ is_active: true }).in("id", previouslyActive);
    }
    const restored = await admin
      .from("profiles")
      .select("id")
      .in("id", previouslyActive)
      .eq("is_active", true);
    check(
      "Gerçek Admin hesapları eski durumuna döndürüldü",
      (restored.data ?? []).length === previouslyActive.length,
    );
  }

  // Temizlik: test hesapları pasifleştirilir (denetim kaydı silinemediği için hesaplar korunur)
  for (const id of Object.values(ids)) {
    await admin.from("profiles").update({ is_active: false }).eq("id", id);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} test geçti.`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
