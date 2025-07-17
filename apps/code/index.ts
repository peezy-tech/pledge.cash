import { Bot } from "grammy";
import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import { promises as fs } from "fs";
import path from "path";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot(BOT_TOKEN);

// Session management
const SESSION_FILE = path.join(process.cwd(), "bot-session.json");

interface SessionData {
  sessionId: string | null;
  turnCount: number;
  totalCost: number;
  lastActivity: string;
}

interface ConversationTurn {
  timestamp: string;
  userMessage: string;
  claudeResponse: string;
  cost: number;
  turns: number;
}

let currentSession: SessionData = {
  sessionId: null,
  turnCount: 0,
  totalCost: 0,
  lastActivity: new Date().toISOString(),
};

// Load session on startup
async function loadSession(): Promise<void> {
  try {
    console.log('📂 Loading session from file...');
    const data = await fs.readFile(SESSION_FILE, "utf-8");
    currentSession = JSON.parse(data);
    console.log('✅ Session loaded successfully:', currentSession.sessionId?.substring(0, 8) || 'No session ID');
  } catch (error) {
    console.log('⚠️  Session file not found or corrupted, creating new session');
    // File doesn't exist or is corrupted, use default session
    await saveSession();
  }
}

async function saveSession(): Promise<void> {
  try {
    console.log('💾 Saving session to file...');
    await fs.writeFile(SESSION_FILE, JSON.stringify(currentSession, null, 2));
    console.log('✅ Session saved successfully');
  } catch (error) {
    console.error("❌ Error saving session:", error);
  }
}

async function saveConversationTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
  try {
    const filename = `${sessionId}.md`;
    const filepath = path.join(process.cwd(), filename);
    
    const turnEntry = `## Turn ${turn.turns} - ${new Date(turn.timestamp).toLocaleString()}\n\n` +
      `**User:** ${turn.userMessage}\n\n` +
      `**Claude:** ${turn.claudeResponse}\n\n` +
      `*Cost: $${turn.cost.toFixed(4)}*\n\n---\n\n`;
    
    // Append to existing file or create new one
    await fs.appendFile(filepath, turnEntry);
    console.log(`📝 Conversation turn saved to ${filename}`);
  } catch (error) {
    console.error("❌ Error saving conversation turn:", error);
  }
}

async function resetSession(): Promise<void> {
  console.log('🔄 Resetting session...');
  currentSession = {
    sessionId: null,
    turnCount: 0,
    totalCost: 0,
    lastActivity: new Date().toISOString(),
  };
  await saveSession();
  console.log('✅ Session reset complete');
}

async function runClaudePrompt(
  prompt: string,
  onProgress?: (status: string) => void,
  onStream?: (chunk: string) => void
): Promise<{ response: string; sessionId: string; cost: number; turns: number }> {
  const messages: SDKMessage[] = [];
  let streamedResponse = "";
  let finalResponse = "";
  let sessionId = "";
  let cost = 0;
  let turns = 0;
  
  try {
    console.log('🤖 Starting Claude prompt processing...');
    onProgress?.("🤖 Initializing Claude...");
    
    const queryOptions: any = {
      prompt,
      abortController: new AbortController(),
      options: {
        maxTurns: 5,
        outputFormat: "stream-json",
      },
    };
    
    // Use resume if we have an active session
    if (currentSession.sessionId) {
      console.log('🔄 Resuming existing session:', currentSession.sessionId.substring(0, 8));
      queryOptions.options.resume = currentSession.sessionId;
      onProgress?.("🔄 Continuing conversation...");
    } else {
      console.log('🆕 Starting new Claude session...');
      onProgress?.("🆕 Starting new conversation...");
    }
    
    for await (const message of query(queryOptions)) {
      messages.push(message);
      
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        console.log('✅ Claude session initialized:', sessionId.substring(0, 8));
        onProgress?.("✅ Session initialized");
      }
      
      if (message.type === "assistant" && 'message' in message && message.message?.content) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === "text" && typeof item.text === "string") {
              const chunk = item.text;
              streamedResponse += chunk;
              onStream?.(chunk);
            }
          }
        }
      }
      
      if (message.type === "result") {
        console.log('📊 Claude response completed');
        if ('result' in message && typeof message.result === 'string') {
          finalResponse = message.result;
        }
        if ('total_cost_usd' in message && typeof message.total_cost_usd === 'number') {
          cost = message.total_cost_usd;
          console.log('💰 Turn cost:', cost.toFixed(4));
        }
        if ('num_turns' in message && typeof message.num_turns === 'number') {
          turns = message.num_turns;
          console.log('🔄 Turns used:', turns);
        }
        if ('session_id' in message && typeof message.session_id === 'string') {
          sessionId = message.session_id;
        }
      }
    }
    
    // Update session data
    console.log('📊 Updating session data...');
    currentSession.sessionId = sessionId;
    currentSession.turnCount += turns;
    currentSession.totalCost += cost;
    currentSession.lastActivity = new Date().toISOString();
    await saveSession();
    
    console.log('✅ Claude processing complete. Total cost:', currentSession.totalCost.toFixed(4));
    onProgress?.("✅ Response complete");
    
    return {
      response: finalResponse || streamedResponse || "No response received",
      sessionId,
      cost,
      turns,
    };
  } catch (error) {
    console.error("Error running Claude prompt:", error);
    onProgress?.("❌ Error occurred");
    
    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('ANTHROPIC_API_KEY')) {
        throw new Error('❌ API key not configured. Please set ANTHROPIC_API_KEY environment variable.');
      }
      if (error.message.includes('rate limit')) {
        throw new Error('⏱️ Rate limit exceeded. Please wait a moment and try again.');
      }
      if (error.message.includes('timeout')) {
        throw new Error('⏱️ Request timed out. Please try again with a shorter prompt.');
      }
      if (error.message.includes('network')) {
        throw new Error('🌐 Network error. Please check your connection and try again.');
      }
      throw new Error(`❌ Claude processing failed: ${error.message}`);
    }
    
    throw new Error('❌ An unknown error occurred during processing.');
  }
}

