import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { ClipboardCheck, FileText, LoaderCircle, Square, Activity } from "lucide-react";
import { generateAiSupport } from "@/lib/ai-support.functions";
import type { AiRequest } from "@/lib/ai-policy";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const labels = {
  production: "AI Üretim Brifingi",
  quality: "AI Karar Desteği",
  order: "AI Hazırlık Taslağı",
};
const icons = { production: Activity, quality: ClipboardCheck, order: FileText };

export function AiReview({ kind, recordId }: { kind: AiRequest["kind"]; recordId?: string }) {
  const generate = useServerFn(generateAiSupport);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState("");
  const abort = useRef<AbortController | null>(null);
  const Icon = icons[kind];
  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    if (busy) return;
    if (kind !== "production" && !recordId) return;
    const data: AiRequest =
      kind === "production"
        ? { kind }
        : kind === "quality" && recordId
          ? { kind, recordId }
          : { kind: "order", recordId: recordId ?? "", notes };
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setText("");
    setError("");
    setCreated("");
    try {
      const response = await generate({ data, signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error ?? "AI yanıtı alınamadı.");
      }
      if (!response.body) throw new Error("AI yanıtı boş.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const part = await reader.read();
        buffer += decoder.decode(part.value, { stream: !part.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as { text?: string; error?: string };
          if (event.error) throw new Error(event.error);
          if (event.text) setText((previous) => previous + event.text);
        }
        if (part.done) break;
      }
      setCreated(new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }));
    } catch (err) {
      setError(
        controller.signal.aborted
          ? "Durduruldu. Kayıtlar değiştirilmedi."
          : err instanceof Error
            ? err.message
            : "AI yanıtı alınamadı.",
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) abort.current?.abort();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Icon />
          {labels[kind]}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-left">
            <Icon className="size-5 text-primary" />
            {labels[kind]}
          </DialogTitle>
          <DialogDescription className="text-left">
            OpenAI · İnceleme taslağı · Kayıtlar değişmez, bloke otomatik kaldırılmaz.
          </DialogDescription>
        </DialogHeader>
        {kind === "order" && (
          <div className="space-y-2">
            <Label htmlFor="ai-customer-notes">Müşteri notları</Label>
            <Textarea
              id="ai-customer-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={6000}
              disabled={busy}
              placeholder="İncelenecek müşteri notları…"
              className="min-h-28"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
          <span className="text-xs text-muted-foreground">
            {created || "Mevcut yetkilerinizle erişilen kayıtlar"}
          </span>
          {busy ? (
            <Button variant="outline" size="sm" onClick={() => abort.current?.abort()}>
              <Square />
              Durdur
            </Button>
          ) : (
            <Button size="sm" onClick={run}>
              <Icon />
              {text ? "Güncel kayıtlarla yeniden oluştur" : "Taslak oluştur"}
            </Button>
          )}
        </div>
        {busy && !text && (
          <div role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            Kayıtlar inceleniyor…
          </div>
        )}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {text && (
          <div className="space-y-3 break-words text-sm leading-7 text-foreground [&_h2]:text-base [&_h2]:font-bold [&_h3]:pt-2 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1">
            <ReactMarkdown components={{ a: ({ children }) => <span>{children}</span> }}>{text}</ReactMarkdown>
          </div>
        )}
        {text && (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            AI önerisi · Son karar yetkili kişiye aittir.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
