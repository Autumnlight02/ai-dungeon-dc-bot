import { Guild, GuildEmoji } from "discord.js";

export interface EmojiCloneInfo {
  originalId: string;
  originalName: string;
  clonedId: string;
  clonedEmoji: GuildEmoji;
  animated: boolean;
  guildId: string;
}

export class EmojiSyncService {
  private static temporaryEmojis = new Map<string, EmojiCloneInfo>();
  private static readonly TEMP_EMOJI_PREFIX = "temp_";
  private static readonly CLEANUP_DELAY_MS = 5000; // 5 seconds after message sent

  public static async extractAndCloneEmojis(
    content: string,
    sourceGuild: Guild,
    targetGuild: Guild
  ): Promise<{ processedContent: string; clonedEmojis: EmojiCloneInfo[] }> {
    console.log(`=== EMOJI CLONING START ===`);
    console.log(`Content: ${content}`);
    console.log(`Source guild: ${sourceGuild.name} (${sourceGuild.id})`);
    console.log(`Target guild: ${targetGuild.name} (${targetGuild.id})`);
    
    const customEmojiRegex = /<(a?):([^:]+):(\d+)>/g;
    const clonedEmojis: EmojiCloneInfo[] = [];
    let processedContent = content;

    // Find all custom emojis in the content
    const emojiMatches = [...content.matchAll(customEmojiRegex)];
    console.log(`Found ${emojiMatches.length} emoji matches:`, emojiMatches.map(m => m[0]));

    for (const match of emojiMatches) {
      const [fullMatch, animated, name, id] = match;
      const isAnimated = animated === "a";

      console.log(`Processing emoji: ${fullMatch} (name: ${name}, id: ${id}, animated: ${isAnimated})`);

      try {
        // Check if emoji already exists in target guild
        const existingEmoji =
          targetGuild.emojis.cache.get(id) ||
          targetGuild.emojis.cache.find((e) => e.name === name);

        if (existingEmoji) {
          // Use existing emoji
          const correctFormat = isAnimated
            ? `<a:${existingEmoji.name}:${existingEmoji.id}>`
            : `<:${existingEmoji.name}:${existingEmoji.id}>`;
          processedContent = processedContent.replace(fullMatch, correctFormat);
          continue;
        }

        // Get the original emoji from source guild
        let sourceEmoji = sourceGuild.emojis.cache.get(id);
        
        if (!sourceEmoji) {
          console.warn(`Source emoji ${name}:${id} not found in source guild cache`);
          console.warn(`Available emojis in source guild:`, sourceGuild.emojis.cache.map(e => `${e.name}:${e.id}`));
          
          // Try to fetch the emoji directly from Discord API if it's from another server
          try {
            console.log(`Attempting to fetch emoji ${id} directly from Discord API...`);
            const fetchedEmoji = await sourceGuild.client.application?.emojis.fetch(id);
            if (fetchedEmoji) {
              console.log(`Successfully fetched external emoji ${fetchedEmoji.name}:${fetchedEmoji.id}`);
              // Create a mock emoji-like object for cloning
              sourceEmoji = {
                id: fetchedEmoji.id,
                name: fetchedEmoji.name || name,
                animated: fetchedEmoji.animated || isAnimated,
                url: `https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}`,
                guild: sourceGuild
              } as any;
            }
          } catch (fetchError) {
            console.warn(`Failed to fetch external emoji ${id}:`, fetchError);
          }
          
          if (!sourceEmoji) {
            // Still no emoji found, convert to display name as fallback
            console.log(`Converting emoji ${name}:${id} to display name :${name}:`);
            processedContent = processedContent.replace(fullMatch, `:${name}:`);
            continue;
          }
        }

        console.log(`Found source emoji: ${sourceEmoji.name}:${sourceEmoji.id} (animated: ${sourceEmoji.animated})`);

        // Clone the emoji to target guild
        const clonedEmoji = await this.cloneEmojiToGuild(
          sourceEmoji,
          targetGuild
        );

        if (clonedEmoji) {
          const cloneInfo: EmojiCloneInfo = {
            originalId: id,
            originalName: name,
            clonedId: clonedEmoji.id,
            clonedEmoji,
            animated: isAnimated,
            guildId: targetGuild.id,
          };

          clonedEmojis.push(cloneInfo);
          this.temporaryEmojis.set(
            `${targetGuild.id}_${clonedEmoji.id}`,
            cloneInfo
          );

          // Replace in content with new emoji ID
          const newEmojiFormat = isAnimated
            ? `<a:${clonedEmoji.name}:${clonedEmoji.id}>`
            : `<:${clonedEmoji.name}:${clonedEmoji.id}>`;
          processedContent = processedContent.replace(
            fullMatch,
            newEmojiFormat
          );

          console.log(
            `Cloned emoji ${name} from ${sourceGuild.name} to ${targetGuild.name} (${clonedEmoji.id})`
          );
        } else {
          // Cloning failed, use display name
          processedContent = processedContent.replace(fullMatch, `:${name}:`);
        }
      } catch (error) {
        console.error(`Failed to process emoji ${name}:${id}:`, error);
        // Fallback to display name
        processedContent = processedContent.replace(fullMatch, `:${name}:`);
      }
    }

    console.log(`=== EMOJI CLONING COMPLETE ===`);
    console.log(`Processed content: ${processedContent}`);
    console.log(`Cloned ${clonedEmojis.length} emojis`);
    
    return { processedContent, clonedEmojis };
  }

