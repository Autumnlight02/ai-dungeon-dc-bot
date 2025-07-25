import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { MessageService } from '../messages/message.service';
import { syncLanguageCommand } from '../sync-translate/sync-language.command';
import { EmojiSyncService } from '../sync-translate/emoji-sync.service';

export class DiscordClient {
  private client: Client;
  private messageService: MessageService;
  private commands: Collection<string, any>;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.commands = new Collection();
    this.loadCommands();
    this.setupEventListeners();
    this.messageService = new MessageService(this.client);
  }

  private loadCommands(): void {
    this.commands.set(syncLanguageCommand.data.name, syncLanguageCommand);
  }

  private setupEventListeners(): void {
    this.client.once('ready', () => {
      console.log(`Bot is ready! Logged in as ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', async (message) => {
      try {
        await this.messageService.handleMessage(message);
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error('Error executing command:', error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
          await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
      }
    });

    // Cleanup temporary emojis on disconnect/shutdown
    this.client.on('disconnect', async () => {
      console.log('Bot disconnected, cleaning up temporary emojis...');
      await EmojiSyncService.cleanupAllTemporaryEmojis();
    });

    // Also handle process termination
    process.on('SIGINT', async () => {
      console.log('Bot shutting down (SIGINT), cleaning up temporary emojis...');
      await EmojiSyncService.cleanupAllTemporaryEmojis();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Bot shutting down (SIGTERM), cleaning up temporary emojis...');
      await EmojiSyncService.cleanupAllTemporaryEmojis();
      process.exit(0);
    });
  }

  public async login(token: string): Promise<void> {
    try {
      await this.registerCommands(token);
      await this.client.login(token);
    } catch (error) {
      console.error('Failed to login to Discord:', error);
      throw error;
    }
  }

  private async registerCommands(token: string): Promise<void> {
    const commands = [];
    
    for (const [, command] of this.commands) {
      commands.push(command.data.toJSON());
    }

    const rest = new REST().setToken(token);

    try {
      console.log(`Started refreshing ${commands.length} application (/) commands.`);

      const clientId = process.env.DISCORD_CLIENT_ID;
      if (!clientId) {
        throw new Error('DISCORD_CLIENT_ID environment variable is required for command registration');
      }

      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );

      console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
    } catch (error) {
      console.error('Error registering commands:', error);
      throw error;
    }
  }

  public getClient(): Client {
    return this.client;
  }
}