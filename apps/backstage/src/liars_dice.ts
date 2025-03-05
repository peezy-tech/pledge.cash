import { Elysia, t } from "elysia";

const DEBUG = true; // Added DEBUG constant

type GameState = "WAITING" | "IN_PROGRESS" | "FINISHED";
type Bid = { quantity: number; face: number; playerId: string };

interface Game {
  id: string;
  state: GameState;
  players: string[];
  dice: Record<string, number[]>;
  currentBid?: Bid;
  currentPlayerIndex: number;
  round: number;
  winner?: string;
  createdAt: number;
  currentTurnTimeout?: NodeJS.Timeout;
}

const MAX_PLAYERS = 4;

class SingleGameManager {
  private game: Game | null = null;

  createGame(playerId: string): Game | null {
    if (this.game) return null;

    this.game = {
      id: "LIARS_DICE",
      state: "WAITING",
      players: [playerId],
      dice: {},
      currentPlayerIndex: 0,
      round: 1,
      createdAt: Date.now(),
    };

    if (DEBUG) {
      console.log(`Game created by ${playerId}`);
    }

    return this.game;
  }

  joinGame(playerId: string): Game | null {
    if (
      !this.game ||
      this.game.state !== "WAITING" ||
      this.game.players.length >= MAX_PLAYERS ||
      this.game.players.includes(playerId)
    )
      return null;

    this.game.players.push(playerId);

    if (DEBUG) {
      console.log(
        `${playerId} joined game. Players: ${this.game.players.join(", ")}`
      );
    }

    if (this.game.players.length === MAX_PLAYERS) {
      this.startGame();
    }
    return this.game;
  }

  private startGame() {
    if (!this.game) return;

    this.game.state = "IN_PROGRESS";
    this.game.players.forEach((player) => {
      this.game!.dice[player] = Array.from(
        { length: 5 },
        () => Math.floor(Math.random() * 6) + 1
      );
    });

    if (DEBUG) {
      console.log("Game started with players:", this.game.players);
      this.game.players.forEach((player) => {
        console.log(`${player}'s dice: ${this.game!.dice[player].join(", ")}`);
      });
    }

    this.startTurnTimeout();
  }

  private startTurnTimeout() {
    if (!this.game || this.game.state !== "IN_PROGRESS") return;

    if (this.game.currentTurnTimeout) {
      clearTimeout(this.game.currentTurnTimeout);
    }

    if (DEBUG) {
      console.log(`Starting turn timeout for ${this.getCurrentPlayer()}`);
    }

    this.game.currentTurnTimeout = setTimeout(() => {
      this.handleTurnTimeout();
    }, 30000);
  }

  private handleTurnTimeout() {
    if (!this.game || this.game.state !== "IN_PROGRESS") return;

    const currentPlayer = this.getCurrentPlayer();
    if (DEBUG) console.log(`Turn timeout for ${currentPlayer}`);

    this.removeDie(currentPlayer);

    if (this.checkForWinner()) return;

    this.moveToNextPlayer();
    this.startTurnTimeout();
  }

  private getCurrentPlayer(): string {
    return this.game?.players[this.game?.currentPlayerIndex] || "unknown";
  }

  private moveToNextPlayer() {
    if (!this.game) return;

    do {
      this.game.currentPlayerIndex =
        (this.game.currentPlayerIndex + 1) % this.game.players.length;
    } while (
      this.game.dice[this.game.players[this.game.currentPlayerIndex]]
        ?.length === 0
    );

    if (DEBUG) {
      console.log(`Current player changed to ${this.getCurrentPlayer()}`);
    }
  }

  makeBid(playerId: string, quantity: number, face: number): Game | null {
    if (
      !this.game ||
      this.game.state !== "IN_PROGRESS" ||
      this.game.players[this.game.currentPlayerIndex] !== playerId
    )
      return null;

    if (
      this.game.currentBid &&
      (quantity < this.game.currentBid.quantity ||
        (quantity === this.game.currentBid.quantity &&
          face <= this.game.currentBid.face))
    )
      return null;

    this.game.currentBid = { quantity, face, playerId };

    if (DEBUG) {
      console.log(`${playerId} bid ${quantity}x${face}`);
    }

    this.moveToNextPlayer();
    this.startTurnTimeout();
    return this.game;
  }

