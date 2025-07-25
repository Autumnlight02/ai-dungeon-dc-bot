import { Message, TextChannel } from 'discord.js';
import { WebhookService } from './webhook.service';
import { UserUtils } from '../utils/user.utils';
import { AvatarCleanupService } from './avatar-cleanup.service';
import { EmojiSyncService, type EmojiCloneInfo } from './emoji-sync.service';

export interface QueuedMessage {
  id: string;
  originalMessage: Message;
  targetChannelId: string;
  targetLanguage: string;
  translatedText?: string;
  timestamp: number;
  userProfile?: {
    username: string;
    displayName: string;
    avatarUrl?: string;
    profilePicturePath?: string;
  };
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;

  constructor(channelId: string) {
    // channelId is stored for potential future use
  }

  public async addMessage(queuedMessage: QueuedMessage): Promise<void> {
    this.queue.push(queuedMessage);
    this.queue.sort((a, b) => a.timestamp - b.timestamp);
    
    if (!this.processing) {
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message) {
        try {
          await this.sendTranslatedMessage(message);
        } catch (error) {
          console.error(`Failed to send message to channel ${message.targetChannelId}:`, error);
        }
      }
    }

    this.processing = false;
  }

  private async sendTranslatedMessage(queuedMessage: QueuedMessage): Promise<void> {
    let clonedEmojis: EmojiCloneInfo[] = [];
    
    try {
      // Extract user profile if not already cached
      let userProfile = queuedMessage.userProfile;
      if (!userProfile) {
        try {
          const userResult = await UserUtils.extractUserLikeByMessage(queuedMessage.originalMessage);
          userProfile = {
            username: userResult.user.username,
            displayName: userResult.user.displayName,
            avatarUrl: userResult.user.avatarUrl,
            profilePicturePath: userResult.profilePicturePath
          };
        } catch (error) {
          console.warn('Failed to extract user profile, using fallback:', error);
          const author = queuedMessage.originalMessage.author;
          userProfile = {
            username: author.username,
            displayName: author.displayName || author.username,
            avatarUrl: author.displayAvatarURL({ size: 256 })
          };
        }
      }

      const sourceChannelName = (queuedMessage.originalMessage.channel as TextChannel).name;
      const translatedContent = queuedMessage.translatedText;
      const usernameWithChannel = `${userProfile.displayName} [#${sourceChannelName}]`;
      
      // Debug emoji availability in target vs source guild
      const sourceGuild = queuedMessage.originalMessage.guild;
      const targetChannel = await queuedMessage.originalMessage.client.channels.fetch(queuedMessage.targetChannelId) as TextChannel;
      const targetGuild = targetChannel?.guild;
      
      console.log(`Source guild: ${sourceGuild?.name} (${sourceGuild?.id})`);
      console.log(`Target guild: ${targetGuild?.name} (${targetGuild?.id})`);
      console.log(`Cross-server translation: ${sourceGuild?.id !== targetGuild?.id}`);
      
      if (sourceGuild && targetGuild && sourceGuild.id !== targetGuild.id) {
        const customEmojiRegex = /<(a?):(\w+):(\d+)>/g;
        const foundEmojis = translatedContent.match(customEmojiRegex);
        
        if (foundEmojis && foundEmojis.length > 0) {
          console.log('Cross-server emoji translation detected:');
          console.log(`Source guild: ${sourceGuild.name} (${sourceGuild.id})`);
          console.log(`Target guild: ${targetGuild.name} (${targetGuild.id})`);
          console.log('Emojis in message:', foundEmojis);
          
          foundEmojis.forEach((emojiMatch) => {
            const match = emojiMatch.match(/<(a?):(\w+):(\d+)>/);
            if (match) {
              const [, animated, name, id] = match;
              const sourceEmoji = sourceGuild.emojis.cache.get(id);
              const targetEmoji = targetGuild.emojis.cache.get(id) || targetGuild.emojis.cache.find(e => e.name === name);
              
              console.log(`Emoji ${name}:${id}:`);
              console.log(`  - In source guild: ${sourceEmoji ? 'YES' : 'NO'}`);
              console.log(`  - In target guild: ${targetEmoji ? `YES (${targetEmoji.id})` : 'NO'}`);
            }
          });
        }
      }
      
      // Handle emoji cloning (cross-server or missing emojis)
      let finalContent = translatedContent;
      
      // Check if we need to handle emoji cloning
      const customEmojiRegex = /<(a?):([^:]+):(\d+)>/g;
      const foundEmojis = translatedContent.match(customEmojiRegex);
      const needsEmojiHandling = foundEmojis && foundEmojis.length > 0;
      
      console.log(`Emojis in translated content: ${foundEmojis || 'none'}`);
      console.log(`Needs emoji handling: ${needsEmojiHandling}`);
      
      if (sourceGuild && targetGuild && needsEmojiHandling) {
        // Handle both cross-server and same-server emoji issues
        const isCrossServer = sourceGuild.id !== targetGuild.id;
        console.log(`Processing emojis (cross-server: ${isCrossServer})`);
        
        try {
          const emojiResult = await EmojiSyncService.extractAndCloneEmojis(
            translatedContent,
            sourceGuild,
            targetGuild
          );
          finalContent = emojiResult.processedContent;
          clonedEmojis = emojiResult.clonedEmojis;
          
          if (clonedEmojis.length > 0) {
            console.log(`Cloned ${clonedEmojis.length} emojis for translation`);
          }
        } catch (error) {
          console.error('Failed to clone emojis for translation:', error);
          // Fallback to original content
          finalContent = translatedContent;
        }
      }
      
      // Try webhook first for better user impersonation
      const webhookSuccess = await WebhookService.sendWebhookMessage(
        queuedMessage.targetChannelId,
        finalContent,
        usernameWithChannel,
        userProfile.avatarUrl
      );

      if (!webhookSuccess) {
        // Fallback to regular bot message
        console.log('Webhook failed, falling back to regular message');
        const targetChannel = await queuedMessage.originalMessage.client.channels.fetch(queuedMessage.targetChannelId) as TextChannel;
        
        if (!targetChannel || !targetChannel.isTextBased()) {
          console.error(`Target channel ${queuedMessage.targetChannelId} is not a text channel`);
          return;
        }

        const fallbackContent = `**${userProfile.displayName} [#${sourceChannelName}]**:\n${finalContent}`;
        await targetChannel.send(fallbackContent);
      }
      
      console.log(`Translated message sent to channel ${queuedMessage.targetChannelId} as ${userProfile.displayName}`);
      
      // Schedule cleanup for cloned emojis
      if (clonedEmojis.length > 0) {
        await EmojiSyncService.scheduleEmojiCleanup(clonedEmojis);
      }
      
      // Remove reference count for profile picture cleanup
      if (userProfile.profilePicturePath) {
        await AvatarCleanupService.removeReference(userProfile.profilePicturePath);
      }
    } catch (error) {
      console.error(`Error sending translated message:`, error);
      
      // Schedule cleanup for emojis even if message failed
      if (clonedEmojis.length > 0) {
        await EmojiSyncService.scheduleEmojiCleanup(clonedEmojis);
      }
      
      // Still remove reference even if message sending failed
      if (queuedMessage.userProfile?.profilePicturePath) {
        await AvatarCleanupService.removeReference(queuedMessage.userProfile.profilePicturePath);
      }
      
      throw error;
    }
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public isProcessing(): boolean {
    return this.processing;
  }

  private convertCrossServerEmojis(content: string, sourceGuild: any, targetGuild: any): string {
    const customEmojiRegex = /<(a?):(\w+):(\d+)>/g;
    
    return content.replace(customEmojiRegex, (match, animated, name, id) => {
      // Check if emoji exists in target guild
      const targetEmoji = targetGuild.emojis.cache.get(id);
      if (targetEmoji) {
        // Emoji exists with same ID, keep as is
        return match;
      }
      
      // Look for emoji with same name in target guild
      const sameNameEmoji = targetGuild.emojis.cache.find((e: any) => e.name === name);
      if (sameNameEmoji) {
        // Found emoji with same name, use target guild's version
        console.log(`Converting emoji ${name} from ${id} to ${sameNameEmoji.id}`);
        return animated ? `<a:${sameNameEmoji.name}:${sameNameEmoji.id}>` : `<:${sameNameEmoji.name}:${sameNameEmoji.id}>`;
      }
      
      // Emoji doesn't exist in target guild, convert to display name
      console.log(`Emoji ${name}:${id} not found in target guild, converting to display name`);
      return `:${name}:`;
    });
  }
}

