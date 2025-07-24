import { DiscordClient } from "./discord/discord.client";

async function main() {
  const discordBot = new DiscordClient();

  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    console.error("DISCORD_TOKEN environment variable is required");
    process.exit(1);
  }

  try {
    await discordBot.login(token);
  } catch (error) {
    console.error("Failed to start the bot:", error);
    process.exit(1);
  }
}

main();
