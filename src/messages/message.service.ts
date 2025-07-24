import { Message, Client } from 'discord.js';
import { SyncMessageService } from '../sync-translate/sync-message.service';

export class MessageService {
  private syncMessageService: SyncMessageService;

  constructor(client: Client) {
    this.syncMessageService = new SyncMessageService(client);
  }

  public async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    // Log all messages
    console.log('Message received:', {
      author: message.author.tag,
      authorId: message.author.id,
      content: message.content,
      channel: message.channel.id,
      channelName: message.channel.type === 0 ? message.channel.name : 'DM',
      guild: message.guild?.name || 'DM',
      guildId: message.guild?.id || null,
      timestamp: message.createdAt.toISOString(),
    });

    // Process sync translation if applicable
    await this.syncMessageService.handleMessage(message);
  }

  public getSyncMessageService(): SyncMessageService {
    return this.syncMessageService;
  }
}