export class MessageQueueManager {
  private static queues = new Map<string, MessageQueue>();

  public static getOrCreateQueue(channelId: string): MessageQueue {
    if (!this.queues.has(channelId)) {
      this.queues.set(channelId, new MessageQueue(channelId));
    }
    return this.queues.get(channelId)!;
  }

  public static async addToQueue(
    targetChannelId: string,
    originalMessage: Message,
    targetLanguage: string,
    translatedText: string,
    userProfile?: {
      username: string;
      displayName: string;
      avatarUrl?: string;
      profilePicturePath?: string;
    }
  ): Promise<void> {
    const queue = this.getOrCreateQueue(targetChannelId);
    
    const queuedMessage: QueuedMessage = {
      id: `${originalMessage.id}_${targetChannelId}`,
      originalMessage,
      targetChannelId,
      targetLanguage,
      translatedText,
      timestamp: originalMessage.createdTimestamp,
      userProfile
    };

    await queue.addMessage(queuedMessage);
  }

  public static getQueueStats(): { [channelId: string]: { length: number; processing: boolean } } {
    const stats: { [channelId: string]: { length: number; processing: boolean } } = {};
    
    for (const [channelId, queue] of this.queues) {
      stats[channelId] = {
        length: queue.getQueueLength(),
        processing: queue.isProcessing()
      };
    }
    
    return stats;
  }

  public static clearAllQueues(): void {
    this.queues.clear();
  }
}