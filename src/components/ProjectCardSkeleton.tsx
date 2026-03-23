import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

const ProjectCardSkeleton = () => (
  <Card className="border-border">
    <div className="aspect-video overflow-hidden rounded-t-lg">
      <Skeleton className="h-full w-full rounded-none" />
    </div>
    <CardContent className="p-4 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </CardContent>
  </Card>
);

export default ProjectCardSkeleton;
