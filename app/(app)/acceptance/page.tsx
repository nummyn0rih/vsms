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
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-semibold tracking-tight">Приёмка</h1>
        <p className="text-sm text-muted-foreground">
          Перевеска прибывших машин · ввод фактического веса партий
        </p>
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
