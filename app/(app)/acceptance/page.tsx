import { getAcceptanceBoard } from "@/server/acceptance/board";
import { AcceptanceBoard } from "./_components/AcceptanceBoard";
import { MobileAcceptanceBoard } from "./_components/MobileAcceptanceBoard";

export default async function AcceptancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const initialZone =
    sp.zone === "zone2" || sp.zone === "zone3" ? sp.zone : "zone1";
  const board = await getAcceptanceBoard();

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4 hidden items-start justify-between gap-4 md:flex">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Приёмка</h1>
          <p className="text-sm text-muted-foreground">
            Перевеска прибывших машин · ввод фактического веса партий
          </p>
        </div>
        <a
          href="/print/acceptance"
          target="_blank"
          rel="noopener"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Печать
        </a>
      </div>

      <div className="hidden md:block">
        <AcceptanceBoard board={board} />
      </div>
      <div className="md:hidden">
        <MobileAcceptanceBoard board={board} initialZone={initialZone} />
      </div>
    </div>
  );
}
