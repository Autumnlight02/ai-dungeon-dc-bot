import { Message, TextChannel } from 'discord.js';
import { WebhookService } from './webhook.service';
import { UserUtils } from '../utils/user.utils';
import { AvatarCleanupService } from './avatar-cleanup.service';

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
      const translatedContent = `${queuedMessage.translatedText}\n\n*from #${sourceChannelName}*`;
      
      // Try webhook first for better user impersonation
      const webhookSuccess = await WebhookService.sendWebhookMessage(
        queuedMessage.targetChannelId,
        translatedContent,
        userProfile.displayName,
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

        const fallbackContent = `**${userProfile.displayName}** (from #${sourceChannelName}):\n${queuedMessage.translatedText}`;
        await targetChannel.send(fallbackContent);
      }
      
      console.log(`Translated message sent to channel ${queuedMessage.targetChannelId} as ${userProfile.displayName}`);
      
      // Remove reference count for profile picture cleanup
      if (userProfile.profilePicturePath) {
        await AvatarCleanupService.removeReference(userProfile.profilePicturePath);
      }
    } catch (error) {
      console.error(`Error sending translated message:`, error);
      
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