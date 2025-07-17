# Claude Code Telegram Bot

A Telegram bot that integrates with the Claude Code SDK to process prompts.

## Setup

1. Create a new Telegram bot via [@BotFather](https://t.me/BotFather)
2. Copy the bot token
3. Create a `.env` file based on `.env.example`:
   ```
   BOT_TOKEN=your_telegram_bot_token_here
   ```

## Usage

### Development
```bash
bun dev
```

### Production
```bash
bun start
```

## Features

- **Text Processing**: Send any text message to the bot and it will process it using Claude Code SDK
- **Commands**:
  - `/start` - Welcome message
  - `/help` - Show available commands
- **Error Handling**: Graceful error handling for API failures

## Environment Variables

- `BOT_TOKEN` - Your Telegram bot token (required)

## How it works

1. Users send messages to the Telegram bot
2. The bot forwards the message to Claude Code SDK
3. Claude processes the prompt and returns a response
4. The bot sends the response back to the user