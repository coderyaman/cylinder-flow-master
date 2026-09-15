import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OperonBrand, OperonSymbol } from "@/components/operon-mark";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      typeof search["redirect"] === "string" &&
      search["redirect"].startsWith("/") &&
      !search["redirect"].startsWith("//")
        ? search["redirect"]
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Giriş — Operon" },
      { name: "description", content: "Operon Üretim Yönetim Platformu'na güvenli giriş." },
      { property: "og:title", content: "Giriş — Operon" },
      { property: "og:description", content: "Operon Üretim Yönetim Platformu'na giriş yapın." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot" | "recovery">("signin");

  const goAfterLogin = () => {
    const target = redirect ?? sessionStorage.getItem("operon.returnTo") ?? "/panel";
    sessionStorage.removeItem("operon.returnTo");
    window.location.assign(target);
  };

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setMode("recovery");
    if (!loading && session && mode !== "recovery") goAfterLogin();
  }, [loading, session, mode]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error("Giriş yapılamadı: " + error.message);
      return;
    }
    goAfterLogin();
  }

  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    setBusy(false);
    if (error) {
      toast.error("Sıfırlama bağlantısı gönderilemedi. E-posta adresini kontrol edin.");
      return;
    }
    toast.success("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.");
    setMode("signin");
  }

  async function handlePasswordUpdate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error("Şifre güncellenemedi. Bağlantıyı yeniden açmayı deneyin.");
      return;
    }
    toast.success("Şifreniz güncellendi.");
    setMode("signin");
    navigate({ to: "/panel", replace: true });
  }

  async function handleGoogle() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`,
    });
    setBusy(false);
    if (result.error) {
      toast.error("Google ile giriş başarısız oldu.");
      return;
    }
    if (result.redirected) return;
    goAfterLogin();
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background" aria-busy="true">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <OperonSymbol className="size-10 animate-pulse" />
          <span className="text-sm font-medium">Oturum kontrol ediliyor…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <OperonBrand />
        <div className="relative z-10 max-w-lg">
          <div className="mb-10 grid size-28 place-items-center rounded-2xl border border-sidebar-border bg-sidebar-accent/35">
            <OperonSymbol className="size-16 rounded-xl" />
          </div>
          <h1 className="text-5xl font-bold leading-tight">Üretimin her adımı, tek yerde.</h1>
          <p className="mt-5 max-w-md text-base leading-7 text-sidebar-foreground/60">
            Siparişten sevkiyata uzanan rotagravür üretim akışınız için güvenilir çalışma alanı.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/40">Operon · Üretim Yönetim Platformu</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden"><OperonBrand /></div>
          <div className="mb-8">
            <p className="text-sm font-semibold text-primary">Güvenli erişim</p>
            <h2 className="mt-2 text-3xl font-bold text-foreground">
              {mode === "forgot" ? "Şifrenizi yenileyin" : mode === "recovery" ? "Yeni şifre belirleyin" : "Operon’a giriş yapın"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "signin" ? "Çalışma alanınıza devam etmek için bilgilerinizi girin." : "Hesabınızla eşleşen e-posta adresini kullanın."}
            </p>
          </div>

          <form className="space-y-5" onSubmit={mode === "forgot" ? handleResetRequest : mode === "recovery" ? handlePasswordUpdate : handleSignIn}>
            {mode !== "recovery" ? (
              <div className="space-y-2">
                <Label htmlFor="email">E-posta</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 bg-card" />
              </div>
            ) : null}
            {mode !== "forgot" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{mode === "recovery" ? "Yeni şifre" : "Şifre"}</Label>
                  {mode === "signin" ? <button type="button" onClick={() => setMode("forgot")} className="text-xs font-semibold text-primary hover:underline">Şifremi unuttum</button> : null}
                </div>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"} autoComplete={mode === "recovery" ? "new-password" : "current-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 bg-card pr-11" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"} className="absolute right-1 top-1 size-9 text-muted-foreground">
                    {showPassword ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
            ) : null}
            <Button type="submit" className="h-11 w-full" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {busy ? "İşleniyor…" : mode === "forgot" ? "Sıfırlama bağlantısı gönder" : mode === "recovery" ? "Şifreyi güncelle" : "Giriş yap"}
            </Button>
          </form>

          {mode === "signin" ? (
            <>
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />veya<span className="h-px flex-1 bg-border" /></div>
              <Button variant="outline" className="h-11 w-full bg-card" onClick={handleGoogle} disabled={busy}>Google ile devam et</Button>
              <p className="mt-6 text-center text-xs text-muted-foreground">Hesaplar yalnızca yönetici davetiyle oluşturulur.</p>
            </>
          ) : mode === "forgot" ? (
            <Button type="button" variant="ghost" className="mt-4 w-full" onClick={() => setMode("signin")}>Girişe dön</Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
