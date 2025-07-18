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
const DEV_MODE = process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development';

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

if (!ALLOWED_GROUP_ID) {
  throw new Error("ALLOWED_GROUP_ID environment variable is required");
}

if (DEV_MODE) {
  console.log('🔧 DEV MODE enabled - automatic tool permissions will be granted');
}

const bot = new Bot(BOT_TOKEN);

// Telegram API wrapper with exponential backoff
async function telegramWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
  return exponentialBackoff(operation, 3, 1000, 60000);
}

// Typing indicator management
async function startTyping(chatId: number, topicId?: number): Promise<void> {
  try {
    await telegramWithBackoff(() => 
      bot.api.sendChatAction(chatId, "typing", topicId ? { message_thread_id: topicId } : {})
    );
  } catch (error) {
    // Ignore typing errors to avoid rate limits
  }
}

async function stopTyping(chatId: number, topicId?: number): Promise<void> {
  // Typing automatically stops when we send a message, so this is just for explicit stopping
  try {
    await telegramWithBackoff(() => 
      bot.api.sendChatAction(chatId, "typing", topicId ? { message_thread_id: topicId } : {})
    );
  } catch (error) {
    // Ignore typing errors to avoid rate limits
  }
}

// Helper function to check if message is from allowed group
function isFromAllowedGroup(ctx: any): boolean {
  const chatId = ctx.chat.id.toString();
  return chatId === ALLOWED_GROUP_ID;
}

