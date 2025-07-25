import { Message, Client, TextChannel } from "discord.js";
import {
  SyncStorageService,
  type ChannelLanguageConfig,
} from "./sync-storage.service";
import { TranslationService } from "./translate.service";
import { TranslateLLMService } from "./translate-llm.service";
import { MessageQueueManager } from "./message-queue.service";
import { UserUtils } from "../utils/user.utils";
import { WebhookService } from "./webhook.service";
import { AvatarCleanupService } from "./avatar-cleanup.service";

export class SyncMessageService {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
    // Initialize webhook service with client
    WebhookService.setClient(client);
  }

  public async handleMessage(message: Message): Promise<void> {
    // Skip bot messages to prevent infinite loops
    if (message.author.bot) {
      return;
    }

    // Skip messages without content
    if (!message.content || message.content.trim().length === 0) {
      return;
    }

    // Only process messages in guilds
    if (!message.guild) {
      return;
    }

    try {
      await this.processSyncedMessage(message);
    } catch (error) {
      console.error("Error processing synced message:", error);
    }
  }

  private async processSyncedMessage(message: Message): Promise<void> {
    const serverId = message.guild!.id;
    const sourceChannelId = message.channel.id;

    // Get the language configuration for this channel
    const sourceLanguage = await SyncStorageService.getChannelLanguage(
      serverId,
      sourceChannelId
    );

    if (!sourceLanguage) {
      // Channel is not part of any sync group
      return;
    }

    // Find all channels in the same sync groups as this channel
    const syncGroups = await this.findChannelSyncGroups(
      serverId,
      sourceChannelId
    );

    if (syncGroups.length === 0) {
      return;
    }

    // Debug emoji content before translation
    const customEmojiRegex = /<(a?):(\w+):(\d+)>/g;
    const foundEmojis = message.content.match(customEmojiRegex);
    
    console.log(
      `Processing message from ${message.author.tag} in synced channel ${sourceChannelId}`
    );
    console.log('Content to translate:', {
      content: message.content,
      rawContent: JSON.stringify(message.content),
      foundEmojis: foundEmojis
    });

    // Extract user profile once for all translations
    let userProfile;
    try {
      const userResult = await UserUtils.extractUserLikeByMessage(message);
      userProfile = {
        username: userResult.user.username,
        displayName: userResult.user.displayName,
        avatarUrl: userResult.user.avatarUrl,
        profilePicturePath: userResult.profilePicturePath
      };
      console.log(`Extracted user profile for ${userProfile.displayName}`);
    } catch (error) {
      console.warn('Failed to extract user profile, using fallback:', error);
      userProfile = {
        username: message.author.username,
        displayName: message.author.displayName || message.author.username,
        avatarUrl: message.author.displayAvatarURL({ size: 256 })
      };
    }

    // Add reference count for the profile picture based on how many target channels we have
    const totalTargetChannels = syncGroups.reduce((count, group) => {
      return count + group.channels.filter(c => c.channelId !== sourceChannelId).length;
    }, 0);

    if (userProfile.profilePicturePath && totalTargetChannels > 0) {
      // Add reference count for each target channel that will use this avatar
      for (let i = 0; i < totalTargetChannels; i++) {
        AvatarCleanupService.addReference(userProfile.profilePicturePath);
      }
    }

    // Process each sync group
    for (const { groupId, channels } of syncGroups) {
      await this.translateToSyncGroup(
        message,
        sourceLanguage,
        groupId,
        channels,
        userProfile
      );
    }
  }

  private async findChannelSyncGroups(
    serverId: string,
    channelId: string
  ): Promise<Array<{ groupId: string; channels: ChannelLanguageConfig[] }>> {
    const syncData = await SyncStorageService.getAllSyncData();
    const serverData = syncData[serverId];

    if (!serverData) {
      return [];
    }

    const syncGroups: Array<{
      groupId: string;
      channels: ChannelLanguageConfig[];
    }> = [];

    for (const [groupId, channels] of Object.entries(serverData)) {
      const hasChannel = channels.some(
        (config) => config.channelId === channelId
      );
      if (hasChannel) {
        syncGroups.push({ groupId, channels });
      }
    }

    return syncGroups;
  }

  private async translateToSyncGroup(
    message: Message,
    sourceLanguage: string,
    groupId: string,
    channels: ChannelLanguageConfig[],
    userProfile: {
      username: string;
      displayName: string;
      avatarUrl?: string;
      profilePicturePath?: string;
    }
  ): Promise<void> {
    const sourceChannelId = message.channel.id;

    // Get target channels (exclude the source channel)
    const targetChannels = channels.filter(
      (config) => config.channelId !== sourceChannelId
    );

    if (targetChannels.length === 0) {
      return;
    }

    console.log(
      `Translating message to ${targetChannels.length} target channels in group ${groupId}`
    );

    // Translate to each target language
    for (const targetChannel of targetChannels) {
      try {
        await this.translateAndQueue(message, sourceLanguage, targetChannel, userProfile);
      } catch (error) {
        console.error(
          `Failed to translate message for channel ${targetChannel.channelId}:`,
          error
        );
      }
    }
  }

  private async translateAndQueue(
    message: Message,
    sourceLanguage: string,
    targetChannel: ChannelLanguageConfig,
    userProfile: {
      username: string;
      displayName: string;
      avatarUrl?: string;
      profilePicturePath?: string;
    }
  ): Promise<void> {
    const { channelId: targetChannelId, language: targetLanguage } =
      targetChannel;

    // Skip translation if source and target languages are the same
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
      console.log(
        `Skipping translation: source and target languages are the same (${sourceLanguage})`
      );
      return;
    }

    let translatedText = "";
    let translationMethod = "unknown";

    try {
      // First, try LLM translation with context
      translatedText = await this.tryLLMTranslation(
        message,
        sourceLanguage,
        targetLanguage
      );
      translationMethod = "LLM (Mistral)";
      
      console.log(
        `LLM Translated "${message.content}" from ${sourceLanguage} to ${targetLanguage}: "${translatedText}"`
      );
    } catch (llmError) {
      console.warn(`LLM translation failed, falling back to Google Translate:`, llmError);
      
      try {
        // Fallback to Google Translate
        const translationService = new TranslationService();
        const translationResult = await translationService.translate({
          text: message.content,
          targetLanguage: targetLanguage,
          originLanguage: sourceLanguage,
        });
        
        translatedText = translationResult.translatedText;
        translationMethod = "Google Translate";
        
        console.log(
          `Google Translate fallback: "${message.content}" from ${sourceLanguage} to ${targetLanguage}: "${translatedText}"`
        );
      } catch (googleError) {
        console.error(
          `Both LLM and Google translation failed for message "${message.content}" to ${targetLanguage}:`,
          { llmError, googleError }
        );

        // Queue the original message with an error indicator
        await MessageQueueManager.addToQueue(
          targetChannelId,
          message,
          targetLanguage,
          `[Translation Error] ${message.content}`,
          userProfile
        );
        return;
      }
    }

    // Add successful translation to message queue
    await MessageQueueManager.addToQueue(
      targetChannelId,
      message,
      targetLanguage,
      `${translatedText}${translationMethod === "Google Translate" ? " 🔄" : ""}`, // Add indicator for fallback
      userProfile
    );
  }

  private async tryLLMTranslation(
    message: Message,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string> {
    try {
      // Fetch recent messages for context
      const channel = message.channel as TextChannel;
      const recentMessages = await TranslateLLMService.fetchRecentMessages(channel, 10);
      
      // Filter out the current message to avoid including it in context
      const contextMessages = recentMessages.filter(msg => msg.id !== message.id);
      
      const llmResult = await TranslateLLMService.translate({
        text: message.content,
        targetLanguage: targetLanguage,
        originLanguage: sourceLanguage,
        contextMessages: [message, ...contextMessages] // Include current message for ID extraction
      });

      return llmResult.translatedText;
    } catch (error) {
      console.error('LLM translation failed:', error);
      throw error;
    }
  }

  public async getBotUserId(): Promise<string | null> {
    if (this.client.user) {
      return this.client.user.id;
    }
    return null;
  }

  public async getSyncStatus(
    serverId: string,
    channelId: string
  ): Promise<{
    isSync: boolean;
    language?: string;
    groups: string[];
  }> {
    const language = await SyncStorageService.getChannelLanguage(
      serverId,
      channelId
    );
    const syncGroups = await this.findChannelSyncGroups(serverId, channelId);

    return {
      isSync: language !== null,
      language: language || undefined,
      groups: syncGroups.map((sg) => sg.groupId),
    };
  }

  public getQueueStats() {
    return MessageQueueManager.getQueueStats();
  }

  public getTranslationServiceInfo() {
    return {
      primary: TranslateLLMService.getModelInfo(),
      fallback: {
        provider: "Google Translate",
        model: "translate_a/single"
      }
    };
  }

  public async testLLMTranslation(text: string, targetLanguage: string, originLanguage?: string): Promise<{
    success: boolean;
    result?: string;
    error?: string;
    method: string;
  }> {
    try {
      const llmResult = await TranslateLLMService.translate({
        text,
        targetLanguage,
        originLanguage,
        contextMessages: []
      });
      
      return {
        success: true,
        result: llmResult.translatedText,
        method: `LLM (${llmResult.model})`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        method: 'LLM (failed)'
      };
    }
  }
}
