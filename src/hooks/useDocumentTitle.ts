import { useEffect } from "react";

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} — NoCut` : "NoCut — One Take. Every Time.";
    return () => {
      document.title = prev;
    };
  }, [title]);
}