// Helper function to detect tool permission errors
function isToolPermissionError(error: string): { isPermissionError: boolean; toolName?: string } {
  // Pattern: "Claude requested permissions to use [ToolName], but you haven't granted it yet."
  const permissionMatch = error.match(/Claude requested permissions to use (\w+), but you haven't granted it yet/);
  
  if (permissionMatch) {
    return {
      isPermissionError: true,
      toolName: permissionMatch[1]
    };
  }
  
  return { isPermissionError: false };
}

// Helper function to extract tools from error messages in DEV MODE
function extractToolsFromErrors(messages: SDKMessage[]): string[] {
  const tools = new Set<string>();
  
  messages.forEach(message => {
    if (message.type === "user" && message.message?.content) {
      const content = message.message.content;
      if (Array.isArray(content)) {
        content.forEach(item => {
          if (item.type === "tool_result" && item.is_error && typeof item.content === "string") {
            const { isPermissionError, toolName } = isToolPermissionError(item.content);
            if (isPermissionError && toolName) {
              tools.add(toolName);
              if (DEV_MODE) {
                console.log(`🔧 DEV MODE: Detected permission error for tool: ${toolName}`);
              }
            }
          }
        });
      }
    }
  });
  
  return Array.from(tools);
}

// Session management
const SESSION_FILE = path.join(process.cwd(), "bot-session.json");

interface SessionData {
  sessionId: string | null;
  turnCount: number;
  totalCost: number;
  lastActivity: string;
  topicId?: number;
  topicName?: string;
}

interface TopicSessionMap {
  [topicId: number]: SessionData;
}

// Topic-based session storage
let topicSessions: TopicSessionMap = {};
let defaultSession: SessionData = {
  sessionId: null,
  turnCount: 0,
  totalCost: 0,
  lastActivity: new Date().toISOString(),
};

// Load sessions on startup
async function loadSessions(): Promise<void> {
  try {
    console.log('📂 Loading sessions from file...');
    const data = await fs.readFile(SESSION_FILE, "utf-8");
    const parsed = JSON.parse(data);
    
    // Handle migration from old single session format
    if (parsed.sessionId && !parsed.topicSessions) {
      console.log('🔄 Migrating from old session format...');
      defaultSession = parsed;
      topicSessions = {};
    } else {
      topicSessions = parsed.topicSessions || {};
      defaultSession = parsed.defaultSession || defaultSession;
    }
    
    console.log('✅ Sessions loaded successfully. Topics:', Object.keys(topicSessions).length);
  } catch (error) {
    console.log('⚠️  Session file not found or corrupted, creating new sessions');
    await saveSessions();
  }
}

async function saveSessions(): Promise<void> {
  try {
    console.log('💾 Saving sessions to file...');
    const data = {
      topicSessions,
      defaultSession,
      lastUpdated: new Date().toISOString()
    };
    await fs.writeFile(SESSION_FILE, JSON.stringify(data, null, 2));
    console.log('✅ Sessions saved successfully');
  } catch (error) {
    console.error("❌ Error saving sessions:", error);
  }
}

// Helper functions for topic and session management
function getSessionForTopic(topicId?: number): SessionData {
  if (topicId && topicSessions[topicId]) {
    return topicSessions[topicId];
  }
  return defaultSession;
}

function setSessionForTopic(session: SessionData, topicId?: number): void {
  if (topicId) {
    topicSessions[topicId] = session;
  } else {
    defaultSession = session;
  }
}

async function createTopicForSession(ctx: any, prompt: string): Promise<number | null> {
  try {
    // Extract first few words from prompt for topic name
    const firstWords = prompt.split(' ').slice(0, 6).join(' ');
    const truncated = firstWords.length > 30 ? firstWords.substring(0, 27) + '...' : firstWords;
    const topicName = `Claude: ${truncated}`;
    
    console.log('🏷️ Creating forum topic:', topicName);
    
    const topic = await telegramWithBackoff(() =>
      ctx.api.createForumTopic(ctx.chat.id, topicName)
    );
    
    console.log('✅ Topic created with ID:', topic.message_thread_id);
    return topic.message_thread_id;
  } catch (error) {
    console.error('❌ Error creating forum topic:', error);
    return null;
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

async function resetSession(topicId?: number): Promise<void> {
  console.log('🔄 Resetting session...', topicId ? `for topic ${topicId}` : 'default');
  
  const newSession: SessionData = {
    sessionId: null,
    turnCount: 0,
    totalCost: 0,
    lastActivity: new Date().toISOString(),
    topicId,
  };
  
  setSessionForTopic(newSession, topicId);
  await saveSessions();
  console.log('✅ Session reset complete');
}

async function runClaudePrompt(
  prompt: string,
  chatId: number,
  topicId?: number,
  allowedTools: string[] = []
): Promise<{ response: string; sessionId: string; cost: number; turns: number }> {
  const messages: SDKMessage[] = [];
  let streamedResponse = "";
  let finalResponse = "";
  let sessionId = "";
  let cost = 0;
  let turns = 0;
  let currentTurn = 0;
  let turnStarted = false;
  let retryCount = 0;
  const maxRetries = DEV_MODE ? 2 : 0; // Allow retries only in DEV MODE
  
  // Get the current session for this topic
  const currentSession = getSessionForTopic(topicId);
  
  const attemptQuery = async (currentAllowedTools: string[] = []): Promise<{
    response: string;
    sessionId: string;
    cost: number;
    turns: number;
    messages: SDKMessage[];
  }> => {
    console.log('🤖 Starting Claude prompt processing...', topicId ? `for topic ${topicId}` : 'default');
    if (currentAllowedTools.length > 0) {
      console.log('🔧 Using allowed tools:', currentAllowedTools.join(', '));
    }
    await startTyping(chatId, topicId);
    
    let queryOptions = {
      prompt,
      abortController: new AbortController(),
      options: {
        maxTurns: 50,
        ...(currentSession.sessionId && { resume: currentSession.sessionId }),
        ...(currentAllowedTools.length > 0 && { allowedTools: currentAllowedTools })
      },
    } satisfies Props;
    
    // Log session status
    if (currentSession.sessionId) {
      console.log('🔄 Resuming existing session:', currentSession.sessionId.substring(0, 8));
    } else {
      console.log('🆕 Starting new Claude session...');
    }
    
    // Reset variables for retry attempts
    messages.length = 0;
    streamedResponse = "";
    finalResponse = "";
    sessionId = "";
    cost = 0;
    turns = 0;
    currentTurn = 0;
    turnStarted = false;
    
    for await (const message of query(queryOptions)) {
      messages.push(message);
      
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        console.log('✅ Claude session initialized:', sessionId.substring(0, 8));
        
        // Start the turn in markdown immediately after session init
        if (!turnStarted) {
          await startTurnInMarkdown(sessionId, currentSession.turnCount + 1, prompt);
          turnStarted = true;
        }
      }
      
      if (message.type === "result" && message.subtype.startsWith("error")) {
        console.error('❌ System error:', message);
        if (sessionId) {
          await appendToMarkdown(sessionId, `❌ **System Error:** ${JSON.stringify(message)}\n\n`);
        }
      }
      
      if (message.type === "user") {
        currentTurn++;
        console.log(`📝 Turn ${currentTurn} started`);
        await startTyping(chatId, topicId);
      }
      
      if (message.type === "assistant" && 'message' in message && message.message?.content) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === "text" && typeof item.text === "string") {
              const chunk = item.text;
              streamedResponse += chunk;
              
              // Keep typing during response
              if (streamedResponse.length > 0 && streamedResponse.length % 1000 === 0) {
                await startTyping(chatId, topicId);
              }
            } else if (item.type === "tool_use") {
              console.log('🔧 Tool called:', item.name);
              await startTyping(chatId, topicId);
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
                await startTyping(chatId, topicId);
                if (sessionId) {
                  await appendToMarkdown(sessionId, `❌ **Tool Error:** ${item.content}\\n\\n`);
                }
              } else {
                await startTyping(chatId, topicId);
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
    
    return {
      response: finalResponse || streamedResponse || "No response received",
      sessionId,
      cost,
      turns,
      messages: messages // Keep messages for error analysis
    };
  };

  // Main execution with retry logic
  let currentAllowedTools = [...allowedTools];
  
  try {
    while (retryCount <= maxRetries) {
      try {
        const result = await attemptQuery(currentAllowedTools);
        
        // Check for tool permission errors in DEV MODE
        if (DEV_MODE && retryCount < maxRetries) {
          const toolsNeedingPermission = extractToolsFromErrors(result.messages);
          
          if (toolsNeedingPermission.length > 0) {
            retryCount++;
            console.log(`🔧 DEV MODE: Retry ${retryCount}/${maxRetries} - Adding tool permissions:`, toolsNeedingPermission.join(', '));
            
            // Add the new tools to allowed tools
            toolsNeedingPermission.forEach(tool => {
              if (!currentAllowedTools.includes(tool)) {
                currentAllowedTools.push(tool);
              }
            });
            
            // Continue the loop to retry
            continue;
          }
        }
        
        // Success! Update session data
        console.log('📊 Updating session data...');
        const updatedSession: SessionData = {
          ...currentSession,
          sessionId: result.sessionId,
          turnCount: currentSession.turnCount + result.turns,
          totalCost: currentSession.totalCost + result.cost,
          lastActivity: new Date().toISOString(),
          topicId,
        };
        setSessionForTopic(updatedSession, topicId);
        await saveSessions();
        
        console.log('✅ Claude processing complete. Total cost:', updatedSession.totalCost.toFixed(4));
        
        return {
          response: result.response,
          sessionId: result.sessionId,
          cost: result.cost,
          turns: result.turns,
        };
        
      } catch (queryError) {
        // If this is the last retry or DEV MODE is disabled, throw the error
        if (retryCount >= maxRetries || !DEV_MODE) {
          throw queryError;
        }
        
        // In DEV MODE, try to extract tool permissions from error and retry
        retryCount++;
        console.log(`🔧 DEV MODE: Query failed, attempting retry ${retryCount}/${maxRetries}`);
        console.error('Query error:', queryError);
      }
    }
    
    throw new Error('Max retries exceeded in DEV MODE');
    
  } catch (error) {
    console.error("Error running Claude prompt:", error);
    
    if (DEV_MODE) {
      console.log('🔧 DEV MODE: Error occurred after', retryCount, 'retries');
      console.log('🔧 DEV MODE: Final allowed tools:', currentAllowedTools.join(', '));
    }
    
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
  await loadSessions();
  await telegramWithBackoff(() => 
    ctx.reply("Hello! I'm a Claude-powered bot with topic-based session management. Send me any prompt and I'll create a new topic for our conversation, or reply to an existing topic to continue that session.")
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
      "/newsession - Start a new conversation topic\n" +
      "/reset - Reset session for current topic\n" +
      "/session - Show session information for current topic\n" +
      "/sessions - List all active sessions\n" +
      "\nTopic-based sessions:\n" +
      "• Send a message to the main chat to create a new topic\n" +
      "• Reply to an existing topic to continue that conversation\n" +
      "• Each topic maintains its own Claude session"
    )
  );
});

bot.command("newsession", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('🆕 /newsession command received from user:', ctx.from?.username || ctx.from?.id);
  const topicId = ctx.message?.message_thread_id;
  await resetSession(topicId);
  await telegramWithBackoff(() => 
    ctx.reply("🆕 New session started! Previous conversation history cleared for this topic.")
  );
});


bot.command("reset", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('🔄 /reset command received from user:', ctx.from?.username || ctx.from?.id);
  const topicId = ctx.message?.message_thread_id;
  await resetSession(topicId);
  await telegramWithBackoff(() => 
    ctx.reply("🔄 Session reset! Starting fresh for this topic.")
  );
});

