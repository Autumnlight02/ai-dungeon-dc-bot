export interface Language {
  code: string;
  name: string;
  nativeName?: string;
}

export interface LanguageChoice {
  name: string;
  value: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'auto', name: 'Auto-detect', nativeName: 'Auto-detect' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh-cn', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh-tw', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių' },
  { code: 'mt', name: 'Maltese', nativeName: 'Malti' },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge' },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg' },
  { code: 'eu', name: 'Basque', nativeName: 'Euskera' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'gl', name: 'Galician', nativeName: 'Galego' },
  { code: 'ast', name: 'Asturian', nativeName: 'Asturianu' },
  { code: 'oc', name: 'Occitan', nativeName: 'Occitan' },
  { code: 'br', name: 'Breton', nativeName: 'Brezhoneg' },
  { code: 'co', name: 'Corsican', nativeName: 'Corsu' },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska' },
  { code: 'mk', name: 'Macedonian', nativeName: 'Македонски' },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски' },
  { code: 'bs', name: 'Bosnian', nativeName: 'Bosanski' },
  { code: 'me', name: 'Montenegrin', nativeName: 'Crnogorski' },
];

export const PRIMARY_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh-cn', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh-tw', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
];

export class LanguageService {
  private static readonly supportedLanguageCodes = new Set(
    SUPPORTED_LANGUAGES.map(lang => lang.code)
  );

  public static getSupportedLanguages(): Language[] {
    return [...SUPPORTED_LANGUAGES];
  }

  public static getPrimaryLanguages(): Language[] {
    return [...PRIMARY_LANGUAGES];
  }

  public static getSupportedLanguageCodes(): string[] {
    return SUPPORTED_LANGUAGES.map(lang => lang.code);
  }

  public static getLanguageChoicesForCommand(): LanguageChoice[] {
    return PRIMARY_LANGUAGES.map(lang => ({
      name: `${lang.name} (${lang.nativeName})`,
      value: lang.code
    }));
  }

  public static isLanguageSupported(languageCode: string): boolean {
    return this.supportedLanguageCodes.has(languageCode.toLowerCase());
  }

  public static getLanguageByCode(code: string): Language | undefined {
    return SUPPORTED_LANGUAGES.find(lang => lang.code.toLowerCase() === code.toLowerCase());
  }

  public static getLanguageName(code: string): string {
    const language = this.getLanguageByCode(code);
    return language ? language.name : code;
  }

  public static getLanguageNativeName(code: string): string {
    const language = this.getLanguageByCode(code);
    return language?.nativeName || language?.name || code;
  }

  public static searchLanguages(query: string): Language[] {
    const searchTerm = query.toLowerCase();
    return SUPPORTED_LANGUAGES.filter(lang => 
      lang.name.toLowerCase().includes(searchTerm) ||
      lang.code.toLowerCase().includes(searchTerm) ||
      (lang.nativeName && lang.nativeName.toLowerCase().includes(searchTerm))
    );
  }
}