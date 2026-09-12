import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function extractCylCode(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/CYL-\d{4}-\d{4,}/);
  return m ? m[0] : null;
}

/** Kamera varsa QR okur; yoksa kullanıcı kodu elle girer. Okutmak süre başlatmaz. */
export function QrScanner({ onCode }: { onCode: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let stop = false;

    (async () => {
      const Detector = (
        globalThis as unknown as {
          BarcodeDetector?: new (o: object) => {
            detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
          };
        }
      ).BarcodeDetector;
      if (!Detector) {
        setError("Bu cihaz kamera ile QR okumayı desteklemiyor. Kodu elle girin.");
        setActive(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        setError("Kameraya erişilemedi. Kodu elle girin.");
        setActive(false);
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (stop) return;
        try {
          const found = await detector.detect(video);
          if (found[0]?.rawValue) {
            onCode(found[0].rawValue);
            return;
          }
        } catch {
          /* kare atlandı */
        }
        setTimeout(tick, 300);
      };
      tick();
    })();

    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onCode]);

  return (
    <div className="space-y-2">
      {active ? (
        <video
          ref={videoRef}
          className="aspect-video w-full rounded-md bg-muted object-cover"
          muted
          playsInline
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-14 w-full text-base"
          onClick={() => setActive(true)}
        >
          Kamerayı aç
        </Button>
      )}
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
    </div>
  );
}
