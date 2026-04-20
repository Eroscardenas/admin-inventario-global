// src/app/page.tsx
import { redirect } from "next/navigation";

export default function Home() {
  // Server Component: NO importes Firebase aquí.
  redirect("/login");
}
