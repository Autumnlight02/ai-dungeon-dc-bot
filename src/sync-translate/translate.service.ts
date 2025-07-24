export interface TranslationRequest {
  text: string;
  targetLanguage: string;
  originLanguage?: string;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  detectedLanguage?: string;
  targetLanguage: string;
}

export interface TranslationError {
  message: string;
  code?: string;
  originalError?: unknown;
}

import { LanguageService } from './languages';

export class TranslationService {
  private static readonly GOOGLE_TRANSLATE_API_URL = 'https://translate.googleapis.com/translate_a/single';

  public async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.validateRequest(request);

    const url = this.buildTranslationUrl(request);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return this.parseTranslationResponse(data, request);
      
    } catch (error) {
      throw this.createTranslationError('Translation request failed', error);
    }
  }

  private validateRequest(request: TranslationRequest): void {
    if (!request.text || typeof request.text !== 'string') {
      throw new Error('Text is required and must be a non-empty string');
    }

    if (request.text.trim().length === 0) {
      throw new Error('Text cannot be empty or contain only whitespace');
    }

    if (request.text.length > 5000) {
      throw new Error('Text is too long (maximum 5000 characters)');
    }

    if (!request.targetLanguage || typeof request.targetLanguage !== 'string') {
      throw new Error('Target language is required and must be a string');
    }

    if (!LanguageService.isLanguageSupported(request.targetLanguage)) {
      throw new Error(`Unsupported target language: ${request.targetLanguage}`);
    }

    if (request.originLanguage && !LanguageService.isLanguageSupported(request.originLanguage)) {
      throw new Error(`Unsupported origin language: ${request.originLanguage}`);
    }
  }

  private buildTranslationUrl(request: TranslationRequest): URL {
    const url = new URL(TranslationService.GOOGLE_TRANSLATE_API_URL);
    
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', request.originLanguage?.toLowerCase() || 'auto');
    url.searchParams.set('tl', request.targetLanguage.toLowerCase());
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', request.text);

    return url;
  }

  private parseTranslationResponse(data: any, request: TranslationRequest): TranslationResult {
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('Invalid translation response format');
    }

    try {
      const translatedText = data[0]
        .map((segment: any[]) => segment[0])
        .filter((text: string) => text)
        .join('');

      if (!translatedText) {
        throw new Error('Empty translation result');
      }

      const result: TranslationResult = {
        originalText: request.text,
        translatedText,
        targetLanguage: request.targetLanguage.toLowerCase(),
      };

      if (data[2] && typeof data[2] === 'string') {
        result.detectedLanguage = data[2];
      }

      return result;
      
    } catch (error) {
      throw this.createTranslationError('Failed to parse translation response', error);
    }
  }

  private createTranslationError(message: string, originalError?: unknown): TranslationError {
    const error: TranslationError = { message };
    
    if (originalError instanceof Error) {
      error.originalError = originalError;
      error.code = originalError.name;
    } else if (originalError) {
      error.originalError = originalError;
    }

    return error;
  }

  public static getSupportedLanguages(): string[] {
    return LanguageService.getSupportedLanguageCodes();
  }

  public static isLanguageSupported(languageCode: string): boolean {
    return LanguageService.isLanguageSupported(languageCode);
  }
}