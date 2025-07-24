import { generateText } from "ai";
import { mistral } from "@ai-sdk/mistral";
import { Message, TextChannel } from "discord.js";
import { LanguageService } from "./languages";

export interface LLMTranslationRequest {
  text: string;
  targetLanguage: string;
  originLanguage?: string;
  contextMessages?: Message[];
}

export interface LLMTranslationResult {
  originalText: string;
  translatedText: string;
  targetLanguage: string;
  contextUsed: boolean;
  model: string;
}

export interface MessageContext {
  author: string;
  content: string;
  timestamp: string;
}

export class TranslateLLMService {
  private static readonly DEFAULT_MODEL = "mistral-small-latest";
  private static readonly MAX_CONTEXT_MESSAGES = 10;
  private static readonly MAX_RETRIES = 3; // Increased for timeout handling
  private static readonly LLM_DUMPS_DIR = "./tmp/llm-dumps";
  private static readonly RATE_LIMIT_MS = 1000; // 1 second between translations
  private static readonly TIMEOUT_MS = 30000; // 30 second timeout

  private static lastTranslationTime = 0;
  private static translationQueue: Promise<any> = Promise.resolve();

  public static async translate(
    request: LLMTranslationRequest
  ): Promise<LLMTranslationResult> {
    // Add to queue to enforce rate limiting
    return (this.translationQueue = this.translationQueue.then(async () => {
      return this.executeTranslation(request);
    }));
  }

