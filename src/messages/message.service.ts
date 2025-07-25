import { Message, Client } from 'discord.js';
import { SyncMessageService } from '../sync-translate/sync-message.service';
import { SpeechToTextService } from '../speechToText/speech-to-text.service';

export class MessageService {
  private syncMessageService: SyncMessageService;
  private speechToTextService: SpeechToTextService;

  constructor(client: Client) {
    this.syncMessageService = new SyncMessageService(client);
    
    try {
      this.speechToTextService = new SpeechToTextService();
      console.log('Speech-to-text service initialized successfully');
    } catch (error) {
      console.warn('Speech-to-text service initialization failed:', error);
      // Service will be undefined, which we'll handle gracefully
    }
  }

  public async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) {
      return;
    }

    // Check for voice messages first
    const isVoiceMessage = this.speechToTextService?.isVoiceMessage(message) || false;

    // Log all messages with emoji debugging
    const customEmojiRegex = /<(a?):(\w+):(\d+)>/g;
    const foundEmojis = message.content.match(customEmojiRegex);
    
    console.log('Message received:', {
      author: message.author.tag,
      authorId: message.author.id,
      content: message.content,
      rawContent: JSON.stringify(message.content),
      foundCustomEmojis: foundEmojis,
      channel: message.channel.id,
      channelName: message.channel.type === 0 ? message.channel.name : 'DM',
      guild: message.guild?.name || 'DM',
      guildId: message.guild?.id || null,
      timestamp: message.createdAt.toISOString(),
      isVoiceMessage,
      attachments: message.attachments.size
    });

    // Process voice messages for speech-to-text
    if (isVoiceMessage && this.speechToTextService) {
      try {
        console.log(`Processing voice message from ${message.author.displayName}`);
        
        const transcriptionResult = await this.speechToTextService.processVoiceMessage(message);
        
        if (transcriptionResult) {
          console.log(`Voice message transcribed: "${transcriptionResult.text}"`);
          
          // Send transcription as a reply in the same channel
          await this.sendTranscriptionReply(message, transcriptionResult);
          
          // Create a synthetic text message for translation processing
          const syntheticMessage = this.createSyntheticMessage(message, transcriptionResult.text);
          await this.syncMessageService.handleMessage(syntheticMessage);
        }
      } catch (error) {
        console.error('Failed to process voice message:', error);
        // Send error notification
        await this.sendTranscriptionError(message, error);
      }
    }

    // Process regular text messages for sync translation
    if (!isVoiceMessage && message.content) {
      await this.syncMessageService.handleMessage(message);
    }
  }

  private async sendTranscriptionReply(
    originalMessage: Message,
    transcriptionResult: any
  ): Promise<void> {
    try {
      const replyContent = `🎤 **Voice Message Transcription:**\n> ${transcriptionResult.text}\n\n*Detected language: ${transcriptionResult.language || 'auto'} • Processing time: ${transcriptionResult.processingTime}ms*`;
      
      await originalMessage.reply(replyContent);
    } catch (error) {
      console.error('Failed to send transcription reply:', error);
    }
  }

  private async sendTranscriptionError(
    originalMessage: Message,
    error: unknown
  ): Promise<void> {
    try {
      const errorMessage = `❌ **Voice Message Transcription Failed**\n*${error instanceof Error ? error.message : 'Unknown error'}*`;
      
      await originalMessage.reply(errorMessage);
    } catch (replyError) {
      console.error('Failed to send transcription error reply:', replyError);
    }
  }

  private createSyntheticMessage(originalMessage: Message, transcribedText: string): Message {
    // Create a synthetic message object for translation processing
    // This allows the transcribed text to be processed by the sync translation system
    const syntheticMessage = Object.create(originalMessage);
    syntheticMessage.content = transcribedText;
    return syntheticMessage;
  }

  public getSyncMessageService(): SyncMessageService {
    return this.syncMessageService;
  }

  public getSpeechToTextService(): SpeechToTextService | undefined {
    return this.speechToTextService;
  }

  public async testSpeechToTextConnection(): Promise<boolean> {
    if (!this.speechToTextService) {
      return false;
    }
    
    try {
      return await this.speechToTextService.testMistralConnection();
    } catch (error) {
      console.error('Speech-to-text connection test failed:', error);
      return false;
    }
  }

  public getSpeechToTextInfo(): any {
    if (!this.speechToTextService) {
      return { enabled: false, reason: 'Service not initialized' };
    }

    return {
      enabled: true,
      ...this.speechToTextService.getServiceInfo()
    };
  }
}