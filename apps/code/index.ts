import { Bot } from "grammy";
import { query, type SDKMessage, type Props } from "@anthropic-ai/claude-code";
import { promises as fs } from "fs";
import path from "path";

// Exponential backoff utility
async function exponentialBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Check if it's a rate limit error
      const isRateLimit = error instanceof Error && (
        error.message.includes('rate limit') ||
        error.message.includes('too many requests') ||
        error.message.includes('429') ||
        error.message.includes('Too Many Requests')
      );
      
      if (!isRateLimit || attempt === maxRetries) {
        if (isRateLimit) {
          console.error(`🚫 Rate limit exceeded after ${maxRetries + 1} attempts`);
        }
        throw error;
      }
      
      // Extract retry_after from Telegram error if available
      let retryAfter = 0;
      if (error.message.includes('retry after')) {
        const match = error.message.match(/retry after (\d+)/);
        if (match) {
          retryAfter = parseInt(match[1], 10);
        }
      }
      
      // Use retry_after as base delay if provided, otherwise use exponential backoff
      let delay: number;
      if (retryAfter > 0) {
        // Use retry_after as base and add exponential component for subsequent attempts
        delay = Math.min(
          (retryAfter * 1000) + (baseDelay * Math.pow(2, attempt)) + Math.random() * 1000,
          maxDelay
        );
        // console.log(`Retry after: delay: ${delay} | retryAfter: ${retryAfter}`)
      } else {
        // Standard exponential backoff
        delay = Math.min(
          baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          maxDelay
        );
        // console.log(`Standard: delay: ${delay} | retryAfter: ${retryAfter}`)
      }
      
      console.log(`⏱️ Rate limit detected${retryAfter > 0 ? ` (retry_after: ${retryAfter}s)` : ''}, retrying in ${(delay/1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_GROUP_ID = process.env.ALLOWED_GROUP_ID;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

if (!ALLOWED_GROUP_ID) {
  throw new Error("ALLOWED_GROUP_ID environment variable is required");
}

const bot = new Bot(BOT_TOKEN);

// Telegram API wrapper with exponential backoff
async function telegramWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
  return exponentialBackoff(operation, 3, 1000, 60000);
}

// Helper function to check if message is from allowed group
function isFromAllowedGroup(ctx: any): boolean {
  const chatId = ctx.chat.id.toString();
  return chatId === ALLOWED_GROUP_ID;
}

// Session management
const SESSION_FILE = path.join(process.cwd(), "bot-session.json");

interface SessionData {
  sessionId: string | null;
  turnCount: number;
  totalCost: number;
  lastActivity: string;
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

async function appendToMarkdown(sessionId: string, content: string): Promise<void> {
  try {
    const filename = `${sessionId}.md`;
    const filepath = path.join(process.cwd(), filename);
    await fs.appendFile(filepath, content);
  } catch (error) {
    console.error("❌ Error appending to markdown:", error);
  }
}

async function startTurnInMarkdown(sessionId: string, turnNumber: number, userMessage: string): Promise<void> {
  const content = `## Turn ${turnNumber} - ${new Date().toLocaleString()}\n\n` +
    `**User:** ${userMessage}\n\n` +
    `**Claude Processing:**\n\n`;
  await appendToMarkdown(sessionId, content);
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
  let currentTurn = 0;
  let turnStarted = false;
  
  try {
    console.log('🤖 Starting Claude prompt processing...');
    onProgress?.("🤖 Initializing Claude...");
    
    let queryOptions = {
      prompt,
      abortController: new AbortController(),
      options: {
        maxTurns: 50,
        ...(currentSession.sessionId && { resume: currentSession.sessionId })
      },
    } satisfies Props;
    
    // Log session status
    if (currentSession.sessionId) {
      console.log('🔄 Resuming existing session:', currentSession.sessionId.substring(0, 8));
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
        
        // Start the turn in markdown immediately after session init
        if (!turnStarted) {
          await startTurnInMarkdown(sessionId, currentSession.turnCount + 1, prompt);
          turnStarted = true;
        }
      }
      
      if (message.type === "result" && message.subtype.startsWith("error")) {
        console.error('❌ System error:', message);
        onProgress?.("❌ System error occurred");
        if (sessionId) {
          await appendToMarkdown(sessionId, `❌ **System Error:** ${JSON.stringify(message)}\n\n`);
        }
      }
      
      if (message.type === "user") {
        currentTurn++;
        console.log(`📝 Turn ${currentTurn} started`);
        onProgress?.(`📝 Turn ${currentTurn} processing...`);
      }
      
      if (message.type === "assistant" && 'message' in message && message.message?.content) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === "text" && typeof item.text === "string") {
              const chunk = item.text;
              streamedResponse += chunk;
              onStream?.(chunk);
            } else if (item.type === "tool_use") {
              console.log('🔧 Tool called:', item.name);
              onProgress?.(`🔧 Using tool: ${item.name}`);
              if (sessionId) {
                await appendToMarkdown(sessionId, `🔧 **Tool Used:** ${item.name}\n`);
                if (item.input) {
                  await appendToMarkdown(sessionId, `\`\`\`json\n${JSON.stringify(item.input, null, 2)}\n\`\`\`\n\n`);
                }
              }
            }
          }
        }
      }
      
      if (message.type === "user" && message.message?.content) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === "tool_result") {
              console.log('🔧 Tool result received');
              if (item.is_error) {
                console.error('❌ Tool error:', item.content);
                onProgress?.(`❌ Tool error: ${item.content}`);
                if (sessionId) {
                  await appendToMarkdown(sessionId, `❌ **Tool Error:** ${item.content}\\n\\n`);
                }
              } else {
                onProgress?.(`✅ Tool completed`);
                if (sessionId) {
                  await appendToMarkdown(sessionId, `✅ **Tool Completed**\\n\\n`);
                }
              }
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
        
        // Add final response to markdown
        if (sessionId && finalResponse) {
          await appendToMarkdown(sessionId, `\n**Claude Response:**\n${finalResponse}\n\n`);
          await appendToMarkdown(sessionId, `*Cost: $${cost.toFixed(4)} | Turns: ${turns}*\n\n---\n\n`);
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
      if (error.message.includes('quota')) {
        throw new Error('💰 Usage quota exceeded. Please check your account limits.');
      }
      if (error.message.includes('server')) {
        throw new Error('🔥 Server error. Please try again in a moment.');
      }
      throw new Error(`❌ Claude processing failed: ${error.message}`);
    }
    
    throw new Error('❌ An unknown error occurred during processing.');
  }
}

