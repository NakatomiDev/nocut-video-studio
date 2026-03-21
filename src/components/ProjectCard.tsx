import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MoreHorizontal, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

const statusColors: Record<string, string> = {
  uploading: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  transcoding: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  detecting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  ready: "bg-green-500/20 text-green-400 border-green-500/30",
  complete: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

interface ProjectCardProps {
  title: string;
  status: string;
  date: string;
}

const ProjectCard = ({ title, status, date }: ProjectCardProps) => (
  <Card className="group cursor-pointer border-border transition-colors hover:border-primary/40">
    <div className="flex aspect-video items-center justify-center rounded-t-lg bg-muted">
      <Video className="h-10 w-10 text-muted-foreground" />
    </div>
    <CardContent className="flex items-start justify-between p-4">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{date}</p>
        <Badge
          variant="outline"
          className={`mt-2 text-[10px] font-medium capitalize ${statusColors[status] ?? ""}`}
        >
          {status}
        </Badge>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </CardContent>
  </Card>
);

export default ProjectCard;
