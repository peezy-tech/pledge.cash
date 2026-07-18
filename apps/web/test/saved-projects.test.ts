import { describe, expect, test } from "bun:test";
import type { Address } from "@pledge.cash/sdk";
import {
  SAVED_PROJECTS_STORAGE_KEY,
  loadSavedProjects,
  persistSavedProjects,
  savedProjectIsPresent,
  savedProjectKey,
  savedProjectsForChain,
  toggleSavedProject,
  type SavedProjectsStorage,
} from "../src/lib/saved-projects";

const boardroom = "0x1000000000000000000000000000000000000000" as Address;
const uppercaseBoardroom = `0x${boardroom.slice(2).toUpperCase()}` as Address;

describe("saved projects", () => {
  test("keys identities by chain and normalized Boardroom address", () => {
    expect(savedProjectKey(31337, uppercaseBoardroom)).toBe(`31337:${boardroom}`);
  });

  test("toggles the same Boardroom independently on different chains", () => {
    const local = { boardroom, chainId: 31337, name: "Atlas", symbol: "ATLAS" };
    const first = toggleSavedProject([], local, 100);
    const both = toggleSavedProject(first, { ...local, chainId: 998 }, 200);

    expect(both).toHaveLength(2);
    expect(savedProjectIsPresent(both, 31337, boardroom)).toBe(true);
    expect(savedProjectIsPresent(both, 998, boardroom)).toBe(true);
    expect(savedProjectsForChain(both, 998).map((project) => project.chainId)).toEqual([998]);

    const remoteOnly = toggleSavedProject(both, local, 300);
    expect(savedProjectIsPresent(remoteOnly, 31337, boardroom)).toBe(false);
    expect(savedProjectIsPresent(remoteOnly, 998, boardroom)).toBe(true);
  });

  test("round-trips normalized project metadata through browser storage", () => {
    const storage = memoryStorage();
    const projects = toggleSavedProject([], {
      boardroom: uppercaseBoardroom,
      chainId: 31337,
      name: "  Atlas Cooperative  ",
      symbol: " ATLAS ",
    }, 123);

    expect(persistSavedProjects(projects, storage)).toEqual({ status: "available" });
    expect(loadSavedProjects(storage)).toEqual({
      projects: [{ boardroom, chainId: 31337, name: "Atlas Cooperative", savedAt: 123, symbol: "ATLAS" }],
      status: "available",
    });
  });

  test("fails safely for corrupt or unavailable storage", () => {
    const corrupt = memoryStorage("not json");
    const unavailable: SavedProjectsStorage = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
    };

    expect(loadSavedProjects(corrupt)).toMatchObject({ projects: [], status: "corrupt" });
    expect(loadSavedProjects(corrupt).warning).toContain("invalid");
    const repaired = toggleSavedProject([], { boardroom, chainId: 31337 }, 456);
    expect(persistSavedProjects(repaired, corrupt)).toEqual({ status: "available" });
    expect(loadSavedProjects(corrupt)).toMatchObject({ projects: repaired, status: "available" });
    expect(loadSavedProjects(unavailable)).toMatchObject({ projects: [], status: "unavailable" });
    expect(persistSavedProjects([], unavailable)).toEqual({
      status: "unavailable",
      warning: "Saved projects are available only for this tab because browser storage is unavailable.",
    });
  });

  test("rejects malformed project identities without partially restoring the list", () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      projects: [{ boardroom: "0xdead", chainId: 31337, savedAt: 123 }],
    }));

    expect(loadSavedProjects(storage)).toMatchObject({ projects: [], status: "corrupt" });
  });
});

function memoryStorage(initial?: string): SavedProjectsStorage {
  let value = initial ?? null;
  return {
    getItem(key) {
      return key === SAVED_PROJECTS_STORAGE_KEY ? value : null;
    },
    setItem(key, next) {
      if (key === SAVED_PROJECTS_STORAGE_KEY) value = next;
    },
  };
}
