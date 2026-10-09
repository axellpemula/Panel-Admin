import { redirect } from "next/navigation";

/** Root langsung ke dashboard (middleware akan mengarahkan ke /login kalau belum masuk). */
export default function RootPage() {
  redirect("/dashboard");
}
