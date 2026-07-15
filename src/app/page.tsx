import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export default async function HomePage() {
  try {
    const [row] = await db.select({ n: count() }).from(users);
    if ((row?.n ?? 0) === 0) redirect("/setup");
  } catch {
    redirect("/setup");
  }
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect("/library");
}
