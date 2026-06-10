-- AlterTable
ALTER TABLE "CalibreResult" ADD COLUMN     "contract_line_id" INTEGER;

-- AlterTable
ALTER TABLE "ContractLine" ADD COLUMN     "label" TEXT;

-- AddForeignKey
ALTER TABLE "CalibreResult" ADD CONSTRAINT "CalibreResult_contract_line_id_fkey" FOREIGN KEY ("contract_line_id") REFERENCES "ContractLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