bot.command("start", async (ctx) => {
  console.log('🚀 /start command received from user:', ctx.from?.username || ctx.from?.id);
  await loadSession();
  ctx.reply("Hello! I'm a Claude-powered bot with session management. Send me any prompt and I'll process it using Claude Code SDK.");
});

bot.command("help", (ctx) => {
  ctx.reply(
    "Available commands:\n" +
    "/start - Start the bot\n" +
    "/help - Show this help message\n" +
    "/newsession - Start a new conversation session\n" +
    "/continue - Continue current session\n" +
    "/reset - Reset current session\n" +
    "/session - Show session information\n" +
    "\nOr just send me any message and I'll process it as a prompt!"
  );
});

bot.command("newsession", async (ctx) => {
  console.log('🆕 /newsession command received from user:', ctx.from?.username || ctx.from?.id);
  await resetSession();
  ctx.reply("🆕 New session started! Previous conversation history cleared.");
});

bot.command("continue", async (ctx) => {
  console.log('🔄 /continue command received from user:', ctx.from?.username || ctx.from?.id);
  if (!currentSession.sessionId) {
    console.log('❌ No active session to continue');
    ctx.reply("❌ No active session to continue. Start a new conversation first.");
    return;
  }
  
  console.log('✅ Showing session info for continuation');
  ctx.reply(
    `🔄 Continuing session: ${currentSession.sessionId.substring(0, 8)}...\n` +
    `Turn count: ${currentSession.turnCount}\n` +
    `Total cost: $${currentSession.totalCost.toFixed(4)}\n` +
    "Send me a message to continue the conversation."
  );
});

bot.command("reset", async (ctx) => {
  console.log('🔄 /reset command received from user:', ctx.from?.username || ctx.from?.id);
  await resetSession();
  ctx.reply("🔄 Session reset! Starting fresh.");
});

bot.command("session", (ctx) => {
  console.log('📊 /session command received from user:', ctx.from?.username || ctx.from?.id);
  if (!currentSession.sessionId) {
    console.log('❌ No active session to show');
    ctx.reply("❌ No active session. Send a message to start one.");
    return;
  }
  
  console.log('✅ Showing session information');
  ctx.reply(
    `📊 **Session Information**\n` +
    `Session ID: \`${currentSession.sessionId}\`\n` +
    `Turn count: ${currentSession.turnCount}\n` +
    `Total cost: $${currentSession.totalCost.toFixed(4)}\n` +
    `Last activity: ${new Date(currentSession.lastActivity).toLocaleString()}`
  );
});

bot.on("message:text", async (ctx) => {
  const prompt = ctx.message.text;
  
  if (prompt.startsWith("/")) {
    return;
  }
  
  console.log('💬 New message received from user:', ctx.from?.username || ctx.from?.id);
  console.log('📝 Message preview:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
  
  let statusMessage = await ctx.reply("🤖 Processing your prompt...");
  let currentResponse = "";
  let lastUpdateTime = Date.now();
  
  try {
    const result = await runClaudePrompt(
      prompt,
      // Progress callback
      async (status: string) => {
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            statusMessage.message_id,
            status
          );
        } catch (error) {
          // Ignore edit errors (message might be too old)
        }
      },
      // Stream callback
      async (chunk: string) => {
        currentResponse += chunk;
        const now = Date.now();
        
        // Update every 2 seconds to avoid rate limiting
        if (now - lastUpdateTime > 2000) {
          try {
            await ctx.api.editMessageText(
              ctx.chat.id,
              statusMessage.message_id,
              `🤖 **Thinking...**\n\n${currentResponse.substring(0, 500)}${currentResponse.length > 500 ? "..." : ""}`
            );
            lastUpdateTime = now;
          } catch (error) {
            // Ignore edit errors
          }
        }
      }
    );
    
    // Send final response
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      `✅ **Response Complete**\n\n${result.response}`
    );
    
    // Save conversation turn to markdown file
    if (result.sessionId) {
      await saveConversationTurn(result.sessionId, {
        timestamp: new Date().toISOString(),
        userMessage: prompt,
        claudeResponse: result.response,
        cost: result.cost,
        turns: result.turns
      });
    }
    
    // Send session info
    await ctx.reply(
      `📊 **Session Stats**\n` +
      `Turn cost: $${result.cost.toFixed(4)}\n` +
      `Total cost: $${currentSession.totalCost.toFixed(4)}\n` +
      `Session turns: ${currentSession.turnCount}`
    );
    
  } catch (error) {
    console.error("❌ Error processing message:", error);
    
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMessage.message_id,
      `❌ **Error**\n\n${error instanceof Error ? error.message : "Unknown error occurred"}`
    );
  }
});

// Initialize session on startup
loadSession().then(() => {
  bot.start();
  console.log("🤖 Telegram bot is running...");
  if (currentSession.sessionId) {
    console.log(`📊 Loaded session: ${currentSession.sessionId.substring(0, 8)}... (${currentSession.turnCount} turns, $${currentSession.totalCost.toFixed(4)})`);
  }
}).catch((error) => {
  console.error("Failed to initialize bot:", error);
  process.exit(1);
});