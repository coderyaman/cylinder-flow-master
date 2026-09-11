import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "grafik-pdf";
const MAX_BYTES = 52428800;

function fail(message: string): never {
  throw new Error(message);
}

/** Siparişe ve kullanıcıya bağlı, tek kullanımlık yükleme oturumu açar. */
export const startGraphicUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ orderId: z.string().uuid(), expectedRevision: z.number().int().min(0) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target, error } = await supabaseAdmin.rpc("srv_graphic_upload_target", {
      _actor: context.userId,
      _order_id: data.orderId,
      _expected_revision: data.expectedRevision,
    });
    if (error) fail(error.message);

    const t = target as { session_id: string; storage_path: string };
    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(t.storage_path);
    if (signed.error) fail(signed.error.message);

    return {
      sessionId: t.session_id,
      path: signed.data.path,
      token: signed.data.token,
    };
  });

/** Dosyayı sunucuda doğrular ve revizyonu kesinleştirir. */
export const finalizeGraphicUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ sessionId: z.string().uuid(), filename: z.string().min(1).max(255) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { validatePdf } = await import("@/lib/pdf-validate");

    const { data: sess, error: sErr } = await supabaseAdmin
      .from("graphic_upload_sessions")
      .select("id, user_id, storage_path, consumed_at, cleaned_at, cleanup_claimed_at")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sErr) fail(sErr.message);
    if (!sess) fail("BULUNAMADI: Yükleme oturumu yok.");
    if (sess.user_id !== context.userId) fail("YETKISIZ: Bu yükleme oturumu size ait değil.");

    // Kesinleştirilmiş oturumun tekrarı: veritabanı önceki sonucu döndürür, dosya silinmez.
    if (!sess.consumed_at) {
      if (sess.cleaned_at || sess.cleanup_claimed_at) {
        fail("OTURUM_TEMIZLENDI: Bu yükleme temizliğe alındı; dosyayı yeniden yükleyin.");
      }

      const dl = await supabaseAdmin.storage.from(BUCKET).download(sess.storage_path);
      if (dl.error || !dl.data) fail("DOSYA_GECERSIZ: Yüklenen dosya bulunamadı.");

      const blob = dl.data;
      const size = blob.size;

      // Doğrulama başarısızsa yalnızca bu oturumun (henüz kaydedilmemiş) dosyası silinir.
      const rejectAndCleanup = async (message: string): Promise<never> => {
        await supabaseAdmin.storage.from(BUCKET).remove([sess.storage_path]);
        fail(message);
      };

      if (size <= 0 || size > MAX_BYTES) {
        await rejectAndCleanup("DOSYA_GECERSIZ: Dosya boş olamaz ve 50 MB sınırını aşamaz.");
      }

      const check = await validatePdf(blob);
      if (!check.ok) await rejectAndCleanup(`DOSYA_GECERSIZ: ${check.reason}`);

      let checksum: string | null = null;
      if (size <= 10 * 1024 * 1024) {
        const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        checksum = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }

      const { data: result, error } = await supabaseAdmin.rpc("srv_attach_graphic_revision", {
        _actor: context.userId,
        _session_id: data.sessionId,
        _filename: data.filename,
        _byte_size: size,
        ...(checksum ? { _checksum: checksum } : {}),
      });
      // Kesinleştirme hatasında dosya SİLİNMEZ: eşzamanlı bir istek kaydı oluşturmuş
      // veya yanıt kaybolmuş olabilir. Kaydı olmayan dosyayı yalnızca temizlik işi alır.
      if (error) fail(error.message);

      return result as { id: string; revision_no: number; replayed?: boolean };
    }

    // Yanıtı kaybolmuş başarılı kesinleştirmenin tekrarı.
    const { data: replay, error: rErr } = await supabaseAdmin.rpc("srv_attach_graphic_revision", {
      _actor: context.userId,
      _session_id: data.sessionId,
      _filename: data.filename,
      _byte_size: 1,
    });
    if (rErr) fail(rErr.message);
    return replay as { id: string; revision_no: number; replayed?: boolean };
  });

/** Yetki denetimli, kısa ömürlü erişim bağlantısı üretir ve denetime yazar. */
export const graphicAccessLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ assetId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: grant, error } = await supabaseAdmin.rpc("srv_graphic_access_grant", {
      _actor: context.userId,
      _asset_id: data.assetId,
    });
    if (error) fail(error.message);

    const g = grant as { storage_path: string; filename: string };
    const signed = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(g.storage_path, 300, { download: g.filename });
    if (signed.error) fail(signed.error.message);

    return { url: signed.data.signedUrl, filename: g.filename };
  });
