"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/spinner";
import type { HierarchyView } from "@/lib/services/hierarchy";

export interface HierarchyBoardLoaderProps {
  canManage: boolean;
  canEditRules?: boolean;
  /** `count` is the business's total locations, shown in the structure tree. */
  brands: Array<{ id: string; name: string; count?: number }>;
  tree: HierarchyView;
}

// Code splitting only works from a Client Component (dynamic imports from a
// Server Component are not split), so this thin loader keeps the 1,000+ line
// board out of the /locations route bundle until the page renders it.
const HierarchyBoard = dynamic(
  () => import("@/components/hierarchy-board").then((m) => m.HierarchyBoard),
  {
    loading: () => (
      <div className="flex items-center justify-center rounded-lg border border-line bg-white p-8" aria-busy="true">
        <Spinner />
      </div>
    ),
  }
);

export function HierarchyBoardLoader(props: HierarchyBoardLoaderProps) {
  return <HierarchyBoard {...props} />;
}