  private static async cloneEmojiToGuild(
    sourceEmoji: GuildEmoji,
    targetGuild: Guild
  ): Promise<GuildEmoji | null> {
    try {
      console.log(`Attempting to clone emoji ${sourceEmoji.name} from ${sourceEmoji.guild.name} to ${targetGuild.name}`);
      
      // Check if bot has permission to manage emojis
      const botMember = targetGuild.members.cache.get(
        targetGuild.client.user!.id
      );
      
      console.log(`Bot member found: ${!!botMember}`);
      if (botMember) {
        console.log(`Bot permissions:`, botMember.permissions.toArray());
      }
      
      if (!botMember?.permissions.has("ManageEmojisAndStickers")) {
        console.error(
          `Bot lacks ManageEmojisAndStickers permission in ${targetGuild.name}`
        );
        return null;
      }

      // Check emoji limits
      const currentEmojis = targetGuild.emojis.cache.size;
      const maxEmojis =
        targetGuild.premiumTier >= 2
          ? 150
          : targetGuild.premiumTier >= 1
          ? 100
          : 50;

      console.log(`Target guild emoji count: ${currentEmojis}/${maxEmojis} (tier: ${targetGuild.premiumTier})`);

      if (currentEmojis >= maxEmojis) {
        console.warn(
          `Target guild ${targetGuild.name} has reached emoji limit (${currentEmojis}/${maxEmojis})`
        );
        return null;
      }

      // Generate temporary name
      const tempName = `${this.TEMP_EMOJI_PREFIX}${
        sourceEmoji.name
      }_${Date.now().toString().slice(-6)}`;

      console.log(`Creating emoji with name: ${tempName}, URL: ${sourceEmoji.url}`);

      // Clone the emoji
      const clonedEmoji = await targetGuild.emojis.create({
        attachment: sourceEmoji.url,
        name: tempName,
        reason: `Temporary emoji for cross-server translation (original: ${sourceEmoji.name}:${sourceEmoji.id})`,
      });

      console.log(`Successfully created emoji: ${clonedEmoji.name}:${clonedEmoji.id}`);
      return clonedEmoji;
    } catch (error) {
      console.error(
        `Failed to clone emoji ${sourceEmoji.name} to ${targetGuild.name}:`,
        error
      );
      return null;
    }
  }

  public static async scheduleEmojiCleanup(
    clonedEmojis: EmojiCloneInfo[]
  ): Promise<void> {
    if (clonedEmojis.length === 0) return;

    console.log(
      `Scheduling cleanup for ${clonedEmojis.length} temporary emojis in ${this.CLEANUP_DELAY_MS}ms`
    );

    setTimeout(async () => {
      for (const emojiInfo of clonedEmojis) {
        try {
          await this.cleanupEmoji(emojiInfo);
        } catch (error) {
          console.error(
            `Failed to cleanup emoji ${emojiInfo.originalName}:`,
            error
          );
        }
      }
    }, this.CLEANUP_DELAY_MS);
  }

  private static async cleanupEmoji(emojiInfo: EmojiCloneInfo): Promise<void> {
    try {
      const key = `${emojiInfo.guildId}_${emojiInfo.clonedId}`;

      // Remove from tracking
      this.temporaryEmojis.delete(key);

      // Delete the emoji from Discord
      if (emojiInfo.clonedEmoji && emojiInfo.clonedEmoji.deletable) {
        await emojiInfo.clonedEmoji.delete(
          "Cleaning up temporary translation emoji"
        );
        console.log(
          `Cleaned up temporary emoji ${emojiInfo.originalName} (${emojiInfo.clonedId})`
        );
      }
    } catch (error) {
      console.error(
        `Error during emoji cleanup for ${emojiInfo.originalName}:`,
        error
      );
    }
  }

  public static async cleanupAllTemporaryEmojis(): Promise<void> {
    console.log(`Cleaning up ${this.temporaryEmojis.size} temporary emojis`);

    const cleanupPromises = Array.from(this.temporaryEmojis.values()).map(
      (emojiInfo) => this.cleanupEmoji(emojiInfo)
    );

    await Promise.allSettled(cleanupPromises);
    this.temporaryEmojis.clear();
  }

  public static getTemporaryEmojiStats(): {
    totalTemporary: number;
    byGuild: Record<string, number>;
  } {
    const byGuild: Record<string, number> = {};

    for (const emojiInfo of this.temporaryEmojis.values()) {
      byGuild[emojiInfo.guildId] = (byGuild[emojiInfo.guildId] || 0) + 1;
    }

    return {
      totalTemporary: this.temporaryEmojis.size,
      byGuild,
    };
  }

  public static isTemporaryEmoji(emojiId: string, guildId: string): boolean {
    return this.temporaryEmojis.has(`${guildId}_${emojiId}`);
  }

  // Emergency cleanup method - can be called manually if needed
  public static async emergencyCleanup(guildId?: string): Promise<void> {
    const emojisToCleanup = guildId
      ? Array.from(this.temporaryEmojis.values()).filter(
          (e) => e.guildId === guildId
        )
      : Array.from(this.temporaryEmojis.values());

    console.log(
      `Emergency cleanup: removing ${emojisToCleanup.length} temporary emojis`
    );

    for (const emojiInfo of emojisToCleanup) {
      try {
        await this.cleanupEmoji(emojiInfo);
      } catch (error) {
        console.error(
          `Emergency cleanup failed for emoji ${emojiInfo.originalName}:`,
          error
        );
      }
    }
  }
}
