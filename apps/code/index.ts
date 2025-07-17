import { Bot } from "grammy";
import { query, type SDKMessage } from "@anthropic-ai/claude-code";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot(BOT_TOKEN);

async function runClaudePrompt(prompt: string): Promise<string> {
  const messages: SDKMessage[] = [];
  
  try {
    for await (const message of query({
      prompt,
      abortController: new AbortController(),
      options: {
        maxTurns: 3,
      },
    })) {
      messages.push(message);
    }
    
    // Look for the final result message
    const resultMessage = messages.find(msg => msg.type === "result");
    if (resultMessage && 'result' in resultMessage && typeof resultMessage.result === 'string') {
      return resultMessage.result;
    }
    
    // Fallback: collect text content from assistant messages
    let response = "";
    for (const message of messages) {
      if (message.type === "assistant" && 'message' in message && message.message?.content) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === "text" && typeof item.text === "string") {
              response += item.text + " ";
            }
          }
        }
      }
    }
    
    return response.trim() || "No response received";
  } catch (error) {
    console.error("Error running Claude prompt:", error);
    return "Sorry, I encountered an error while processing your request.";
  }
}

bot.command("start", (ctx) => {
  ctx.reply("Hello! I'm a Claude-powered bot. Send me any prompt and I'll process it using Claude Code SDK.");
});

bot.command("help", (ctx) => {
  ctx.reply(
    "Available commands:\n" +
    "/start - Start the bot\n" +
    "/help - Show this help message\n" +
    "\nOr just send me any message and I'll process it as a prompt!"
  );
});

bot.on("message:text", async (ctx) => {
  const prompt = ctx.message.text;
  
  if (prompt.startsWith("/")) {
    return;
  }
  
  await ctx.reply("Processing your prompt...");
  
  try {
    const response = await runClaudePrompt(prompt);
    await ctx.reply(response);
  } catch (error) {
    console.error("Error processing message:", error);
    await ctx.reply("Sorry, I encountered an error while processing your request.");
  }
});

bot.start();
console.log("Telegram bot is running...");