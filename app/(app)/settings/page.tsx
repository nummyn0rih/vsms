import { redirect } from "next/navigation";

// /settings — без собственного контента: ведём на первую вкладку.
export default function SettingsPage() {
  redirect("/settings/seasons");
}
