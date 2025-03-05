import {
  describe,
  expect,
  test,
  beforeAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { gameManager } from "./liars_dice";

describe("Liar's Dice Server", () => {
  const testPlayers = Array.from({ length: 4 }, (_, i) => `player${i + 1}`);

  beforeAll(() => {
    // Reset game state before all tests
    gameManager["game"] = null;
  });

  beforeEach(() => {
    gameManager["game"] = null;
  });

  describe("Game Creation", () => {
    test("POST /games - Create new game", async () => {
      // First creation should succeed
      const response1 = await fetch("http://localhost:3000/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: testPlayers[0] }),
      });
      expect(response1.status).toBe(200);
      const game1 = await response1.json();
      expect(game1).toMatchObject({
        state: "WAITING",
        players: [testPlayers[0]],
      });

      // Subsequent creation should fail
      const response2 = await fetch("http://localhost:3000/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "another-player" }),
      });
      expect(response2.status).toBe(500);
    });
  });

  describe("Game Joining", () => {
    beforeEach(async () => {
      await fetch("http://localhost:3000/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: testPlayers[0] }),
      });
    });

    test("POST /join - Successful join", async () => {
      const response = await fetch("http://localhost:3000/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: testPlayers[1] }),
      });

      expect(response.status).toBe(200);
      const game = await response.json();
      expect(game.players).toContain(testPlayers[1]);
    });

    test("POST /join - Game full", async () => {
      // Fill up the game
      for (let i = 1; i < 4; i++) {
        await fetch("http://localhost:3000/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: testPlayers[i] }),
        });
      }

      // Try to add extra player
      const response = await fetch("http://localhost:3000/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "extra-player" }),
      });
      expect(response.status).toBe(500);
    });

    test("Game starts automatically when full", async () => {
      // Add remaining players
      for (let i = 1; i < 4; i++) {
        await fetch("http://localhost:3000/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: testPlayers[i] }),
        });
      }

      const statusResponse = await fetch("http://localhost:3000/status");
      const game = await statusResponse.json();
      expect(game.state).toBe("IN_PROGRESS");
      expect(Object.values(game.dice).every((d: any) => d.length === 5)).toBe(
        true
      );
    });
  });

  describe("Bidding System", () => {
    beforeEach(async () => {
      // Create and fill game
      await fetch("http://localhost:3000/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: testPlayers[0] }),
      });
      for (let i = 1; i < 4; i++) {
        await fetch("http://localhost:3000/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: testPlayers[i] }),
        });
      }
    });

    test("POST /bid - Valid bid", async () => {
      const currentPlayer = gameManager.getGame()?.players[0];

      const response = await fetch("http://localhost:3000/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: currentPlayer,
          quantity: 2,
          face: 3,
        }),
      });

      expect(response.status).toBe(200);
      const game = await response.json();
      expect(game.currentBid).toEqual({
        quantity: 2,
        face: 3,
        playerId: currentPlayer,
      });
    });

    test("POST /bid - Turn timeout penalty", async () => {
      const initialPlayer = gameManager.getGame()!.players[0];
      const initialDice = gameManager.getGame()!.dice[initialPlayer].length;

      // Directly trigger timeout handler instead of waiting
      gameManager["handleTurnTimeout"]();

      const game = gameManager.getGame()!;
      expect(game.dice[initialPlayer].length).toBe(initialDice - 1);
      expect(game.currentPlayerIndex).not.toBe(0);
    });
  });

  describe("Challenge System", () => {
    beforeEach(async () => {
      // Create and fill game
      await fetch("http://localhost:3000/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: testPlayers[0] }),
      });
      for (let i = 1; i < 4; i++) {
        await fetch("http://localhost:3000/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: testPlayers[i] }),
        });
      }

      // Make a bid
      const currentPlayer = gameManager.getGame()?.players[0];
      await fetch("http://localhost:3000/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: currentPlayer,
          quantity: 10,
          face: 6,
        }),
      });
    });

    test("POST /challenge - Successful challenge", async () => {
      const challenger = gameManager.getGame()?.players[1];
      const response = await fetch("http://localhost:3000/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: challenger }),
      });

      expect(response.status).toBe(200);
      const game = await response.json();
      expect(game.round).toBe(2);
      expect(game.currentBid).toBeUndefined();
    });
  });

  describe("Game Completion", () => {
    test("Game ends when one player remains", async () => {
      // Create and fill game with 2 players
      await fetch("http://localhost:3000/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "playerA" }),
      });
      await fetch("http://localhost:3000/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "playerB" }),
      });

      // Force game to start with specific dice setup
      gameManager["game"] = {
        id: "LIARS_DICE",
        state: "IN_PROGRESS",
        players: ["playerA", "playerB"],
        dice: {
          playerA: [1], // Player A has 1 die left
          playerB: [2], // Player B has 1 die left
        },
        currentPlayerIndex: 0,
        round: 1,
        createdAt: Date.now(),
      };

      // Make bid
      await fetch("http://localhost:3000/bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: "playerA",
          quantity: 1,
          face: 1,
        }),
      });

      // Challenge
      await fetch("http://localhost:3000/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: "playerB" }),
      });

      const game = gameManager.getGame()!;
      expect(game.state).toBe("FINISHED");
      expect(game.winner).toBe("playerA");
    });
  });
});