  private static async executeTranslation(
    request: LLMTranslationRequest
  ): Promise<LLMTranslationResult> {
    // Rate limiting: ensure at least 1 second between translations
    const now = Date.now();
    const timeSinceLastTranslation = now - this.lastTranslationTime;
    if (timeSinceLastTranslation < this.RATE_LIMIT_MS) {
      const waitTime = this.RATE_LIMIT_MS - timeSinceLastTranslation;
      console.log(`Rate limiting: waiting ${waitTime}ms before translation`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastTranslationTime = Date.now();

    this.validateRequest(request);

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error("MISTRAL_API_KEY environment variable is required");
    }

    // Get recent message context if available
    const contextMessages = request.contextMessages
      ? await this.getMessageContext(request.contextMessages)
      : [];

    const prompt = this.buildTranslationPrompt(
      request.text,
      request.targetLanguage,
      request.originLanguage,
      contextMessages
    );

    // Create dump folder for this translation attempt
    const messageId =
      request.contextMessages &&
      request.contextMessages.length > 0 &&
      request.contextMessages[0]
        ? request.contextMessages[0].id
        : "unknown";
    const dumpFolderName = `${Date.now()}_${messageId}`;
    const dumpFolderPath = `${this.LLM_DUMPS_DIR}/${dumpFolderName}`;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`LLM Translation attempt ${attempt}/${this.MAX_RETRIES}`);

        // Create a timeout wrapper around the API call
        const translationPromise = generateText({
          model: mistral(this.DEFAULT_MODEL),
          prompt,
          maxTokens: 1000,
          temperature: 0.3, // Lower temperature for more consistent translations
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Translation timeout after ${this.TIMEOUT_MS}ms`));
          }, this.TIMEOUT_MS);
        });

        const result = await Promise.race([translationPromise, timeoutPromise]);
        const translatedText = this.extractTranslation(result.text);

        // Dump successful prompt and response
        await this.dumpPromptAndResponse(dumpFolderPath, prompt, result.text, {
          attempt,
          success: true,
          originalText: request.text,
          translatedText,
          targetLanguage: request.targetLanguage,
          contextUsed: contextMessages.length > 0,
        });

        return {
          originalText: request.text,
          translatedText,
          targetLanguage: request.targetLanguage,
          contextUsed: contextMessages.length > 0,
          model: this.DEFAULT_MODEL,
        };
      } catch (error) {
        lastError = error as Error;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const isTimeout = this.isTimeoutError(error);

        console.error(
          `LLM Translation attempt ${attempt} failed${
            isTimeout ? " (TIMEOUT)" : ""
          }:`,
          errorMessage
        );

        // Dump failed attempt
        await this.dumpPromptAndResponse(
          dumpFolderPath,
          prompt,
          `ERROR: ${error}`,
          {
            attempt,
            success: false,
            error: errorMessage,
            originalText: request.text,
            targetLanguage: request.targetLanguage,
            contextUsed: contextMessages.length > 0,
          }
        );

        if (attempt < this.MAX_RETRIES) {
          // Calculate wait time with different strategies for different error types
          let waitTime: number;
          if (isTimeout) {
            // For timeouts, use longer exponential backoff
            waitTime = Math.pow(3, attempt) * 2000; // 6s, 18s, 54s
            console.log(
              `Timeout detected, waiting ${waitTime}ms before retry...`
            );
          } else {
            // For other errors, use standard exponential backoff
            waitTime = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
            console.log(
              `API error detected, waiting ${waitTime}ms before retry...`
            );
          }

          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    throw new Error(
      `LLM Translation failed after ${this.MAX_RETRIES} attempts. Last error: ${lastError?.message}`
    );
  }

  private static validateRequest(request: LLMTranslationRequest): void {
    if (!request.text || typeof request.text !== "string") {
      throw new Error("Text is required and must be a non-empty string");
    }

    if (request.text.trim().length === 0) {
      throw new Error("Text cannot be empty or contain only whitespace");
    }

    if (request.text.length > 4000) {
      throw new Error(
        "Text is too long (maximum 4000 characters for LLM translation)"
      );
    }

    if (!request.targetLanguage || typeof request.targetLanguage !== "string") {
      throw new Error("Target language is required and must be a string");
    }

    if (!LanguageService.isLanguageSupported(request.targetLanguage)) {
      throw new Error(`Unsupported target language: ${request.targetLanguage}`);
    }

    if (
      request.originLanguage &&
      !LanguageService.isLanguageSupported(request.originLanguage)
    ) {
      throw new Error(`Unsupported origin language: ${request.originLanguage}`);
    }
  }

  private static async getMessageContext(
    contextMessages: Message[]
  ): Promise<MessageContext[]> {
    try {
      // Take the most recent messages, excluding the current one
      const recentMessages = contextMessages
        .slice(0, this.MAX_CONTEXT_MESSAGES)
        .filter((msg) => !msg.author.bot && msg.content.trim().length > 0)
        .map((msg) => ({
          author: msg.author.displayName || msg.author.username,
          content: msg.content.slice(0, 200), // Limit individual message length
          timestamp: msg.createdAt.toISOString(),
        }));

      console.log(
        `Using ${recentMessages.length} context messages for LLM translation`
      );
      return recentMessages;
    } catch (error) {
      console.warn("Failed to extract message context:", error);
      return [];
    }
  }

  private static buildTranslationPrompt(
    text: string,
    targetLanguage: string,
    originLanguage?: string,
    contextMessages: MessageContext[] = []
  ): string {
    const targetLangName = LanguageService.getLanguageName(targetLanguage);
    const originLangName = originLanguage
      ? LanguageService.getLanguageName(originLanguage)
      : "auto-detected";

    let prompt = `You are a professional translator specializing in Discord chat translations. Your task is to translate the given message accurately while preserving the tone, style, and context.

**Translation Guidelines:**
- Maintain the original tone (casual, formal, excited, etc.)
- Preserve emojis, mentions, and special formatting
- Keep slang and gaming terminology natural in the target language
- Consider the conversational context
- If something cannot be translated directly, provide the closest cultural equivalent

**Source Language:** ${originLangName}
**Target Language:** ${targetLangName}`;

    if (contextMessages.length > 0) {
      prompt += `

**Recent Conversation Context:**
`;
      contextMessages.forEach((msg, index) => {
        prompt += `${index + 1}. [${msg.author}]: ${msg.content}\n`;
      });
    }

    prompt += `

**Message to Translate:**
"${text}"

**Translation Instructions:**
- Respond with ONLY the translated text
- Do not include explanations, notes, or commentary
- Do not repeat the original text
- Ensure the translation flows naturally in ${targetLangName}
- Preseve emoji syntax if you detect it.

**Translation:**`;

    return prompt;
  }

  private static extractTranslation(llmResponse: string): string {
    // Clean up the LLM response to extract just the translation
    let translation = llmResponse.trim();

    // Remove common prefixes that LLMs might add
    const prefixesToRemove = [
      "Translation:",
      "Translated text:",
      "The translation is:",
      "Here is the translation:",
      '"',
      "«",
      "»",
    ];

    for (const prefix of prefixesToRemove) {
      if (translation.toLowerCase().startsWith(prefix.toLowerCase())) {
        translation = translation.slice(prefix.length).trim();
      }
    }

    // Remove surrounding quotes if present
    if (
      (translation.startsWith('"') && translation.endsWith('"')) ||
      (translation.startsWith("'") && translation.endsWith("'"))
    ) {
      translation = translation.slice(1, -1);
    }

    // Ensure we have a non-empty translation
    if (!translation || translation.trim().length === 0) {
      throw new Error("LLM returned empty translation");
    }

    return translation.trim();
  }

  public static async fetchRecentMessages(
    channel: TextChannel,
    limit: number = this.MAX_CONTEXT_MESSAGES
  ): Promise<Message[]> {
    try {
      const messages = await channel.messages.fetch({
        limit: limit + 1, // +1 to account for the current message we want to exclude
        before: undefined, // Get the most recent messages
      });

      return Array.from(messages.values())
        .reverse() // Oldest first for proper context
        .slice(0, limit); // Ensure we don't exceed limit
    } catch (error) {
      console.error("Failed to fetch recent messages:", error);
      return [];
    }
  }

  public static getSupportedLanguages(): string[] {
    return LanguageService.getSupportedLanguageCodes();
  }

  public static isLanguageSupported(languageCode: string): boolean {
    return LanguageService.isLanguageSupported(languageCode);
  }

  public static getModelInfo(): { model: string; provider: string } {
    return {
      model: this.DEFAULT_MODEL,
      provider: "Mistral",
    };
  }

  private static isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("request timeout") ||
        message.includes("connection timeout") ||
        message.includes("read timeout") ||
        message.includes("econnreset") ||
        message.includes("enotfound") ||
        message.includes("etimedout")
      );
    }
    return false;
  }

  private static async dumpPromptAndResponse(
    dumpFolderPath: string,
    prompt: string,
    response: string,
    metadata: {
      attempt: number;
      success: boolean;
      originalText: string;
      translatedText?: string;
      targetLanguage: string;
      contextUsed: boolean;
      error?: string;
    }
  ): Promise<void> {
    try {
      // Create dump directory
      await Bun.$`mkdir -p ${dumpFolderPath}`;

      // Create prompt file
      const promptContent = `${prompt}

=== METADATA ===
Timestamp: ${new Date().toISOString()}
Attempt: ${metadata.attempt}
Success: ${metadata.success}
Original Text: ${metadata.originalText}
Target Language: ${metadata.targetLanguage}
Context Used: ${metadata.contextUsed}
Model: ${this.DEFAULT_MODEL}
${metadata.translatedText ? `Translated Text: ${metadata.translatedText}` : ""}
${metadata.error ? `Error: ${metadata.error}` : ""}
`;

      await Bun.write(`${dumpFolderPath}/prompt.txt`, promptContent);

      // Create response file
      const responseContent = `${response}

=== METADATA ===
Timestamp: ${new Date().toISOString()}
Attempt: ${metadata.attempt}
Success: ${metadata.success}
Raw Response Length: ${response.length}
${
  metadata.translatedText
    ? `Extracted Translation: ${metadata.translatedText}`
    : ""
}
${metadata.error ? `Error Details: ${metadata.error}` : ""}
`;

      await Bun.write(`${dumpFolderPath}/response.txt`, responseContent);

      console.log(`LLM dump saved to: ${dumpFolderPath}`);
    } catch (error) {
      console.warn(`Failed to dump LLM prompt/response:`, error);
    }
  }

  public static async cleanupOldDumps(maxAgeHours: number = 24): Promise<void> {
    try {
      const maxAge = Date.now() - maxAgeHours * 60 * 60 * 1000;

      // Get all directories in LLM dumps folder
      const result =
        await Bun.$`find ${this.LLM_DUMPS_DIR} -maxdepth 1 -type d -name "*_*"`.quiet();
      const directories = result.stdout
        .toString()
        .trim()
        .split("\n")
        .filter((dir) => dir);

      for (const dirPath of directories) {
        const dirName = dirPath.split("/").pop();
        if (!dirName) continue;

        // Extract timestamp from directory name (format: timestamp_messageId)
        const timestampMatch = dirName.match(/^(\d+)_/);
        if (timestampMatch && timestampMatch[1]) {
          const timestamp = parseInt(timestampMatch[1], 10);
          if (timestamp < maxAge) {
            await Bun.$`rm -rf "${dirPath}"`;
            console.log(`Cleaned up old LLM dump: ${dirPath}`);
          }
        }
      }
    } catch (error) {
      console.error("Error during LLM dump cleanup:", error);
    }
  }

  public static getDumpStats(): Promise<{
    totalDumps: number;
    oldestDump?: string;
    newestDump?: string;
    totalSizeMB?: number;
  }> {
    return new Promise(async (resolve) => {
      try {
        const result =
          await Bun.$`find ${this.LLM_DUMPS_DIR} -maxdepth 1 -type d -name "*_*"`.quiet();
        const directories = result.stdout
          .toString()
          .trim()
          .split("\n")
          .filter((dir) => dir);

        const timestamps = directories
          .map((dir) => {
            const dirName = dir.split("/").pop();
            const match = dirName?.match(/^(\d+)_/);
            return match && match[1] ? parseInt(match[1], 10) : null;
          })
          .filter((timestamp): timestamp is number => timestamp !== null)
          .sort((a, b) => a - b);

        // Get total size
        let totalSizeMB = 0;
        try {
          const sizeResult =
            await Bun.$`du -sm "${this.LLM_DUMPS_DIR}"`.quiet();
          const sizeMatch = sizeResult.stdout.toString().match(/^(\d+)/);
          totalSizeMB =
            sizeMatch && sizeMatch[1] ? parseInt(sizeMatch[1], 10) : 0;
        } catch (e) {
          // Size calculation failed, continue without it
        }

        resolve({
          totalDumps: directories.length,
          oldestDump:
            timestamps.length > 0
              ? new Date(timestamps[0]!).toISOString()
              : undefined,
          newestDump:
            timestamps.length > 0
              ? new Date(timestamps[timestamps.length - 1]!).toISOString()
              : undefined,
          totalSizeMB,
        });
      } catch (error) {
        console.error("Error getting dump stats:", error);
        resolve({ totalDumps: 0 });
      }
    });
  }

  public static getRateLimitInfo(): {
    rateLimitMs: number;
    timeSinceLastTranslation: number;
    canTranslateNow: boolean;
  } {
    const now = Date.now();
    const timeSinceLastTranslation = now - this.lastTranslationTime;
    return {
      rateLimitMs: this.RATE_LIMIT_MS,
      timeSinceLastTranslation,
      canTranslateNow: timeSinceLastTranslation >= this.RATE_LIMIT_MS,
    };
  }

  public static getRetrySettings(): {
    maxRetries: number;
    timeoutMs: number;
    standardBackoffPattern: string;
    timeoutBackoffPattern: string;
  } {
    return {
      maxRetries: this.MAX_RETRIES,
      timeoutMs: this.TIMEOUT_MS,
      standardBackoffPattern: "2s, 4s, 8s",
      timeoutBackoffPattern: "6s, 18s, 54s",
    };
  }
}