bot.command("session", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('📊 /session command received from user:', ctx.from?.username || ctx.from?.id);
  const topicId = ctx.message?.message_thread_id;
  const currentSession = getSessionForTopic(topicId);
  
  if (!currentSession.sessionId) {
    console.log('❌ No active session to show');
    await telegramWithBackoff(() => 
      ctx.reply("❌ No active session for this topic. Send a message to start one.")
    );
    return;
  }
  
  console.log('✅ Showing session information');
  await telegramWithBackoff(() => 
    ctx.reply(
      `📊 **Session Information**\n` +
      `Topic ID: ${topicId || 'Main chat'}\n` +
      `Session ID: \`${currentSession.sessionId!}\`\n` +
      `Turn count: ${currentSession.turnCount}\n` +
      `Total cost: $${currentSession.totalCost.toFixed(4)}\n` +
      `Last activity: ${new Date(currentSession.lastActivity).toLocaleString()}`
    )
  );
});

bot.command("sessions", async (ctx) => {
  if (!isFromAllowedGroup(ctx)) {
    console.log('⚠️ Command ignored - not from allowed group. Chat ID:', ctx.chat.id);
    return;
  }
  
  console.log('📊 /sessions command received from user:', ctx.from?.username || ctx.from?.id);
  
  const allSessions = Object.entries(topicSessions).filter(([_, session]) => session.sessionId);
  const hasDefaultSession = defaultSession.sessionId;
  
  if (allSessions.length === 0 && !hasDefaultSession) {
    await telegramWithBackoff(() => 
      ctx.reply("❌ No active sessions found.")
    );
    return;
  }
  
  let message = "📊 **Active Sessions**\n\n";
  
  if (hasDefaultSession) {
    message += `🏠 **Main Chat**\n` +
      `Session ID: \`${defaultSession.sessionId!.substring(0, 8)}...\`\n` +
      `Turns: ${defaultSession.turnCount}, Cost: $${defaultSession.totalCost.toFixed(4)}\n` +
      `Last: ${new Date(defaultSession.lastActivity).toLocaleString()}\n\n`;
  }
  
  allSessions.forEach(([topicId, session]) => {
    message += `🏷️ **Topic ${topicId}**\n` +
      `Session ID: \`${session.sessionId!.substring(0, 8)}...\`\n` +
      `Turns: ${session.turnCount}, Cost: $${session.totalCost.toFixed(4)}\n` +
      `Last: ${new Date(session.lastActivity).toLocaleString()}\n\n`;
  });
  
  await telegramWithBackoff(() => ctx.reply(message));
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
  
  // Get topic ID from message
  let topicId = ctx.message?.message_thread_id;
  const currentSession = getSessionForTopic(topicId);
  
  // If this is a new conversation in main chat and there's no existing session, create a topic
  if (!topicId && !currentSession.sessionId) {
    console.log('🏷️ Creating new topic for conversation...');
    const newTopicId = await createTopicForSession(ctx, prompt);
    if (newTopicId) {
      topicId = newTopicId;
      // Reply to the new topic instead of main chat
      const newTopicMessage = await telegramWithBackoff(() => 
        ctx.api.sendMessage(
          ctx.chat.id, 
          "🤖 Processing your prompt...",
          { message_thread_id: topicId }
        )
      );
      
      try {
        const result = await runClaudePrompt(prompt, ctx.chat.id, topicId);
        
        // Send final response
        await telegramWithBackoff(() => 
          ctx.api.editMessageText(
            ctx.chat.id,
            newTopicMessage.message_id,
            `✅ **Response Complete**\n\n${result.response}`,
            { message_thread_id: topicId }
          )
        );
        
        // Send session info
        const updatedSession = getSessionForTopic(topicId);
        await telegramWithBackoff(() => 
          ctx.api.sendMessage(
            ctx.chat.id,
            `📊 **Session Stats**\n` +
            `Turn cost: $${result.cost.toFixed(4)}\n` +
            `Total cost: $${updatedSession.totalCost.toFixed(4)}\n` +
            `Session turns: ${updatedSession.turnCount}`,
            { message_thread_id: topicId }
          )
        );
        
      } catch (error) {
        console.error("❌ Error processing message:", error);
        await telegramWithBackoff(() => 
          ctx.api.editMessageText(
            ctx.chat.id,
            newTopicMessage.message_id,
            `❌ **Error**\n\n${error instanceof Error ? error.message : "Unknown error occurred"}`,
            { message_thread_id: topicId }
          )
        );
      }
      return;
    }
  }
  
  // Handle existing topic or fallback to main chat
  let statusMessage = await telegramWithBackoff(() => 
    ctx.reply("🤖 Processing your prompt...")
  );
  
  try {
    const result = await runClaudePrompt(prompt, ctx.chat.id, topicId);
    
    // Send final response
    await telegramWithBackoff(() => 
      ctx.api.editMessageText(
        ctx.chat.id,
        statusMessage.message_id,
        `✅ **Response Complete**\n\n${result.response}`
      )
    );
    
    
    // Send session info
    const updatedSession = getSessionForTopic(topicId);
    await telegramWithBackoff(() => 
      ctx.reply(
        `📊 **Session Stats**\n` +
        `Turn cost: $${result.cost.toFixed(4)}\n` +
        `Total cost: $${updatedSession.totalCost.toFixed(4)}\n` +
        `Session turns: ${updatedSession.turnCount}`
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

// Initialize sessions on startup
loadSessions().then(async () => {
  console.log("🤖 Telegram bot is running...");

  // get unprocessed messages
  const updates = await bot.api.getUpdates()
  console.log(updates)
  const lastUpdate = updates[updates.length - 1]

  // clear updates
  if(lastUpdate?.update_id) {
    const nextUpdates = await bot.api.getUpdates({
        offset: lastUpdate.update_id + 1,
    })
    console.log(nextUpdates)
  }
  bot.start();

  
  const allSessions = Object.values(topicSessions).filter(session => session.sessionId);
  const totalSessions = allSessions.length + (defaultSession.sessionId ? 1 : 0);
  
  if (totalSessions > 0) {
    const totalCost = allSessions.reduce((sum, session) => sum + session.totalCost, 0) + defaultSession.totalCost;
    const totalTurns = allSessions.reduce((sum, session) => sum + session.turnCount, 0) + defaultSession.turnCount;
    console.log(`📊 Loaded ${totalSessions} active sessions (${totalTurns} turns, $${totalCost.toFixed(4)} total cost)`);
  }
}).catch((error: Error) => {
  console.error("Failed to initialize bot:", error);
  process.exit(1);
});