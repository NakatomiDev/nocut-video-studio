import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MoreHorizontal, Pencil, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

const statusColors: Record<string, string> = {
  uploading: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  transcoding: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  detecting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  generating: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  exporting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  ready: "bg-green-500/20 text-green-400 border-green-500/30",
  complete: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
};

interface ProjectCardProps {
  id: string;
  title: string;
  status: string;
  date: string;
  thumbnailUrl?: string | null;
}

const ProjectCard = ({ id, title, status, date, thumbnailUrl }: ProjectCardProps) => {
  const navigate = useNavigate();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  const [saving, setSaving] = useState(false);

  const handleRename = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === title) {
      setRenameOpen(false);
      return;
    }
    setSaving(true);
    await supabase.from("projects").update({ title: trimmed }).eq("id", id);
    setSaving(false);
    setRenameOpen(false);
  };

  const handleDelete = async () => {
    setSaving(true);
    await supabase.from("projects").delete().eq("id", id);
    setSaving(false);
    setDeleteOpen(false);
  };

  return (
    <>
      <Card
        className="group cursor-pointer border-border transition-colors hover:border-primary/40"
        onClick={() => {
          if (status === 'complete') {
            // For complete projects, check for an export first
            supabase
              .from('exports')
              .select('id')
              .eq('project_id', id)
              .order('created_at', { ascending: false })
              .limit(1)
              .single()
              .then(({ data }) => {
                if (data) {
                  navigate(`/project/${id}/export/${data.id}`);
                } else {
                  navigate(`/project/${id}`);
                }
              });
          } else {
            navigate(`/project/${id}`);
          }
        }}
      >
        <div className="relative aspect-video overflow-hidden rounded-t-lg bg-muted">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title}
              className="h-full w-full object-cover"
              style={{ objectPosition: 'left center' }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Video className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onClick={() => {
                  setNewTitle(title);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{title}" and all its associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ProjectCard;
