import { Message } from 'discord.js';

export class MessageService {
  public handleMessage(message: Message): void {
    if (message.author.bot) {
      return;
    }

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
  }
}