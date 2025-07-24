import { UserUtils } from '../utils/user.utils';

export class AvatarCleanupService {
  private static pendingCleanups = new Map<string, number>(); // filePath -> reference count
  private static cleanupTimeouts = new Map<string, NodeJS.Timeout>(); // filePath -> timeout

  public static addReference(filePath?: string): void {
    if (!filePath) return;
    
    const currentCount = this.pendingCleanups.get(filePath) || 0;
    this.pendingCleanups.set(filePath, currentCount + 1);
    
    // Cancel any existing cleanup timeout for this file
    const existingTimeout = this.cleanupTimeouts.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.cleanupTimeouts.delete(filePath);
    }
    
    console.log(`Added reference for ${filePath} (count: ${currentCount + 1})`);
  }

  public static async removeReference(filePath?: string): Promise<void> {
    if (!filePath) return;
    
    const currentCount = this.pendingCleanups.get(filePath) || 0;
    const newCount = Math.max(0, currentCount - 1);
    
    if (newCount === 0) {
      // No more references, schedule cleanup
      this.pendingCleanups.delete(filePath);
      
      // Schedule cleanup with a small delay to handle race conditions
      const timeout = setTimeout(async () => {
        try {
          await UserUtils.deleteProfilePicture(filePath);
          this.cleanupTimeouts.delete(filePath);
          console.log(`Cleaned up avatar file: ${filePath}`);
        } catch (error) {
          console.warn(`Failed to cleanup avatar file ${filePath}:`, error);
        }
      }, 1000); // 1 second delay
      
      this.cleanupTimeouts.set(filePath, timeout);
      console.log(`Scheduled cleanup for ${filePath}`);
    } else {
      this.pendingCleanups.set(filePath, newCount);
      console.log(`Removed reference for ${filePath} (count: ${newCount})`);
    }
  }

  public static async forceCleanup(filePath: string): Promise<boolean> {
    // Cancel any pending cleanup
    const existingTimeout = this.cleanupTimeouts.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.cleanupTimeouts.delete(filePath);
    }
    
    // Remove from pending cleanup tracking
    this.pendingCleanups.delete(filePath);
    
    // Immediately delete the file
    try {
      return await UserUtils.deleteProfilePicture(filePath);
    } catch (error) {
      console.error(`Force cleanup failed for ${filePath}:`, error);
      return false;
    }
  }

  public static getCleanupStats(): {
    pendingFiles: number;
    scheduledCleanups: number;
    files: string[];
  } {
    return {
      pendingFiles: this.pendingCleanups.size,
      scheduledCleanups: this.cleanupTimeouts.size,
      files: Array.from(this.pendingCleanups.keys())
    };
  }

  public static async cleanupAll(): Promise<void> {
    console.log('Performing emergency cleanup of all tracked avatar files...');
    
    // Clear all timeouts
    for (const timeout of this.cleanupTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.cleanupTimeouts.clear();
    
    // Delete all tracked files
    const cleanupPromises = Array.from(this.pendingCleanups.keys()).map(
      filePath => UserUtils.deleteProfilePicture(filePath)
    );
    
    await Promise.allSettled(cleanupPromises);
    this.pendingCleanups.clear();
    
    console.log('Emergency cleanup completed');
  }
}