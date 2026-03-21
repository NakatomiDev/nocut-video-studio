import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Scissors, Video } from "lucide-react";
import ProjectCard from "@/components/ProjectCard";

// Mock data — will be replaced with Supabase query
const mockProjects: { id: string; title: string; status: string; date: string }[] = [];

const Dashboard = () => {
  const [projects] = useState(mockProjects);

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">My Projects</h1>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="mt-24 flex flex-col items-center justify-center text-center">
          <div className="relative mb-6">
            <Video className="h-16 w-16 text-muted-foreground" />
            <Scissors className="absolute -right-2 -top-2 h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">No projects yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Upload your first video to get started
          </p>
          <Button className="mt-6 gap-2">
            <Plus className="h-4 w-4" />
            Upload Video
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} title={p.title} status={p.status} date={p.date} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
