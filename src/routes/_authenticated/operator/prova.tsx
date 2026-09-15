import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ProofOperator } from "@/components/proof-operator";

export const Route = createFileRoute("/_authenticated/operator/prova")({
  validateSearch: (search: Record<string, unknown>) => ({
    team: typeof search["team"] === "string" ? (search["team"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prova ve Son Kontrol — Operon" },
      {
        name: "description",
        content:
          "Takım bazlı Prova: hazırlık kapısı, aktif üyeler, makine seçimi ve tek Başlat/Tamamla akışı.",
      },
      { property: "og:title", content: "Prova ve Son Kontrol — Operon" },
      {
        property: "og:description",
        content: "Takımın Prova hazırlığını görün, Prova'yı başlatın ve sonucu kaydedin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProofRoute,
});

function ProofRoute() {
  const { team } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <ProofOperator
      teamId={team ?? null}
      onSelect={(id) =>
        void navigate({ to: "/operator/prova", search: { team: id ?? undefined } })
      }
    />
  );
}
