export interface ChannelLanguageConfig {
  language: string;
  channelId: string;
}

export interface SyncTranslationStorage {
  [serverId: string]: {
    [channelGroupId: string]: ChannelLanguageConfig[];
  };
}

export class SyncStorageService {
  private static readonly STORAGE_FILE_PATH = "./sync-translations.json";

  public static async loadSyncData(): Promise<SyncTranslationStorage> {
    try {
      const file = Bun.file(this.STORAGE_FILE_PATH);
      const exists = await file.exists();

      if (!exists) {
        return {};
      }

      const content = await file.text();
      return JSON.parse(content) as SyncTranslationStorage;
    } catch (error) {
      console.error("Error loading sync translation data:", error);
      return {};
    }
  }

  public static async saveSyncData(
    data: SyncTranslationStorage
  ): Promise<void> {
    try {
      const jsonContent = JSON.stringify(data, null, 2);
      await Bun.write(this.STORAGE_FILE_PATH, jsonContent);
      console.log("Sync translation data saved successfully");
    } catch (error) {
      console.error("Error saving sync translation data:", error);
      throw new Error("Failed to save sync translation settings");
    }
  }

  public static async addChannelToGroup(
    serverId: string,
    channelGroupId: string,
    channelId: string,
    language: string
  ): Promise<void> {
    const data = await this.loadSyncData();

    if (!data[serverId]) {
      data[serverId] = {};
    }

    if (!data[serverId][channelGroupId]) {
      data[serverId][channelGroupId] = [];
    }

    // Check if channel already exists in this group
    const existingChannelIndex = data[serverId][channelGroupId].findIndex(
      (config) => config.channelId === channelId
    );

    const newConfig: ChannelLanguageConfig = {
      language,
      channelId,
    };

    if (existingChannelIndex >= 0) {
      // Update existing channel
      data[serverId][channelGroupId][existingChannelIndex] = newConfig;
    } else {
      // Add new channel
      data[serverId][channelGroupId].push(newConfig);
    }

    await this.saveSyncData(data);
  }

  public static async removeChannelFromGroup(
    serverId: string,
    channelGroupId: string,
    channelId: string
  ): Promise<boolean> {
    const data = await this.loadSyncData();

    if (!data[serverId] || !data[serverId][channelGroupId]) {
      return false;
    }

    const initialLength = data[serverId][channelGroupId].length;
    data[serverId][channelGroupId] = data[serverId][channelGroupId].filter(
      (config) => config.channelId !== channelId
    );

    // Remove empty group
    if (data[serverId][channelGroupId].length === 0) {
      delete data[serverId][channelGroupId];
    }

    // Remove empty server
    if (Object.keys(data[serverId]).length === 0) {
      delete data[serverId];
    }

    const wasRemoved =
      initialLength > (data[serverId]?.[channelGroupId]?.length || 0);

    if (wasRemoved) {
      await this.saveSyncData(data);
    }

    return wasRemoved;
  }

  public static async getChannelGroups(serverId: string): Promise<string[]> {
    const data = await this.loadSyncData();
    return Object.keys(data[serverId] || {});
  }

  public static async getChannelsInGroup(
    serverId: string,
    channelGroupId: string
  ): Promise<ChannelLanguageConfig[]> {
    const data = await this.loadSyncData();
    return data[serverId]?.[channelGroupId] || [];
  }

  public static async getAllSyncData(): Promise<SyncTranslationStorage> {
    return await this.loadSyncData();
  }

  public static async clearAllData(): Promise<void> {
    await this.saveSyncData({});
  }

  public static async getChannelLanguage(
    serverId: string,
    channelId: string
  ): Promise<string | null> {
    const data = await this.loadSyncData();
    const serverData = data[serverId];

    if (!serverData) return null;

    for (const groupId in serverData) {
      const channels = serverData[groupId];
      if (channels) {
        const channelConfig = channels.find(
          (config) => config.channelId === channelId
        );
        if (channelConfig) {
          return channelConfig.language;
        }
      }
    }

    return null;
  }
}
