"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, Trash2 } from "lucide-react";

import { INGREDIENT_UNIT_LABELS } from "@/server/ingredients/schema";
import type {
  CultureOption,
  IngredientOption,
  RecipeRow,
} from "@/server/recipes/schema";
import {
  addRecipe,
  deleteRecipe,
  updateRecipeQty,
} from "@/server/recipes/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Props = {
  cultureOptions: CultureOption[];
  ingredientOptions: IngredientOption[];
  selectedCultureId?: number;
  recipes: RecipeRow[];
};

export function RecipesManager({
  cultureOptions,
  ingredientOptions,
  selectedCultureId,
  recipes,
}: Props) {
  const router = useRouter();

  function onCultureChange(value: string) {
    router.replace(`/settings/recipes?culture=${value}`);
  }

  return (
    <div className="grid gap-6">
      <div className="grid max-w-xs gap-2">
        <Label>Культура</Label>
        <Select
          value={selectedCultureId ? String(selectedCultureId) : undefined}
          onValueChange={onCultureChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Выберите культуру" />
          </SelectTrigger>
          <SelectContent>
            {cultureOptions.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedCultureId == null ? (
        <p className="text-sm text-muted-foreground">
          Выберите культуру, чтобы настроить её рецептуру.
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ингредиент</TableHead>
                <TableHead className="w-56">Расход на кг продукции</TableHead>
                <TableHead className="w-24 text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipes.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-center text-muted-foreground"
                  >
                    Рецептура пуста — добавьте ингредиент ниже
                  </TableCell>
                </TableRow>
              )}
              {recipes.map((row) => (
                <RecipeRowItem key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>

          <RoleGate allow={["admin"]}>
            <AddRecipeRow
              cultureId={selectedCultureId}
              ingredientOptions={ingredientOptions}
              usedIngredientIds={recipes.map((r) => r.ingredient_id)}
            />
          </RoleGate>
        </>
      )}
    </div>
  );
}

// Строка рецепта: правка количества inline (сохранение по кнопке, когда изменилось)
// + удаление.
function RecipeRowItem({ row }: { row: RecipeRow }) {
  const router = useRouter();
  const [qty, setQty] = useState(String(row.qty_per_kg_product));
  const [saving, setSaving] = useState(false);

  const changed = qty.trim() !== String(row.qty_per_kg_product);

  async function onSave() {
    setSaving(true);
    const res = await updateRecipeQty(row.id, Number(qty));
    setSaving(false);
    if (res.ok) {
      toast.success("Сохранено");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  async function onDelete() {
    const res = await deleteRecipe(row.id);
    if (res.ok) {
      toast.success("Строка удалена");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{row.ingredient_name}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="max-w-32"
          />
          <span className="text-sm text-muted-foreground">
            {INGREDIENT_UNIT_LABELS[row.ingredient_unit]}
          </span>
          <RoleGate allow={["admin"]}>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Сохранить количество"
              disabled={!changed || saving}
              onClick={onSave}
            >
              <Check className="size-4" />
            </Button>
          </RoleGate>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <RoleGate allow={["admin"]}>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="Удалить">
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Удалить «{row.ingredient_name}» из рецептуры?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Строка рецептуры будет удалена безвозвратно.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Удалить</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </RoleGate>
      </TableCell>
    </TableRow>
  );
}

// Форма добавления строки: Select ингредиента (без уже добавленных) + количество.
function AddRecipeRow({
  cultureId,
  ingredientOptions,
  usedIngredientIds,
}: {
  cultureId: number;
  ingredientOptions: IngredientOption[];
  usedIngredientIds: number[];
}) {
  const router = useRouter();
  const [ingredientId, setIngredientId] = useState<string>("");
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);

  const available = ingredientOptions.filter(
    (i) => !usedIngredientIds.includes(i.id),
  );
  const selectedUnit = ingredientOptions.find(
    (i) => String(i.id) === ingredientId,
  )?.unit;

  async function onAdd() {
    if (!ingredientId || !qty.trim()) {
      toast.error("Выберите ингредиент и укажите расход");
      return;
    }
    setSaving(true);
    const res = await addRecipe({
      culture_id: cultureId,
      ingredient_id: Number(ingredientId),
      qty_per_kg_product: Number(qty),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Ингредиент добавлен");
      setIngredientId("");
      setQty("");
      router.refresh();
    } else {
      const msg = res.fieldErrors
        ? Object.values(res.fieldErrors).flat()[0]
        : res.error;
      toast.error(msg ?? res.error);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t pt-4">
      <div className="grid gap-2">
        <Label>Ингредиент</Label>
        <Select value={ingredientId} onValueChange={setIngredientId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Выберите ингредиент" />
          </SelectTrigger>
          <SelectContent>
            {available.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                Все ингредиенты уже добавлены
              </div>
            ) : (
              available.map((i) => (
                <SelectItem key={i.id} value={String(i.id)}>
                  {i.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label>Расход на кг</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            placeholder="0.0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-32"
          />
          {selectedUnit && (
            <span className="text-sm text-muted-foreground">
              {INGREDIENT_UNIT_LABELS[selectedUnit]}
            </span>
          )}
        </div>
      </div>

      <Button type="button" disabled={saving} onClick={onAdd}>
        <Plus className="size-4" /> Добавить
      </Button>
    </div>
  );
}
