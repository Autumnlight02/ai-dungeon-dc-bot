import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { MessageService } from '../messages/message.service';
import { syncLanguageCommand } from '../commands/sync-language.command';

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

    this.messageService = new MessageService();
    this.commands = new Collection();
    this.loadCommands();
    this.setupEventListeners();
  }

  private loadCommands(): void {
    this.commands.set(syncLanguageCommand.data.name, syncLanguageCommand);
  }

  private setupEventListeners(): void {
    this.client.once('ready', () => {
      console.log(`Bot is ready! Logged in as ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', (message) => {
      this.messageService.handleMessage(message);
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
  }

  public async login(token: string): Promise<void> {
    try {
      await this.client.login(token);
    } catch (error) {
      console.error('Failed to login to Discord:', error);
      throw error;
    }
  }

  public getClient(): Client {
    return this.client;
  }
}