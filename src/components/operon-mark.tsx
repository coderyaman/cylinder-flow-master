import { cn } from "@/lib/utils";

export function OperonSymbol({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm",
        className,
      )}
    >
      <span className="absolute size-4 rotate-45 rounded-[3px] border-2 border-current" />
      <span className="absolute size-1.5 rounded-[2px] bg-current" />
    </span>
  );
}

export function OperonBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <OperonSymbol />
      {!compact ? (
        <div className="min-w-0 leading-none">
          <span className="block truncate text-lg font-bold text-sidebar-foreground">Operon</span>
          <span className="mt-1 block truncate text-[10px] font-medium text-sidebar-foreground/55">
            Üretim Yönetim Platformu
          </span>
        </div>
      ) : null}
    </div>
  );
}