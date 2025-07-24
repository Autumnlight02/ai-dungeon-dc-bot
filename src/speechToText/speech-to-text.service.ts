import { Message, Attachment } from "discord.js";
import {
  MistralClient,
  type SpeechToTextResult,
} from "../mistral/mistral.client";

export interface VoiceMessageInfo {
  messageId: string;
  authorId: string;
  authorName: string;
  channelId: string;
  attachmentUrl: string;
  duration?: number;
  waveform?: string;
}

export interface TranscriptionResult extends SpeechToTextResult {
  messageInfo: VoiceMessageInfo;
  downloadPath?: string;
  processingTime: number;
}

export class SpeechToTextService {
  private mistralClient: MistralClient;
  private static readonly VOICE_DOWNLOADS_DIR = "./tmp/voice-downloads";
  private static readonly VOICE_MESSAGE_TYPES = [
    "audio/ogg",
    "audio/webm",
    "audio/mp3",
    "audio/wav",
    "audio/m4a",
  ];

  constructor() {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "MISTRAL_API_KEY environment variable is required for speech-to-text functionality"
      );
    }

    this.mistralClient = new MistralClient({ apiKey });
  }

  public async processVoiceMessage(
    message: Message
  ): Promise<TranscriptionResult | null> {
    if (!this.isVoiceMessage(message)) {
      return null;
    }

    const voiceAttachment = this.getVoiceAttachment(message);
    if (!voiceAttachment) {
      return null;
    }

    console.log(
      `Processing voice message from ${message.author.displayName} (${voiceAttachment.size} bytes)`
    );

    const startTime = Date.now();
    try {
      // Extract voice message info
      const messageInfo: VoiceMessageInfo = {
        messageId: message.id,
        authorId: message.author.id,
        authorName: message.author.displayName || message.author.username,
        channelId: message.channel.id,
        attachmentUrl: voiceAttachment.url,
        duration: this.extractDuration(voiceAttachment),
        waveform: this.extractWaveform(voiceAttachment),
      };

      // Download the audio file
      const audioBuffer = await this.downloadVoiceMessage(voiceAttachment);
      const audioFormat = this.getAudioFormat(voiceAttachment);

      console.log(
        `Downloaded voice message: ${audioBuffer.length} bytes, format: ${audioFormat}`
      );

      // Transcribe using Mistral Voxtral
      const transcriptionResult = await this.mistralClient.transcribeAudio({
        audioBuffer,
        format: audioFormat,
        language: undefined, // Let Voxtral auto-detect language
      });

      const processingTime = Date.now() - startTime;

      console.log(
        `Voice message transcribed: "${transcriptionResult.text}" (${processingTime}ms)`
      );

      return {
        ...transcriptionResult,
        messageInfo,
        processingTime,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(
        `Failed to process voice message from ${message.author.displayName}:`,
        error
      );

      // Return error result
      throw new Error(
        `Speech-to-text processing failed after ${processingTime}ms: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  public isVoiceMessage(message: Message): boolean {
    // Discord voice messages have specific characteristics
    return message.attachments.some((attachment) => {
      return (
        // Check for audio MIME type
        (attachment.contentType &&
          SpeechToTextService.VOICE_MESSAGE_TYPES.includes(
            attachment.contentType
          )) ||
        // Check for Discord voice message flags (Discord voice messages often have a waveform)
        (attachment.flags !== undefined && attachment.flags.toArray().length > 0) ||
        // Check filename patterns (Discord voice messages often have specific naming)
        (attachment.name && /^voice-message/.test(attachment.name))
      );
    });
  }

  private getVoiceAttachment(message: Message): Attachment | null {
    return (
      message.attachments.find((attachment) => {
        return (
          attachment.contentType &&
          SpeechToTextService.VOICE_MESSAGE_TYPES.includes(
            attachment.contentType
          )
        );
      }) || null
    );
  }

  private async downloadVoiceMessage(attachment: Attachment): Promise<Buffer> {
    try {
      console.log(`Downloading voice message: ${attachment.url}`);

      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      throw new Error(
        `Failed to download voice message: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private getAudioFormat(attachment: Attachment): string {
    if (attachment.contentType) {
      // Extract format from MIME type
      const mimeTypeMap: Record<string, string> = {
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "audio/mp3": "mp3",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/m4a": "m4a",
        "audio/flac": "flac",
      };

      const format = mimeTypeMap[attachment.contentType.toLowerCase()];
      if (format) return format;
    }

    // Fall back to file extension
    if (attachment.name) {
      const extension = attachment.name.split(".").pop()?.toLowerCase();
      if (
        extension &&
        MistralClient.getSupportedFormats().includes(extension)
      ) {
        return extension;
      }
    }

    // Default to webm (common for Discord voice messages)
    return "webm";
  }

  private extractDuration(_attachment: Attachment): number | undefined {
    // Discord sometimes includes duration in attachment metadata
    // This is implementation-specific and may not always be available
    return undefined;
  }

  private extractWaveform(_attachment: Attachment): string | undefined {
    // Discord voice messages sometimes include waveform data
    // This is implementation-specific and may not always be available
    return undefined;
  }

  public async testMistralConnection(): Promise<boolean> {
    try {
      return await this.mistralClient.testConnection();
    } catch (error) {
      console.error("Failed to test Mistral connection:", error);
      return false;
    }
  }

  public getSupportedFormats(): string[] {
    return MistralClient.getSupportedFormats();
  }

  public getMaxFileSizeMB(): number {
    return MistralClient.getMaxFileSizeMB();
  }

  public getServiceInfo(): {
    model: string;
    provider: string;
    supportedFormats: string[];
    maxFileSizeMB: number;
  } {
    const modelInfo = MistralClient.getModelInfo();
    return {
      ...modelInfo,
      supportedFormats: this.getSupportedFormats(),
      maxFileSizeMB: this.getMaxFileSizeMB(),
    };
  }

  public async cleanupOldVoiceFiles(maxAgeHours: number = 1): Promise<void> {
    try {
      const maxAge = Date.now() - maxAgeHours * 60 * 60 * 1000;

      // Get all files in voice downloads directory
      const result =
        await Bun.$`find ${SpeechToTextService.VOICE_DOWNLOADS_DIR} -type f -name "*"`.quiet();
      const files = result.stdout
        .toString()
        .trim()
        .split("\n")
        .filter((file) => file);

      for (const filePath of files) {
        try {
          const stats = Bun.file(filePath);
          const fileExists = await stats.exists();

          if (fileExists) {
            // Use file modification time for cleanup (since we can't easily get creation time)
            const fileName = filePath.split("/").pop();
            if (fileName) {
              // Extract timestamp from filename if it follows our naming pattern
              const timestampMatch = fileName.match(/^(\d+)_/);
              if (timestampMatch && timestampMatch[1]) {
                const timestamp = parseInt(timestampMatch[1], 10);
                if (timestamp < maxAge) {
                  await Bun.$`rm "${filePath}"`;
                  console.log(`Cleaned up old voice file: ${filePath}`);
                }
              }
            }
          }
        } catch (error) {
          console.warn(`Error processing voice file ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error("Error during voice file cleanup:", error);
    }
  }

  public async getProcessingStats(): Promise<{
    totalProcessed: number;
    averageProcessingTime?: number;
    successRate?: number;
  }> {
    // This would typically be stored in a database or cache
    // For now, return basic stats
    return {
      totalProcessed: 0,
      averageProcessingTime: undefined,
      successRate: undefined,
    };
  }
}
