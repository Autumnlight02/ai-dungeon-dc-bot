# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Discord bot project designed for AI Dungeon functionality. The bot is built using TypeScript and Bun runtime with discord.js as the primary Discord API library.

## Development Commands

- **Install dependencies**: `bun install`
- **Run the bot**: `bun run index.ts` or `bun index.ts`
- **Run with hot reload**: `bun --hot index.ts`
- **Run tests**: `bun test`

## Project Structure

- `index.ts` - Main bot entry point and initialization
- `src/discord/discord.client.ts` - Discord client setup and event handling
- `src/messages/message.service.ts` - Message processing and logging service
- `package.json` - Project dependencies and configuration
- `tsconfig.json` - TypeScript configuration
- `README.md` - Basic project documentation

## Key Dependencies

- **discord.js v14.21.0** - Discord API library for bot functionality
- **TypeScript** - Type safety and development tooling
- **Bun** - Runtime and package manager

## Development Guidelines

### Bun Runtime Preferences
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of npm/yarn/pnpm
- Bun automatically loads .env files, so don't use dotenv package

### Discord Bot Development
- The project uses discord.js v14, which has specific API patterns and event handling
- Bot functionality should be implemented using discord.js Client class and event listeners
- Consider implementing command handlers, event handlers, and proper error handling for Discord interactions

### Code Organization
- Bot initialization happens in `index.ts`
- Discord client and event setup is in `src/discord/discord.client.ts`
- Message handling logic is in `src/messages/message.service.ts`
- Follow discord.js v14 best practices for slash commands and interactions

### Environment Variables
- `DISCORD_TOKEN` - Required Discord bot token for authentication
