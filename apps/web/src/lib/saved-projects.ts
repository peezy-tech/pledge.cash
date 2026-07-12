import type { Address } from "@pledge.cash/sdk";
import { isAddress } from "viem";

export const SAVED_PROJECTS_STORAGE_KEY = "pledge.cash.saved-projects.v1";

const SAVED_PROJECTS_VERSION = 1;
const MAX_SAVED_PROJECTS = 250;

export type SavedProject = {
  boardroom: Address;
  chainId: number;
  name?: string | undefined;
  savedAt: number;
  symbol?: string | undefined;
};

export type SavedProjectInput = Omit<SavedProject, "savedAt">;

export type SavedProjectsStorage = Pick<Storage, "getItem" | "setItem">;

export type SavedProjectsStatus = "available" | "corrupt" | "unavailable";

export type SavedProjectsState = {
  projects: SavedProject[];
  status: SavedProjectsStatus;
  warning?: string | undefined;
};

type StoredSavedProjects = {
  projects: SavedProject[];
  version: typeof SAVED_PROJECTS_VERSION;
};

export function savedProjectKey(chainId: number, boardroom: Address | string): string {
  return `${chainId.toString()}:${boardroom.toLowerCase()}`;
}

export function loadSavedProjects(storage: SavedProjectsStorage | undefined = browserSavedProjectsStorage()): SavedProjectsState {
  if (!storage) return unavailableSavedProjects();

  let raw: string | null;
  try {
    raw = storage.getItem(SAVED_PROJECTS_STORAGE_KEY);
  } catch {
    return unavailableSavedProjects();
  }
  if (raw === null) return { projects: [], status: "available" };

  try {
    const parsed = JSON.parse(raw) as unknown;
    const projects = parseStoredSavedProjects(parsed);
    return { projects, status: "available" };
  } catch {
    return {
      projects: [],
      status: "corrupt",
      warning: "Saved project data in this browser is invalid. Saving a project will replace it with a clean list.",
    };
  }
}

export function persistSavedProjects(
  projects: readonly SavedProject[],
  storage: SavedProjectsStorage | undefined = browserSavedProjectsStorage(),
): Pick<SavedProjectsState, "status" | "warning"> {
  if (!storage) return unavailableSavedProjectsPersistence();

  const payload: StoredSavedProjects = {
    projects: normalizeSavedProjects(projects),
    version: SAVED_PROJECTS_VERSION,
  };
  try {
    storage.setItem(SAVED_PROJECTS_STORAGE_KEY, JSON.stringify(payload));
    return { status: "available" };
  } catch {
    return unavailableSavedProjectsPersistence();
  }
}

export function toggleSavedProject(
  projects: readonly SavedProject[],
  project: SavedProjectInput,
  savedAt = Date.now(),
): SavedProject[] {
  const normalized = normalizeSavedProject({ ...project, savedAt });
  if (!normalized) throw new Error("Cannot save an invalid project identity.");

  const key = savedProjectKey(normalized.chainId, normalized.boardroom);
  if (projects.some((candidate) => savedProjectKey(candidate.chainId, candidate.boardroom) === key)) {
    return projects.filter((candidate) => savedProjectKey(candidate.chainId, candidate.boardroom) !== key);
  }
  return normalizeSavedProjects([normalized, ...projects]);
}

export function savedProjectsForChain(projects: readonly SavedProject[], chainId: number): SavedProject[] {
  return projects.filter((project) => project.chainId === chainId);
}

export function savedProjectIsPresent(
  projects: readonly SavedProject[],
  chainId: number,
  boardroom: Address | string,
): boolean {
  const key = savedProjectKey(chainId, boardroom);
  return projects.some((project) => savedProjectKey(project.chainId, project.boardroom) === key);
}

function parseStoredSavedProjects(value: unknown): SavedProject[] {
  if (!isRecord(value) || value.version !== SAVED_PROJECTS_VERSION || !Array.isArray(value.projects)) {
    throw new Error("Invalid saved-project payload.");
  }
  if (value.projects.length > MAX_SAVED_PROJECTS) throw new Error("Saved-project payload is too large.");

  const projects = value.projects.map((project) => normalizeSavedProject(project));
  if (projects.some((project) => project === undefined)) throw new Error("Invalid saved project.");
  return normalizeSavedProjects(projects as SavedProject[]);
}

function normalizeSavedProjects(projects: readonly SavedProject[]): SavedProject[] {
  const byIdentity = new Map<string, SavedProject>();
  for (const candidate of projects) {
    const project = normalizeSavedProject(candidate);
    if (!project) continue;
    const key = savedProjectKey(project.chainId, project.boardroom);
    const existing = byIdentity.get(key);
    if (!existing || project.savedAt > existing.savedAt) byIdentity.set(key, project);
  }
  return [...byIdentity.values()]
    .sort((left, right) => right.savedAt - left.savedAt || savedProjectKey(left.chainId, left.boardroom).localeCompare(savedProjectKey(right.chainId, right.boardroom)))
    .slice(0, MAX_SAVED_PROJECTS);
}

function normalizeSavedProject(value: unknown): SavedProject | undefined {
  if (!isRecord(value)) return undefined;
  if (!Number.isSafeInteger(value.chainId) || (value.chainId as number) <= 0) return undefined;
  if (typeof value.boardroom !== "string" || !isAddress(value.boardroom, { strict: false })) return undefined;
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt) || value.savedAt < 0) return undefined;
  if (!optionalLabel(value.name) || !optionalLabel(value.symbol)) return undefined;

  const name = normalizedLabel(value.name);
  const symbol = normalizedLabel(value.symbol);
  return {
    boardroom: value.boardroom.toLowerCase() as Address,
    chainId: value.chainId as number,
    savedAt: value.savedAt,
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
  };
}

function optionalLabel(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length <= 160);
}

function normalizedLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function browserSavedProjectsStorage(): SavedProjectsStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function unavailableSavedProjects(): SavedProjectsState {
  return {
    projects: [],
    ...unavailableSavedProjectsPersistence(),
  };
}

function unavailableSavedProjectsPersistence(): Pick<SavedProjectsState, "status" | "warning"> {
  return {
    status: "unavailable",
    warning: "Saved projects are available only for this tab because browser storage is unavailable.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