  challenge(playerId: string): Game | null {
    if (!this.game || !this.game.currentBid) return null;

    let total = 0;
    Object.values(this.game.dice).forEach((dice) => {
      total += dice.filter(
        (d) => d === this.game!.currentBid!.face || d === 1
      ).length;
    });

    const success = total >= this.game.currentBid.quantity;
    const loserId = success ? playerId : this.game.currentBid.playerId;

    if (DEBUG) {
      console.log(
        `${playerId} challenged. Total ${total} vs bid ${this.game.currentBid.quantity}. ` +
          `${success ? "Challenger loses" : "Bidder loses"}`
      );
    }

    this.removeDie(loserId);

    if (this.checkForWinner()) return this.game;

    this.game.round++;
    this.game.currentBid = undefined;

    // Re-roll dice for all players with remaining dice
    this.game.players.forEach((player) => {
      const diceCount = this.game!.dice[player].length;
      if (diceCount > 0) {
        this.game!.dice[player] = Array.from(
          { length: diceCount },
          () => Math.floor(Math.random() * 6) + 1
        );
      }
    });

    if (DEBUG) {
      console.log(`Starting round ${this.game.round}`);
      this.game.players.forEach((player) => {
        if (this.game!.dice[player].length > 0) {
          console.log(
            `${player}'s new dice: ${this.game!.dice[player].join(", ")}`
          );
        }
      });
    }

    this.moveToNextPlayer();
    this.startTurnTimeout();
    return this.game;
  }

  private removeDie(playerId: string) {
    if (!this.game) return;
    const dice = this.game.dice[playerId];
    if (dice && dice.length > 0) {
      dice.pop();
      if (DEBUG) {
        console.log(`${playerId} lost a die. Remaining: ${dice.length}`);
        if (dice.length === 0) {
          console.log(`${playerId} has no dice left!`);
        }
      }
    }
  }

  private checkForWinner(): boolean {
    if (!this.game) return false;

    const remaining = this.game.players.filter(
      (p) => this.game!.dice[p]?.length > 0
    );

    if (remaining.length === 1) {
      this.game.state = "FINISHED";
      this.game.winner = remaining[0];
      if (this.game.currentTurnTimeout) {
        clearTimeout(this.game.currentTurnTimeout);
      }

      if (DEBUG) {
        console.log(`Game over! Winner: ${this.game.winner}`);
      }

      return true;
    }
    return false;
  }

  getGame(): Game | null {
    return this.game;
  }
}

export const gameManager = new SingleGameManager();

const app = new Elysia()
  .get("/", () => ({ msg: "Liar's Dice - Single Game Server" }))
  .post(
    "/games",
    ({ body }) => {
      const game = gameManager.createGame(body.playerId);
      if (!game) throw new Error("Game already exists");
      if (DEBUG) console.log(`POST /games - Created by ${body.playerId}`);
      return game;
    },
    { body: t.Object({ playerId: t.String() }) }
  )
  .post(
    "/join",
    ({ body }) => {
      const game = gameManager.joinGame(body.playerId);
      if (!game) throw new Error("Cannot join game");
      if (DEBUG) console.log(`POST /join - ${body.playerId} joined`);
      return game;
    },
    { body: t.Object({ playerId: t.String() }) }
  )
  .post(
    "/bid",
    ({ body }) => {
      const game = gameManager.makeBid(body.playerId, body.quantity, body.face);
      if (!game) throw new Error("Invalid bid");
      if (DEBUG)
        console.log(
          `POST /bid - ${body.playerId} bid ${body.quantity}x${body.face}`
        );
      return game;
    },
    {
      body: t.Object({
        playerId: t.String(),
        quantity: t.Number(),
        face: t.Number(),
      }),
    }
  )
  .post(
    "/challenge",
    ({ body }) => {
      const game = gameManager.challenge(body.playerId);
      if (!game) throw new Error("Challenge failed");
      if (DEBUG) console.log(`POST /challenge - ${body.playerId} challenged`);
      return game;
    },
    { body: t.Object({ playerId: t.String() }) }
  )
  .get("/status", () => {
    if (DEBUG) console.log("GET /status");
    return gameManager.getGame();
  })
  .listen(3000);

console.log("Liar's Dice server running on port 3000");
