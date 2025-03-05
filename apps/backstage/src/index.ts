import { Elysia, t } from 'elysia'
// import { cors } from '@elysiajs/cors'

type GameState = 'WAITING' | 'IN_PROGRESS' | 'FINISHED'
type Move = 'ROCK' | 'PAPER' | 'SCISSORS'

interface Game {
  id: string
  state: GameState
  player1: string
  player2?: string
  moves: {
    [playerId: string]: Move
  }
  winner?: string
  createdAt: number
}

class GameManager {
  private games: Map<string, Game> = new Map()

  createGame(player1: string): Game {
    const game: Game = {
      id: crypto.randomUUID(),
      state: 'WAITING',
      player1,
      moves: {},
      createdAt: Date.now()
    }
    this.games.set(game.id, game)
    return game
  }

  joinGame(gameId: string, player2: string): Game | null {
    const game = this.games.get(gameId)
    if (!game || game.state !== 'WAITING') return null

    game.player2 = player2
    game.state = 'IN_PROGRESS'
    return game
  }

  makeMove(gameId: string, playerId: string, move: Move): Game | null {
    const game = this.games.get(gameId)
    if (!game || game.state !== 'IN_PROGRESS') return null

    if (playerId !== game.player1 && playerId !== game.player2) return null
    if (game.moves[playerId]) return null

    game.moves[playerId] = move

    // Check if both players made their moves
    if (Object.keys(game.moves).length === 2) {
      this.determineWinner(game)
      game.state = 'FINISHED'
    }

    return game
  }

  private determineWinner(game: Game) {
    const move1 = game.moves[game.player1]
    const move2 = game.moves[game.player2!]

    if (move1 === move2) {
      game.winner = 'DRAW'
      return
    }

    const winningMoves = {
      ROCK: 'SCISSORS',
      PAPER: 'ROCK',
      SCISSORS: 'PAPER'
    }

    game.winner = winningMoves[move1] === move2 ? game.player1 : game.player2
  }

  getGame(gameId: string): Game | null {
    return this.games.get(gameId) || null
  }

  // Cleanup old games periodically
  cleanup() {
    const oneHourAgo = Date.now() - 3600000
    for (const [id, game] of this.games.entries()) {
      if (game.createdAt < oneHourAgo) {
        this.games.delete(id)
      }
    }
  }
}

const gameManager = new GameManager()

// Run cleanup every hour
setInterval(() => gameManager.cleanup(), 3600000)

const app = new Elysia()
  // .use(cors())
  .post('/games', 
    ({ body }) => {
      const game = gameManager.createGame(body.playerId)
      return { gameId: game.id }
    },
    {
      body: t.Object({
        playerId: t.String()
      })
    }
  )
  .post('/games/:gameId/join',
    ({ params, body }) => {
      const game = gameManager.joinGame(params.gameId, body.playerId)
      if (!game) throw new Error('Game not found or not joinable')
      return game
    },
    {
      body: t.Object({
        playerId: t.String()
      })
    }
  )
  .post('/games/:gameId/move',
    ({ params, body }) => {
      const game = gameManager.makeMove(params.gameId, body.playerId, body.move)
      if (!game) throw new Error('Invalid move or game not found')

        // todo: if both players moved

      return game
    },
    {
      body: t.Object({
        playerId: t.String(),
        move: t.Union([
          t.Literal('ROCK'),
          t.Literal('PAPER'),
          t.Literal('SCISSORS')
        ])
      })
    }
  )
  .get('/games/:gameId', ({ params }) => {
    const game = gameManager.getGame(params.gameId)
    if (!game) throw new Error('Game not found')
    return game
  })
  .listen(3000)

console.log('Game server running on port 3000')