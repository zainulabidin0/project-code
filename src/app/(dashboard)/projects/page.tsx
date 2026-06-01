import { Suspense } from "react";
import { ProjectsList } from "./ProjectsList";

export default function ProjectsPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading projects…</p>}>
      <ProjectsList />
    </Suspense>
  );
}
