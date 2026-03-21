import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Plus, Scissors, Video } from "lucide-react";
import ProjectCard from "@/components/ProjectCard";
import { supabase } from "@/integrations/supabase/client";

interface Project {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

const Dashboard = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProjects = async () => {
      // Ensure the client has the current session token before querying
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        console.error("Dashboard: no active Supabase session");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("projects")
        .select("id, title, status, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Dashboard: failed to fetch projects:", error.message, error.details);
      } else {
        console.log("Dashboard: fetched", data?.length ?? 0, "projects");
        setProjects(data ?? []);
      }
      setLoading(false);
    };

    fetchProjects();

    const channel = supabase
      .channel("projects-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setProjects((prev) => [payload.new as Project, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setProjects((prev) =>
              prev.map((p) => (p.id === (payload.new as Project).id ? (payload.new as Project) : p))
            );
          } else if (payload.eventType === "DELETE") {
            setProjects((prev) => prev.filter((p) => p.id !== (payload.old as { id: string }).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">My Projects</h1>
        <Button className="gap-2" onClick={() => navigate("/upload")}>
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {loading ? (
        <div className="mt-24 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-24 flex flex-col items-center justify-center text-center">
          <div className="relative mb-6">
            <Video className="h-16 w-16 text-muted-foreground" />
            <Scissors className="absolute -right-2 -top-2 h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">No projects yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Upload a video to get started with NoCut
          </p>
          <Button className="mt-6 gap-2" onClick={() => navigate("/upload")}>
            <Plus className="h-4 w-4" />
            Upload Video
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              id={p.id}
              title={p.title}
              status={p.status}
              date={formatDate(p.created_at)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
