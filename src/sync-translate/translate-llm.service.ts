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
  private static readonly MAX_RETRIES = 2;

  public static async translate(
    request: LLMTranslationRequest
  ): Promise<LLMTranslationResult> {
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

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`LLM Translation attempt ${attempt}/${this.MAX_RETRIES}`);

        const result = await generateText({
          model: mistral(this.DEFAULT_MODEL),
          prompt,
          maxTokens: 1000,
          temperature: 0.3, // Lower temperature for more consistent translations
        });

        const translatedText = this.extractTranslation(result.text);

        return {
          originalText: request.text,
          translatedText,
          targetLanguage: request.targetLanguage,
          contextUsed: contextMessages.length > 0,
          model: this.DEFAULT_MODEL,
        };
      } catch (error) {
        lastError = error as Error;
        console.error(`LLM Translation attempt ${attempt} failed:`, error);

        if (attempt < this.MAX_RETRIES) {
          // Wait before retry with exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000)
          );
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
}
