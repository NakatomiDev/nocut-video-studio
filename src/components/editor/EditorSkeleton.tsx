import { Skeleton } from "@/components/ui/skeleton";

const EditorSkeleton = () => (
  <div className="flex h-screen flex-col bg-background">
    {/* Top bar skeleton */}
    <div className="flex items-center gap-3 border-b border-border px-4 py-2">
      <Skeleton className="h-8 w-8 rounded" />
      <Skeleton className="h-4 w-40" />
    </div>

    <div className="flex flex-1 overflow-hidden">
      {/* Left: video + timeline */}
      <div className="flex flex-1 flex-col">
        <div className="h-[60%] p-2">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
        <div className="h-[40%] p-2">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </div>

      {/* Right sidebar skeleton */}
      <div className="w-[280px] shrink-0 border-l border-border bg-card p-4 space-y-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-3 w-24" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
        <Skeleton className="h-9 w-full rounded-md mt-auto" />
      </div>
    </div>
  </div>
);

export default EditorSkeleton;