bot.command("start", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('🚀 /start command received from user:', ctx.from?.username || ctx.from?.id);
  await loadSession();
  await telegramWithBackoff(() => 
    ctx.reply("Hello! I'm a Claude-powered bot with session management. Send me any prompt and I'll process it using Claude Code SDK.")
  );
});

bot.command("help", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  await telegramWithBackoff(() => 
    ctx.reply(
      "Available commands:\n" +
      "/start - Start the bot\n" +
      "/help - Show this help message\n" +
      "/newsession - Start a new conversation session\n" +
      "/continue - Continue current session\n" +
      "/reset - Reset current session\n" +
      "/session - Show session information\n" +
      "\nOr just send me any message and I'll process it as a prompt!"
    )
  );
});

bot.command("newsession", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('🆕 /newsession command received from user:', ctx.from?.username || ctx.from?.id);
  await resetSession();
  await telegramWithBackoff(() => 
    ctx.reply("🆕 New session started! Previous conversation history cleared.")
  );
});

bot.command("continue", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('🔄 /continue command received from user:', ctx.from?.username || ctx.from?.id);
  if (!currentSession.sessionId) {
    console.log('❌ No active session to continue');
    await telegramWithBackoff(() => 
      ctx.reply("❌ No active session to continue. Start a new conversation first.")
    );
    return;
  }
  
  console.log('✅ Showing session info for continuation');
  await telegramWithBackoff(() => 
    ctx.reply(
      `🔄 Continuing session: ${currentSession.sessionId!.substring(0, 8)}...\n` +
      `Turn count: ${currentSession.turnCount}\n` +
      `Total cost: $${currentSession.totalCost.toFixed(4)}\n` +
      "Send me a message to continue the conversation."
    )
  );
});

bot.command("reset", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('🔄 /reset command received from user:', ctx.from?.username || ctx.from?.id);
  await resetSession();
  await telegramWithBackoff(() => 
    ctx.reply("🔄 Session reset! Starting fresh.")
  );
});

bot.command("session", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('📊 /session command received from user:', ctx.from?.username || ctx.from?.id);
  if (!currentSession.sessionId) {
    console.log('❌ No active session to show');
    await telegramWithBackoff(() => 
      ctx.reply("❌ No active session. Send a message to start one.")
    );
    return;
  }
  
  console.log('✅ Showing session information');
  await telegramWithBackoff(() => 
    ctx.reply(
      `📊 **Session Information**\n` +
      `Session ID: \`${currentSession.sessionId!}\`\n` +
      `Turn count: ${currentSession.turnCount}\n` +
      `Total cost: $${currentSession.totalCost.toFixed(4)}\n` +
      `Last activity: ${new Date(currentSession.lastActivity).toLocaleString()}`
    )
  );
});

bot.on("message:text", async (ctx) => {
  const prompt = ctx.message.text;
  
  if (prompt.startsWith("/")) {
    return;
  }
  
  // Check if message is from allowed group
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Message ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('💬 New message received from user:', ctx.from?.username || ctx.from?.id);
  console.log('📝 Message preview:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
  
  let statusMessage = await telegramWithBackoff(() => 
    ctx.reply("🤖 Processing your prompt...")
  );
  let currentResponse = "";
  let lastUpdateTime = Date.now();
  
  try {
    const result = await runClaudePrompt(
      prompt,
      // Progress callback
      async (status: string) => {
        try {
          await telegramWithBackoff(() => 
            ctx.api.editMessageText(
              ctx.chat.id,
              statusMessage.message_id,
              status
            )
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
            await telegramWithBackoff(() => 
              ctx.api.editMessageText(
                ctx.chat.id,
                statusMessage.message_id,
                `🤖 **Thinking...**\n\n${currentResponse.substring(0, 500)}${currentResponse.length > 500 ? "..." : ""}`
              )
            );
            lastUpdateTime = now;
          } catch (error) {
            // Ignore edit errors
          }
        }
      }
    );
    
    // Send final response
    await telegramWithBackoff(() => 
      ctx.api.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        `✅ **Response Complete**\n\n${result.response}`
      )
    );
    
    
    // Send session info
    await telegramWithBackoff(() => 
      ctx.reply(
        `📊 **Session Stats**\n` +
        `Turn cost: $${result.cost.toFixed(4)}\n` +
        `Total cost: $${currentSession.totalCost.toFixed(4)}\n` +
        `Session turns: ${currentSession.turnCount}`
      )
    );
    
  } catch (error) {
    console.error("❌ Error processing message:", error);
    
    await telegramWithBackoff(() => 
      ctx.api.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        `❌ **Error**\n\n${error instanceof Error ? error.message : "Unknown error occurred"}`
      )
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