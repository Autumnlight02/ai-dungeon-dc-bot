import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionReplyOptions } from 'discord.js';
import { LanguageService } from './languages';
import { SyncStorageService } from './sync-storage.service';

export const syncLanguageCommand = {
  data: new SlashCommandBuilder()
    .setName('sync-language')
    .setDescription('Synchronize language settings for AI Dungeon')
    .addStringOption(option =>
      option
        .setName('language')
        .setDescription('The language to sync')
        .setRequired(true)
        .addChoices(...LanguageService.getLanguageChoicesForCommand())
    )
    .addStringOption(option =>
      option
        .setName('channel-group-id')
        .setDescription('Channel group ID to sync this channel with')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const languageCode = interaction.options.get('language')?.value as string;
    const channelGroupId = interaction.options.get('channel-group-id')?.value as string;
    const languageName = LanguageService.getLanguageName(languageCode);
    const nativeName = LanguageService.getLanguageNativeName(languageCode);
    
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: ['Ephemeral']
      } as InteractionReplyOptions);
      return;
    }

    const serverId = interaction.guild.id;
    const channelId = interaction.channel?.id;

    if (!channelId) {
      await interaction.reply({
        content: 'Unable to determine the current channel.',
        flags: ['Ephemeral']
      } as InteractionReplyOptions);
      return;
    }

    try {
      await SyncStorageService.addChannelToGroup(
        serverId,
        channelGroupId,
        channelId,
        languageCode
      );

      console.log(`Sync language command executed by ${interaction.user.tag} - Server: ${serverId}, Group: ${channelGroupId}, Channel: ${channelId}, Language: ${languageCode} (${languageName})`);
      
      await interaction.reply({
        content: `✅ Language synchronized!\n**Language:** ${languageName} (${nativeName})\n**Channel Group:** ${channelGroupId}\n**Channel:** <#${channelId}>\n\nThis channel is now part of the translation sync group.`,
        flags: ['Ephemeral']
      } as InteractionReplyOptions);
    } catch (error) {
      console.error('Error saving sync language settings:', error);
      await interaction.reply({
        content: '❌ Failed to save language synchronization settings. Please try again.',
        flags: ['Ephemeral']
      } as InteractionReplyOptions);
    }
  },
};