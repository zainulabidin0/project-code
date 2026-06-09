import Link from "next/link";

type ProjectSubNavProps = {
  projectId: string;
  active?: "overview" | "reviews" | "reviews-settings" | "shopassist" | "courier";
};

const linkClass = "text-emerald-500 hover:underline";
const activeClass = "text-white font-medium";

export function ProjectSubNav({ projectId, active }: ProjectSubNavProps) {
  const base = `/projects/${projectId}`;

  return (
    <p className="mt-2 flex flex-wrap gap-4 text-sm">
      <Link
        href={base}
        className={active === "overview" ? activeClass : linkClass}
      >
        Overview
      </Link>
      <Link
        href={`${base}/reviews`}
        className={active === "reviews" ? activeClass : linkClass}
      >
        Reviews & sentiment
      </Link>
      <Link
        href={`${base}/reviews/settings`}
        className={active === "reviews-settings" ? activeClass : linkClass}
      >
        Public reviews page
      </Link>
      <Link
        href={`${base}/shopassist`}
        className={active === "shopassist" ? activeClass : linkClass}
      >
        ShopAssist
      </Link>
      <Link
        href={`${base}/courier`}
        className={active === "courier" ? activeClass : linkClass}
      >
        Courier compare
      </Link>
    </p>
  );
}
