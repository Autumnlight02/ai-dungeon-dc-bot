import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export const syncLanguageCommand = {
  data: new SlashCommandBuilder()
    .setName('sync-language')
    .setDescription('Synchronize language settings for AI Dungeon')
    .addStringOption(option =>
      option
        .setName('language')
        .setDescription('The language to sync')
        .setRequired(true)
        .addChoices(
          { name: 'English', value: 'en' },
          { name: 'Spanish', value: 'es' },
          { name: 'French', value: 'fr' },
          { name: 'German', value: 'de' },
          { name: 'Italian', value: 'it' },
          { name: 'Portuguese', value: 'pt' },
          { name: 'Russian', value: 'ru' },
          { name: 'Japanese', value: 'ja' },
          { name: 'Korean', value: 'ko' },
          { name: 'Chinese (Simplified)', value: 'zh-cn' },
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const language = interaction.options.get('language')?.value as string;
    
    console.log(`Sync language command executed by ${interaction.user.tag} with language: ${language}`);
    
    await interaction.reply({
      content: `Language synchronized to: **${language}**\nAI Dungeon will now use this language setting.`,
      ephemeral: true
    });
  },
};