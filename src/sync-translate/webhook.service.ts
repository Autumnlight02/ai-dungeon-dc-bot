import { TextChannel, Webhook, Client } from 'discord.js';

interface WebhookCache {
  [channelId: string]: Webhook;
}

export class WebhookService {
  private static webhookCache: WebhookCache = {};
  private static client: Client;

  public static setClient(client: Client): void {
    this.client = client;
  }

  public static async getOrCreateWebhook(channelId: string): Promise<Webhook | null> {
    try {
      // Check cache first
      if (this.webhookCache[channelId]) {
        // Verify webhook still exists
        try {
          await this.webhookCache[channelId].fetch();
          return this.webhookCache[channelId];
        } catch (error) {
          // Webhook was deleted, remove from cache
          delete this.webhookCache[channelId];
        }
      }

      const channel = await this.client.channels.fetch(channelId) as TextChannel;
      
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        console.error(`Channel ${channelId} is not a valid text channel`);
        return null;
      }

      // Check if bot has permission to manage webhooks
      const permissions = channel.permissionsFor(this.client.user!);
      if (!permissions?.has('ManageWebhooks')) {
        console.error(`Bot does not have ManageWebhooks permission in channel ${channelId}`);
        return null;
      }

      // Look for existing bot webhook
      const existingWebhooks = await channel.fetchWebhooks();
      const botWebhook = existingWebhooks.find(
        webhook => webhook.owner?.id === this.client.user?.id && webhook.name === 'AI Dungeon Translator'
      );

      if (botWebhook) {
        this.webhookCache[channelId] = botWebhook;
        return botWebhook;
      }

      // Create new webhook
      const webhook = await channel.createWebhook({
        name: 'AI Dungeon Translator',
        reason: 'Created for translation sync functionality'
      });

      this.webhookCache[channelId] = webhook;
      console.log(`Created webhook for channel ${channelId}`);
      
      return webhook;
    } catch (error) {
      console.error(`Failed to get or create webhook for channel ${channelId}:`, error);
      return null;
    }
  }

  public static async sendWebhookMessage(
    channelId: string,
    content: string,
    username: string,
    avatarURL?: string
  ): Promise<boolean> {
    try {
      const webhook = await this.getOrCreateWebhook(channelId);
      
      if (!webhook) {
        console.error(`Could not get webhook for channel ${channelId}`);
        return false;
      }

      await webhook.send({
        content,
        username,
        avatarURL: avatarURL || undefined,
        allowedMentions: {
          parse: ['users'], // Allow user mentions but not @everyone/@here
          repliedUser: false
        }
      });

      return true;
    } catch (error) {
      console.error(`Failed to send webhook message to channel ${channelId}:`, error);
      return false;
    }
  }

  public static async cleanupWebhooks(): Promise<void> {
    try {
      console.log('Cleaning up cached webhooks...');
      
      for (const [channelId, webhook] of Object.entries(this.webhookCache)) {
        try {
          await webhook.fetch();
        } catch (error) {
          // Webhook no longer exists, remove from cache
          delete this.webhookCache[channelId];
          console.log(`Removed stale webhook from cache for channel ${channelId}`);
        }
      }
    } catch (error) {
      console.error('Error during webhook cleanup:', error);
    }
  }

  public static async deleteWebhook(channelId: string): Promise<boolean> {
    try {
      const webhook = this.webhookCache[channelId];
      if (webhook) {
        await webhook.delete('Cleaning up translation webhook');
        delete this.webhookCache[channelId];
        console.log(`Deleted webhook for channel ${channelId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to delete webhook for channel ${channelId}:`, error);
      return false;
    }
  }

  public static getWebhookStats(): { 
    totalWebhooks: number; 
    channels: string[] 
  } {
    return {
      totalWebhooks: Object.keys(this.webhookCache).length,
      channels: Object.keys(this.webhookCache)
    };
  }

  public static clearCache(): void {
    this.webhookCache = {};
  }
}