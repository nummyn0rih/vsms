import { getAcceptanceBoard } from "@/server/acceptance/board";
import { AcceptanceBoard } from "./_components/AcceptanceBoard";

export default async function AcceptancePage() {
  const board = await getAcceptanceBoard();

  return (
    <div className="mx-auto w-full max-w-[1880px]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Приёмка</h1>
        <p className="text-sm text-muted-foreground">
          Перевеска прибывших машин · ввод фактического веса партий
        </p>
      </div>

      <AcceptanceBoard board={board} />
    </div>
  );
}
