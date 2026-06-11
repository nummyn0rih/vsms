/*
  Warnings:

  - The `summer_workdays` column on the `SeasonConfig` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `winter_workdays` column on the `SeasonConfig` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "SeasonConfig" DROP COLUMN "summer_workdays",
ADD COLUMN     "summer_workdays" INTEGER[],
DROP COLUMN "winter_workdays",
ADD COLUMN     "winter_workdays" INTEGER[];
