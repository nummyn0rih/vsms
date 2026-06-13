-- B2.5 — тип тары на уровне позиции отгрузки, норма по тройке.
-- РУЧНАЯ миграция: перенос данных идёт ДО дропа колонки. Postgres оборачивает
-- миграцию в транзакцию, поэтому RAISE EXCEPTION в guard откатит всё целиком.

-- CreateTable: разрешённые типы тары культуры (m2m + дефолт)
CREATE TABLE "CulturePackagingType" (
    "id" SERIAL NOT NULL,
    "culture_id" INTEGER NOT NULL,
    "packaging_type_id" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CulturePackagingType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CulturePackagingType_culture_id_packaging_type_id_key" ON "CulturePackagingType"("culture_id", "packaging_type_id");

-- Перенос 1: текущий тип каждой культуры → дефолтный разрешённый тип.
INSERT INTO "CulturePackagingType" ("culture_id", "packaging_type_id", "is_default")
SELECT "id", "packaging_type_id", true
FROM "Culture"
WHERE "packaging_type_id" IS NOT NULL;

-- PackagingNorm: новая колонка nullable → backfill → guard → NOT NULL.
ALTER TABLE "PackagingNorm" ADD COLUMN "packaging_type_id" INTEGER;

-- Перенос 2: норме проставляем дефолтный тип её культуры.
UPDATE "PackagingNorm" pn
SET "packaging_type_id" = c."packaging_type_id"
FROM "Culture" c
WHERE c."id" = pn."culture_id";

-- Защита: норма у культуры без типа тары (была NULL) осталась без типа — не теряем
-- молча, останавливаем миграцию со списком id для ручного разбора.
DO $$
DECLARE orphan_ids text;
BEGIN
  SELECT string_agg("id"::text, ', ') INTO orphan_ids
  FROM "PackagingNorm" WHERE "packaging_type_id" IS NULL;
  IF orphan_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Осиротевшие PackagingNorm (культура без типа тары), id: %. Разберите вручную.', orphan_ids;
  END IF;
END $$;

ALTER TABLE "PackagingNorm" ALTER COLUMN "packaging_type_id" SET NOT NULL;

-- Уникум пары → тройка.
DROP INDEX "PackagingNorm_farmer_id_culture_id_key";
CREATE UNIQUE INDEX "PackagingNorm_farmer_id_culture_id_packaging_type_id_key" ON "PackagingNorm"("farmer_id", "culture_id", "packaging_type_id");

-- ShipmentItem: тип тары позиции (nullable = навал).
ALTER TABLE "ShipmentItem" ADD COLUMN "packaging_type_id" INTEGER;

-- Дроп старого поля культуры (+ его FK). Данные уже перенесены в CulturePackagingType.
ALTER TABLE "Culture" DROP CONSTRAINT "Culture_packaging_type_id_fkey";
ALTER TABLE "Culture" DROP COLUMN "packaging_type_id";

-- AddForeignKey
ALTER TABLE "CulturePackagingType" ADD CONSTRAINT "CulturePackagingType_culture_id_fkey" FOREIGN KEY ("culture_id") REFERENCES "Culture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CulturePackagingType" ADD CONSTRAINT "CulturePackagingType_packaging_type_id_fkey" FOREIGN KEY ("packaging_type_id") REFERENCES "PackagingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackagingNorm" ADD CONSTRAINT "PackagingNorm_packaging_type_id_fkey" FOREIGN KEY ("packaging_type_id") REFERENCES "PackagingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_packaging_type_id_fkey" FOREIGN KEY ("packaging_type_id") REFERENCES "PackagingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
