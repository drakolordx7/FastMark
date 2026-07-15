import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { collections } from "@/lib/db/schema";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const cols = await db
    .select()
    .from(collections)
    .where(eq(collections.userId, user.id))
    .orderBy(asc(collections.position), asc(collections.name));

  return (
    <Suspense fallback={<div className="p-4 text-sm">Loading…</div>}>
      <AppShell
        collections={cols.map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
          kind: c.kind,
        }))}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}
