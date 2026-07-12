import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SAVED_PROJECTS_STORAGE_KEY,
  loadSavedProjects,
  persistSavedProjects,
  savedProjectIsPresent,
  savedProjectsForChain,
  toggleSavedProject,
  type SavedProject,
  type SavedProjectInput,
  type SavedProjectsState,
  type SavedProjectsStorage,
} from "../lib/saved-projects";

export type SavedProjectsController = SavedProjectsState & {
  isSaved: (chainId: number, boardroom: string) => boolean;
  projectsForChain: (chainId: number) => SavedProject[];
  toggle: (project: SavedProjectInput) => void;
};

export function useSavedProjects(storage?: SavedProjectsStorage): SavedProjectsController {
  const [state, setState] = useState<SavedProjectsState>(() => loadSavedProjects(storage));

  useEffect(() => {
    if (storage || typeof window === "undefined") return;
    const synchronize = (event: StorageEvent): void => {
      if (event.key === SAVED_PROJECTS_STORAGE_KEY || event.key === null) {
        setState(loadSavedProjects());
      }
    };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, [storage]);

  const toggle = useCallback((project: SavedProjectInput): void => {
    setState((current) => {
      const projects = toggleSavedProject(current.projects, project);
      const persistence = persistSavedProjects(projects, storage);
      return { projects, ...persistence };
    });
  }, [storage]);

  return useMemo(() => ({
    ...state,
    isSaved: (chainId: number, boardroom: string) => savedProjectIsPresent(state.projects, chainId, boardroom),
    projectsForChain: (chainId: number) => savedProjectsForChain(state.projects, chainId),
    toggle,
  }), [state, toggle]);
}
