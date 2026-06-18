import { redirect } from "next/navigation";

// "/" больше не имеет своего пункта меню — лента живёт под /shipments.
// Логин/корень ведём сразу на ленту.
export default function HomePage() {
  redirect("/shipments");
}
