import { Message } from 'discord.js';
import { join, extname } from 'path';

export interface UserLike {
  id: string;
  username: string;
  displayName: string;
  tag: string;
  avatarUrl?: string;
  profilePicturePath?: string;
}

export interface ExtractUserResult {
  user: UserLike;
  profilePicturePath?: string;
}

export class UserUtils {
  private static readonly PFP_DIR = './tmp/pfp';
  private static readonly DEFAULT_AVATAR_SIZE = 512;
  private static readonly SUPPORTED_IMAGE_FORMATS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

  public static async extractUserLikeByMessage(message: Message): Promise<ExtractUserResult> {
    const user = message.author;
    
    if (!user) {
      throw new Error('Message does not contain a valid user');
    }

    const userLike: UserLike = {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      tag: user.tag,
      avatarUrl: user.displayAvatarURL({ 
        size: this.DEFAULT_AVATAR_SIZE,
        extension: 'png'
      })
    };

    let profilePicturePath: string | undefined;

    if (userLike.avatarUrl) {
      try {
        profilePicturePath = await this.downloadProfilePicture(
          userLike.avatarUrl,
          userLike.id,
          userLike.username
        );
        userLike.profilePicturePath = profilePicturePath;
      } catch (error) {
        console.warn(`Failed to download profile picture for user ${userLike.tag}:`, error);
      }
    }

    return {
      user: userLike,
      profilePicturePath
    };
  }

  private static async downloadProfilePicture(
    avatarUrl: string,
    userId: string,
    username: string
  ): Promise<string> {
    try {
      const response = await fetch(avatarUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      const fileExtension = this.getFileExtensionFromContentType(contentType) || '.png';
      
      const fileName = `${userId}_${username}_${Date.now()}${fileExtension}`;
      const filePath = join(this.PFP_DIR, fileName);

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      await Bun.write(filePath, buffer);
      
      console.log(`Profile picture downloaded: ${filePath}`);
      return filePath;
      
    } catch (error) {
      throw new Error(`Failed to download profile picture: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private static getFileExtensionFromContentType(contentType: string | null): string | null {
    if (!contentType) return null;

    const typeMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp'
    };

    return typeMap[contentType.toLowerCase()] || null;
  }

  public static async cleanupOldProfilePictures(maxAgeHours: number = 24): Promise<void> {
    try {
      const files = await this.getFilesInDirectory(this.PFP_DIR);
      const maxAge = Date.now() - (maxAgeHours * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = join(this.PFP_DIR, file);
        
        try {
          const stats = await Bun.file(filePath).exists();
          if (stats) {
            const fileInfo = await Bun.file(filePath);
            const fileTime = this.extractTimestampFromFilename(file);
            
            if (fileTime && fileTime < maxAge) {
              await this.deleteFile(filePath);
              console.log(`Cleaned up old profile picture: ${filePath}`);
            }
          }
        } catch (error) {
          console.warn(`Error processing file ${filePath}:`, error);
        }
      }
    } catch (error) {
      console.error('Error during profile picture cleanup:', error);
    }
  }

  private static async getFilesInDirectory(dirPath: string): Promise<string[]> {
    try {
      const dir = await Bun.file(dirPath).exists();
      if (!dir) {
        return [];
      }
      
      // Use Bun's glob functionality or filesystem operations
      const files: string[] = [];
      return files;
    } catch (error) {
      console.warn(`Could not read directory ${dirPath}:`, error);
      return [];
    }
  }

  private static extractTimestampFromFilename(filename: string): number | null {
    const match = filename.match(/_(\d{13})\./);
    return match ? parseInt(match[1], 10) : null;
  }

  private static async deleteFile(filePath: string): Promise<void> {
    try {
      await Bun.$`rm ${filePath}`;
    } catch (error) {
      throw new Error(`Failed to delete file ${filePath}: ${error}`);
    }
  }

  public static async deleteProfilePicture(filePath: string): Promise<boolean> {
    try {
      if (!filePath) {
        return false;
      }

      const fileExists = await Bun.file(filePath).exists();
      if (!fileExists) {
        console.log(`Profile picture file does not exist: ${filePath}`);
        return false;
      }

      await this.deleteFile(filePath);
      console.log(`Deleted profile picture: ${filePath}`);
      return true;
    } catch (error) {
      console.error(`Failed to delete profile picture ${filePath}:`, error);
      return false;
    }
  }

  public static isValidImageFormat(filename: string): boolean {
    const ext = extname(filename).toLowerCase();
    return this.SUPPORTED_IMAGE_FORMATS.includes(ext);
  }

  public static generateProfilePictureFilename(userId: string, username: string, extension: string = '.png'): string {
    const timestamp = Date.now();
    const sanitizedUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${userId}_${sanitizedUsername}_${timestamp}${extension}`;
  }
}