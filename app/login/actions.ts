"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

// Server action: вход по логину/паролю. Возвращает текст ошибки или редиректит.
export async function login(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      login: formData.get("login"),
      password: formData.get("password"),
      redirectTo: "/shipments",
    });
  } catch (error) {
    // Успешный вход бросает NEXT_REDIRECT — его пробрасываем дальше.
    if (error instanceof AuthError) {
      return "Неверный логин или пароль";
    }
    throw error;
  }
}
