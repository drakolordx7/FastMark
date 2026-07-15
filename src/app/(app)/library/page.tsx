import { Suspense } from "react";
import LibraryClient from "./LibraryClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="text-sm" style={{ color: "var(--muted)" }}>
          Loading…
        </div>
      }
    >
      <LibraryClient />
    </Suspense>
  );
}
