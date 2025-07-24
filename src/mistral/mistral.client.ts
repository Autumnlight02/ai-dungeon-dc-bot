import { Mistral } from '@mistralai/mistralai';

export interface MistralClientConfig {
  apiKey: string;
  serverURL?: string;
}

export interface SpeechToTextResult {
  text: string;
  confidence?: number;
  language?: string;
  duration?: number;
  model: string;
}

export interface SpeechToTextRequest {
  audioBuffer: Buffer;
  language?: string;
  format?: string;
}

export class MistralClient {
  private client: Mistral;
  private apiKey: string;
  private static readonly DEFAULT_MODEL = 'voxtral-mini-latest';
  private static readonly SUPPORTED_FORMATS = ['mp3', 'wav', 'ogg', 'webm', 'm4a', 'flac'];
  private static readonly MAX_FILE_SIZE_MB = 25; // Mistral's limit

  constructor(config: MistralClientConfig) {
    this.apiKey = config.apiKey;
    this.client = new Mistral({
      apiKey: config.apiKey,
      serverURL: config.serverURL
    });
  }

  public async transcribeAudio(request: SpeechToTextRequest): Promise<SpeechToTextResult> {
    this.validateRequest(request);

    try {
      console.log(`Starting audio transcription with Voxtral model`);
      
      // Create a File-like object from the buffer
      const audioFile = new File([request.audioBuffer], `audio.${request.format || 'webm'}`, {
        type: this.getMimeType(request.format || 'webm')
      });

      const transcriptionRequest = {
        file: audioFile,
        model: MistralClient.DEFAULT_MODEL,
        language: request.language || undefined, // Let Voxtral auto-detect if not specified
        response_format: 'json' as const,
        temperature: 0.0 // For consistent transcription results
      };

      const startTime = Date.now();
      
      // Use the correct Mistral API for audio transcription
      const formData = new FormData();
      formData.append('file', audioFile);
      formData.append('model', MistralClient.DEFAULT_MODEL);
      if (request.language) {
        formData.append('language', request.language);
      }
      formData.append('response_format', 'json');
      formData.append('temperature', '0.0');

      const response = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      const duration = Date.now() - startTime;

      console.log(`Audio transcription completed in ${duration}ms`);

      return {
        text: result.text?.trim() || '',
        language: result.language || request.language,
        duration,
        model: MistralClient.DEFAULT_MODEL
      };

    } catch (error) {
      console.error('Mistral audio transcription failed:', error);
      throw new Error(`Speech-to-text conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private validateRequest(request: SpeechToTextRequest): void {
    if (!request.audioBuffer || request.audioBuffer.length === 0) {
      throw new Error('Audio buffer is required and cannot be empty');
    }

    const fileSizeMB = request.audioBuffer.length / (1024 * 1024);
    if (fileSizeMB > MistralClient.MAX_FILE_SIZE_MB) {
      throw new Error(`Audio file too large: ${fileSizeMB.toFixed(2)}MB (max: ${MistralClient.MAX_FILE_SIZE_MB}MB)`);
    }

    if (request.format && !MistralClient.SUPPORTED_FORMATS.includes(request.format.toLowerCase())) {
      throw new Error(`Unsupported audio format: ${request.format}. Supported formats: ${MistralClient.SUPPORTED_FORMATS.join(', ')}`);
    }

    console.log(`Validating audio file: ${fileSizeMB.toFixed(2)}MB, format: ${request.format || 'webm'}`);
  }

  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'webm': 'audio/webm',
      'm4a': 'audio/m4a',
      'flac': 'audio/flac'
    };
    return mimeTypes[format.toLowerCase()] || 'audio/webm';
  }

  public static getSupportedFormats(): string[] {
    return [...this.SUPPORTED_FORMATS];
  }

  public static getMaxFileSizeMB(): number {
    return this.MAX_FILE_SIZE_MB;
  }

  public static getModelInfo(): { model: string; provider: string } {
    return {
      model: this.DEFAULT_MODEL,
      provider: 'Mistral'
    };
  }

  public async testConnection(): Promise<boolean> {
    try {
      // Create a minimal test audio buffer (1 second of silence in WAV format)
      const testBuffer = this.createTestAudioBuffer();
      
      await this.transcribeAudio({
        audioBuffer: testBuffer,
        format: 'wav'
      });
      
      return true;
    } catch (error) {
      console.error('Mistral connection test failed:', error);
      return false;
    }
  }

  private createTestAudioBuffer(): Buffer {
    // Create a minimal WAV file with 1 second of silence (44.1kHz, 16-bit, mono)
    const sampleRate = 44100;
    const duration = 1; // 1 second
    const samples = sampleRate * duration;
    const bufferSize = 44 + samples * 2; // WAV header (44 bytes) + audio data

    const buffer = Buffer.alloc(bufferSize);
    let offset = 0;

    // WAV header
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(bufferSize - 8, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // PCM format size
    buffer.writeUInt16LE(1, offset); offset += 2;  // PCM format
    buffer.writeUInt16LE(1, offset); offset += 2;  // Mono
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(sampleRate * 2, offset); offset += 4; // Byte rate
    buffer.writeUInt16LE(2, offset); offset += 2;  // Block align
    buffer.writeUInt16LE(16, offset); offset += 2; // Bits per sample
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(samples * 2, offset); offset += 4;

    // Audio data (silence - all zeros, which Buffer.alloc already provides)
    return buffer;
  }
}