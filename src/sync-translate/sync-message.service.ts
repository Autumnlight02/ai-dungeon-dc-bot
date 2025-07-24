import { Message, Client } from "discord.js";
import {
  SyncStorageService,
  type ChannelLanguageConfig,
} from "./sync-storage.service";
import { TranslationService } from "./translate.service";
import { MessageQueueManager } from "./message-queue.service";
import { UserUtils } from "../utils/user.utils";
import { WebhookService } from "./webhook.service";

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

    console.log(
      `Processing message from ${message.author.tag} in synced channel ${sourceChannelId}`
    );

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

    try {
      const translationService = new TranslationService();

      const translationResult = await translationService.translate({
        text: message.content,
        targetLanguage: targetLanguage,
        originLanguage: sourceLanguage,
      });

      console.log(
        `Translated "${message.content}" from ${sourceLanguage} to ${targetLanguage}: "${translationResult.translatedText}"`
      );

      // Add to message queue for ordered delivery with user profile
      await MessageQueueManager.addToQueue(
        targetChannelId,
        message,
        targetLanguage,
        translationResult.translatedText,
        userProfile
      );
    } catch (error) {
      console.error(
        `Translation failed for message "${message.content}" to ${targetLanguage}:`,
        error
      );

      // Optionally, queue the original message with an error indicator
      await MessageQueueManager.addToQueue(
        targetChannelId,
        message,
        targetLanguage,
        `[Translation Error] ${message.content}`,
        userProfile
      );
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
}
