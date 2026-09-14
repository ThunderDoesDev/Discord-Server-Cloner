import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Client, Permissions } = require('discord.js-selfbot-v13');

const TYPE = {
  text: 'GUILD_TEXT',
  voice: 'GUILD_VOICE',
  category: 'GUILD_CATEGORY',
  news: 'GUILD_NEWS',
  stage: 'GUILD_STAGE_VOICE',
  forum: 'GUILD_FORUM',
};

function isType(channel, type) {
  return channel.type === type;
}

function isRoleOverwrite(overwrite) {
  return overwrite.type === 'role' || overwrite.type === 0;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(SCRIPT_DIR, 'Settings', 'config.json');
const LOGS_DIR = join(SCRIPT_DIR, 'Logs');
const CLONER_LOG_FILE = join(LOGS_DIR, 'cloner.logs');
const ERROR_LOG_FILE = join(LOGS_DIR, 'error.logs');
const CLONED_DIR = join(SCRIPT_DIR, 'ClonedServers');
const TOKEN_PLACEHOLDERS = new Set(['', 'YOUR_TOKEN_HERE', 'your-bot-token-here', 'your-user-token-here']);
const WIPE_ICON_URL = 'https://i.imgur.com/ld9MCIx.png';
const WRITE_DELAY_MS = 800;
const BLANK_NAME = '\u1CBC\u1CBC';

mkdirSync(LOGS_DIR, { recursive: true });
const clonerLogStream = createWriteStream(CLONER_LOG_FILE, { flags: 'a', encoding: 'utf8' });
const errorLogStream = createWriteStream(ERROR_LOG_FILE, { flags: 'a', encoding: 'utf8' });

function log(level, message, error) {
  const line = `${new Date().toISOString()} - ${level} - ${message}`;
  const stack = error ? `${error.stack || error}\n` : '';
  clonerLogStream.write(`${line}\n${stack}`);
  if (level === 'ERROR') {
    errorLogStream.write(`${line}\n${stack}`);
    uiError(message);
  }
}

function closeLogs() {
  return Promise.all([
    new Promise((resolve) => clonerLogStream.end(resolve)),
    new Promise((resolve) => errorLogStream.end(resolve)),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'unnamed-server';
}

function toBitField(value) {
  try {
    return new Permissions(BigInt(value ?? 0));
  } catch {
    return new Permissions(0n);
  }
}

function bitfieldToString(bitfield) {
  return (bitfield?.bitfield ?? 0n).toString();
}

function roleCreateColors(source) {
  const colors = source.colors;
  if (colors && typeof colors === 'object' && colors.primaryColor != null) {
    const created = { primaryColor: colors.primaryColor };
    if (colors.secondaryColor) created.secondaryColor = colors.secondaryColor;
    if (colors.tertiaryColor) created.tertiaryColor = colors.tertiaryColor;
    return created;
  }
  return { primaryColor: source.colour ?? source.color ?? 0 };
}

function guildHasFeature(guild, feature) {
  const features = guild?.features;
  if (!features) return false;
  if (typeof features.has === 'function') return features.has(feature);
  if (Array.isArray(features)) return features.includes(feature);
  return false;
}

function clampUserLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 99);
}

const COLOR = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

const MENU_WIDTH = 58;
const MENU_OPTIONS = [
  { key: '1', title: 'Live Copy', hint: 'Copy one server onto another' },
  { key: '2', title: 'Save', hint: 'Write a snapshot to JSON' },
  { key: '3', title: 'Load', hint: 'Restore a snapshot onto a server' },
  { key: '4', title: 'Multi Clone', hint: 'Clone several servers at once' },
  { key: '5', title: 'Wipe', hint: 'Clear roles, channels, and emojis' },
  { key: '6', title: 'Exit', hint: 'Close the cloner' },
];

function paint(code, text) {
  if (!process.stdout.isTTY) return text;
  return `${code}${text}${COLOR.reset}`;
}

function line(char = '─', width = MENU_WIDTH) {
  return char.repeat(width);
}

function uiOk(message) {
  console.log(`  ${paint(COLOR.green, '✔')}  ${message}`);
}

function uiWarn(message) {
  console.log(`  ${paint(COLOR.yellow, '!')}  ${message}`);
}

function uiError(message) {
  console.error(`  ${paint(COLOR.red, '✖')}  ${message}`);
}

function displayMenu(userTag, lastStatus) {
  console.clear();
  const title = 'DISCORD SERVER CLONER';
  const account = userTag ? `signed in as ${userTag}` : 'not signed in';
  const inner = MENU_WIDTH - 4;

  const row = (text, style) => {
    const visible = text.length > inner ? `${text.slice(0, inner - 1)}…` : text;
    const padded = visible + ' '.repeat(inner - visible.length);
    const body = style ? paint(style, visible) + ' '.repeat(inner - visible.length) : padded;
    return paint(COLOR.cyan, '  │') + `  ${body}` + paint(COLOR.cyan, '│');
  };

  console.log('');
  console.log(paint(COLOR.cyan, `  ┌${line('─', MENU_WIDTH - 2)}┐`));
  console.log(row(title, COLOR.bold));
  console.log(row(account, COLOR.dim));
  console.log(paint(COLOR.cyan, `  └${line('─', MENU_WIDTH - 2)}┘`));
  console.log('');

  for (const option of MENU_OPTIONS) {
    const key = paint(COLOR.cyan, option.key.padStart(2));
    const titleText = paint(COLOR.bold, option.title.padEnd(12));
    console.log(`    ${key}  ${titleText}  ${paint(COLOR.dim, option.hint)}`);
  }

  console.log('');
  if (lastStatus) {
    const mark =
      lastStatus.kind === 'ok'
        ? paint(COLOR.green, '✔')
        : lastStatus.kind === 'warn'
          ? paint(COLOR.yellow, '!')
          : paint(COLOR.red, '✖');
    console.log(`  ${mark}  ${lastStatus.message}`);
    console.log('');
  }
}

async function fetchBuffer(url, maxRetries = 3, timeoutMs = 15000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (response.ok) {
        log('DEBUG', `Fetched ${url} (attempt ${attempt}/${maxRetries})`);
        return Buffer.from(await response.arrayBuffer());
      }

      log('WARN', `Fetch failed ${url} status ${response.status} (attempt ${attempt}/${maxRetries})`);
    } catch (error) {
      log('WARN', `Fetch error ${url} (attempt ${attempt}/${maxRetries}): ${error.message}`, error);
    }

    if (attempt < maxRetries) {
      await sleep(2 ** (attempt - 1) * 1000);
    }
  }

  log('ERROR', `Gave up fetching ${url} after ${maxRetries} attempts`);
  return null;
}

function displayTask(title) {
  console.log('');
  console.log(`  ${paint(COLOR.bold, title)}`);
  console.log(`  ${paint(COLOR.dim, line('─', Math.max(title.length, 12)))}`);
  console.log('');
}

function uiBusy(message) {
  console.log(`  ${paint(COLOR.dim, '…')}  ${message}`);
}

class ServerCloner {
  constructor() {
    this.client = new Client();
    this.rl = readline.createInterface({ input, output });
    this.lastStatus = null;
  }

  setStatus(kind, message) {
    this.lastStatus = { kind, message };
  }

  async loadConfig() {
    try {
      const data = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
      const token = typeof data.token === 'string' ? data.token.trim() : '';
      if (!token || TOKEN_PLACEHOLDERS.has(token)) {
        log('ERROR', `Set your user token in ${CONFIG_PATH}`);
        return null;
      }
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        log('ERROR', `Missing ${CONFIG_PATH}. Copy Settings/config.example.json to Settings/config.json and add your user token.`);
      } else {
        log('ERROR', `Could not read ${CONFIG_PATH}: ${error.message}`, error);
      }
      return null;
    }
  }

  async start() {
    const config = await this.loadConfig();
    const token = config?.token;
    if (!token) {
      this.rl.close();
      process.exit(1);
    }

    await mkdir(CLONED_DIR, { recursive: true });

    this.client.once('ready', async () => {
      log('INFO', `Logged in as ${this.client.user.tag}`);
      await this.mainMenu();
    });

    this.client.on('error', (error) => {
      log('ERROR', `Discord client error: ${error.message}`, error);
    });

    try {
      await this.client.login(token);
    } catch (error) {
      log('ERROR', `Login failed: ${error.message}`, error);
      this.setStatus('error', 'Login failed. Check the token in Settings/config.json.');
      await this.shutdown();
      process.exit(1);
    }
  }

  async shutdown() {
    this.rl.close();
    if (this.client.isReady()) {
      await this.client.destroy();
    }
    await closeLogs();
  }

  async mainMenu() {
    while (true) {
      displayMenu(this.client.user?.tag, this.lastStatus);
      const choice = await this.ask('Select 1-6', ['1', '2', '3', '4', '5', '6']);
      if (choice === '6') {
        console.log('');
        uiBusy('Closing');
        log('INFO', 'User exited');
        await this.shutdown();
        process.exit(0);
      }
      const selected = MENU_OPTIONS.find((option) => option.key === choice);
      console.clear();
      displayTask(selected?.title || 'Action');
      await this.route(choice);
    }
  }

  async route(choice) {
    const actions = {
      1: () => this.liveCopy(),
      2: () => this.serverSave(),
      3: () => this.serverLoad(),
      4: () => this.multiServerClone(),
      5: () => this.serverWipe(),
    };

    try {
      await actions[choice]();
    } catch (error) {
      log('ERROR', `Action ${choice} failed: ${error.message}`, error);
      this.setStatus('error', `Operation failed: ${error.message}`);
    }
  }

  async ask(prompt, validChoices) {
    while (true) {
      const label = /[:?]$/.test(prompt.trim()) ? prompt.trim() : `${prompt.trim()}:`;
      const answer = (await this.rl.question(`${paint(COLOR.cyan, '  ›')}  ${label} `)).trim();
      if (!validChoices || validChoices.includes(answer)) {
        return answer;
      }
      uiWarn(`Choose ${validChoices.join(', ')}`);
    }
  }

  async askYesNo(prompt) {
    const answer = (await this.ask(`${prompt} [y/n]`)).toLowerCase();
    return answer === 'y' || answer === 'yes';
  }

  parseIds(raw) {
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  async getGuild(label) {
    const id = await this.ask(label);
    const guild = await this.resolveGuild(id);
    if (!guild) {
      this.setStatus('warn', `Guild ${id} was not found. Join that server on this account and try again.`);
      uiWarn(`Guild ${id} was not found. Join that server on this account and try again.`);
    }
    return guild;
  }

  async resolveGuild(id) {
    try {
      const guild = this.client.guilds.cache.get(id) ?? (await this.client.guilds.fetch(id));
      await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.emojis.fetch()]);
      return guild;
    } catch (error) {
      log('WARN', `Could not resolve guild ${id}: ${error.message}`, error);
      return null;
    }
  }

  async liveCopy() {
    log('INFO', 'Starting live copy');
    const source = await this.getGuild('Source Guild ID');
    const target = await this.getGuild('Target Guild ID');
    if (!source || !target) return;

    if (source.id === target.id) {
      this.setStatus('warn', 'Source and target must be different servers.');
      uiWarn('Source and target must be different servers.');
      return;
    }

    const wipeFirst = await this.askYesNo('Wipe the target server before copying?');
    if (wipeFirst) {
      uiBusy('Wiping target');
      await this.wipeGuild(target, { resetIdentity: false });
    }

    uiBusy(`Copying ${source.name}`);
    await this.cloneGuild(source, target);
    this.setStatus('ok', `Copied "${source.name}" onto "${target.name}"`);
    uiOk(`Copied "${source.name}" onto "${target.name}"`);
  }

  async serverSave() {
    log('INFO', 'Starting server save');
    const guild = await this.getGuild('Source Guild ID');
    if (!guild) return;
    uiBusy(`Saving ${guild.name}`);
    const path = await this.saveGuildData(guild);
    if (path) {
      this.setStatus('ok', `Saved snapshot for "${guild.name}"`);
      uiOk(`Saved ${path}`);
    }
  }

  async serverLoad() {
    log('INFO', 'Starting server load');
    const jsonPath = await this.chooseJsonFile();
    if (!jsonPath) return;

    const target = await this.getGuild('Target Guild ID');
    if (!target) return;

    const wipeFirst = await this.askYesNo('Wipe the target server before loading?');
    if (wipeFirst) {
      uiBusy('Wiping target');
      await this.wipeGuild(target, { resetIdentity: false });
    }

    uiBusy(`Loading onto ${target.name}`);
    await this.loadGuildData(jsonPath, target);
    this.setStatus('ok', `Loaded snapshot onto "${target.name}"`);
    uiOk(`Loaded snapshot onto "${target.name}"`);
  }

  async multiServerClone() {
    log('INFO', 'Starting multi-server clone');
    const sourceIds = this.parseIds(await this.ask('Source Guild IDs, comma-separated'));
    const targetIds = this.parseIds(await this.ask('Target Guild IDs, comma-separated'));

    if (!sourceIds.length || !targetIds.length) {
      this.setStatus('warn', 'No source or target IDs provided');
      uiWarn('No source or target IDs provided');
      return;
    }
    if (sourceIds.length !== targetIds.length) {
      this.setStatus('warn', 'Source and target ID counts must match');
      uiWarn('Source and target ID counts must match');
      return;
    }

    const wipeFirst = await this.askYesNo('Wipe each target server before copying?');
    let copied = 0;

    for (let i = 0; i < sourceIds.length; i++) {
      const source = await this.resolveGuild(sourceIds[i]);
      const target = await this.resolveGuild(targetIds[i]);
      if (!source || !target) {
        uiWarn(`Skipping ${sourceIds[i]} -> ${targetIds[i]}`);
        continue;
      }
      if (wipeFirst) {
        uiBusy(`Wiping ${target.name}`);
        await this.wipeGuild(target, { resetIdentity: false });
      }
      uiBusy(`Copying ${source.name}`);
      await this.cloneGuild(source, target);
      copied += 1;
      uiOk(`Copied "${source.name}" onto "${target.name}"`);
    }
    this.setStatus(copied ? 'ok' : 'warn', `Finished multi clone (${copied}/${sourceIds.length})`);
  }

  async serverWipe() {
    log('INFO', 'Starting server wipe');
    const guild = await this.getGuild('Target Guild ID');
    if (!guild) return;

    const confirmed = await this.askYesNo(
      `Delete roles, channels, emojis, and stickers in "${guild.name}"?`,
    );
    if (!confirmed) {
      this.setStatus('warn', 'Wipe cancelled');
      uiWarn('Wipe cancelled');
      return;
    }

    uiBusy(`Wiping ${guild.name}`);
    await this.wipeGuild(guild, { resetIdentity: true });
    this.setStatus('ok', `Wiped "${guild.name}"`);
    uiOk(`Wiped "${guild.name}"`);
  }

  async cloneGuild(source, target) {
    log('INFO', `Cloning ${source.name} (${source.id}) -> ${target.name} (${target.id})`);
    await this.applyDefaultRole(target, source.roles.everyone.permissions);
    const roleMap = await this.cloneRoles(source, target);
    await this.cloneChannels(source, target, roleMap);
    await this.cloneEmojis(source, target);
    await this.applyGuildIdentity(target, {
      name: source.name,
      iconURL: source.iconURL({ format: 'png', size: 4096 }),
    });
    log('INFO', `Finished cloning ${source.name} -> ${target.name}`);
  }

  async cloneRoles(source, target) {
    const roleMap = new Map();
    const roles = [...source.roles.cache.values()]
      .filter((role) => role.id !== source.id && !role.managed)
      .sort((a, b) => b.position - a.position);

    log('INFO', `Cloning ${roles.length} roles`);
    for (const [index, role] of roles.entries()) {
      try {
        const created = await target.roles.create({
          name: role.name,
          permissions: role.permissions,
          colors: roleCreateColors(role),
          hoist: role.hoist,
          mentionable: role.mentionable,
          reason: 'Server clone',
        });
        roleMap.set(role.id, created);
        log('DEBUG', `[roles] ${index + 1}/${roles.length} ${role.name}`);
        await sleep(WRITE_DELAY_MS);
      } catch (error) {
        log('ERROR', `Failed to clone role ${role.name}: ${error.message}`, error);
      }
    }
    return roleMap;
  }

  async loadRoles(rolesData, guild) {
    const roleMap = new Map();
    const roles = [...rolesData].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

    log('INFO', `Loading ${roles.length} roles`);
    for (const role of roles) {
      try {
        const created = await guild.roles.create({
          name: role.name,
          permissions: toBitField(role.permissions),
          colors: roleCreateColors(role),
          hoist: Boolean(role.hoist),
          mentionable: Boolean(role.mentionable),
          reason: 'Server load',
        });
        roleMap.set(String(role.id), created);
        await sleep(WRITE_DELAY_MS);
      } catch (error) {
        log('ERROR', `Failed to load role ${role.name}: ${error.message}`, error);
      }
    }
    return roleMap;
  }

  mapOverwritesFromChannel(channel, roleMap, targetGuild) {
    const overwrites = [];
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (!isRoleOverwrite(overwrite)) continue;

      let targetId = null;
      if (overwrite.id === channel.guild.id) {
        targetId = targetGuild.id;
      } else if (roleMap.has(overwrite.id)) {
        targetId = roleMap.get(overwrite.id).id;
      }
      if (!targetId) continue;

      overwrites.push({
        id: targetId,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
      });
    }
    return overwrites;
  }

  mapOverwritesFromData(overwritesData, guild, roleMap) {
    const overwrites = [];
    if (!overwritesData) return overwrites;

    if (overwritesData.default) {
      overwrites.push({
        id: guild.id,
        allow: toBitField(overwritesData.default.allow).bitfield,
        deny: toBitField(overwritesData.default.deny).bitfield,
      });
    }

    for (const [roleId, permissions] of Object.entries(overwritesData.roles || {})) {
      const mapped = roleMap.get(String(roleId));
      if (!mapped) continue;
      overwrites.push({
        id: mapped.id,
        allow: toBitField(permissions.allow).bitfield,
        deny: toBitField(permissions.deny).bitfield,
      });
    }

    return overwrites;
  }

  channelCreateOptions(channel, parent, overwrites) {
    const options = {
      name: channel.name,
      parent: parent?.id,
      permissionOverwrites: overwrites,
      reason: 'Server clone',
    };

    if (isType(channel, TYPE.voice) || isType(channel, TYPE.stage)) {
      options.type = TYPE.voice;
      options.bitrate = Math.min(channel.bitrate || 64000, 96000);
      options.userLimit = clampUserLimit(channel.userLimit);
      return options;
    }

    options.type = isType(channel, TYPE.news) ? TYPE.news : TYPE.text;
    options.topic = channel.topic || undefined;
    options.nsfw = Boolean(channel.nsfw);
    options.rateLimitPerUser = channel.rateLimitPerUser || 0;
    return options;
  }

  async createChannelSafe(guild, options) {
    const { name, ...rest } = options;
    if (rest.type === TYPE.news && !guildHasFeature(guild, 'COMMUNITY')) {
      rest.type = TYPE.text;
    }
    if (rest.userLimit != null) {
      rest.userLimit = clampUserLimit(rest.userLimit);
    }

    try {
      return await guild.channels.create(name, rest);
    } catch (error) {
      let lastError = error;
      const message = String(lastError.message || '');

      if (rest.type === TYPE.news) {
        log('WARN', `Creating ${name} as text instead of announcement: ${message}`);
        rest.type = TYPE.text;
        try {
          return await guild.channels.create(name, rest);
        } catch (retryError) {
          lastError = retryError;
        }
      }

      if (rest.bitrate) {
        log('WARN', `Retrying channel ${name} without bitrate: ${lastError.message}`);
        delete rest.bitrate;
        try {
          return await guild.channels.create(name, rest);
        } catch (retryError) {
          lastError = retryError;
        }
      }

      throw lastError;
    }
  }

  async cloneChannels(source, target, roleMap) {
    const categories = [...source.channels.cache.values()]
      .filter((channel) => isType(channel, TYPE.category))
      .sort((a, b) => a.rawPosition - b.rawPosition);

    log('INFO', `Cloning ${categories.length} categories`);

    for (const category of categories) {
      try {
        const createdCategory = await target.channels.create(category.name, {
          type: TYPE.category,
          permissionOverwrites: this.mapOverwritesFromChannel(category, roleMap, target),
          reason: 'Server clone',
        });
        await sleep(WRITE_DELAY_MS);

        const children = [...category.children.values()].sort(
          (a, b) => a.rawPosition - b.rawPosition,
        );
        for (const child of children) {
          if (isType(child, TYPE.forum)) continue;
          try {
            await this.createChannelSafe(
              target,
              this.channelCreateOptions(
                child,
                createdCategory,
                this.mapOverwritesFromChannel(child, roleMap, target),
              ),
            );
            await sleep(WRITE_DELAY_MS);
          } catch (error) {
            log('ERROR', `Failed to clone channel ${child.name}: ${error.message}`, error);
          }
        }
      } catch (error) {
        log('ERROR', `Failed to clone category ${category.name}: ${error.message}`, error);
      }
    }

    const uncategorized = [...source.channels.cache.values()].filter(
      (channel) =>
        !channel.parentId &&
        !isType(channel, TYPE.category) &&
        !isType(channel, TYPE.forum),
    );

    for (const channel of uncategorized) {
      try {
        await this.createChannelSafe(
          target,
          this.channelCreateOptions(
            channel,
            null,
            this.mapOverwritesFromChannel(channel, roleMap, target),
          ),
        );
        await sleep(WRITE_DELAY_MS);
      } catch (error) {
        log('ERROR', `Failed to clone uncategorized channel ${channel.name}: ${error.message}`, error);
      }
    }
  }

  async loadChannels(categoriesData, guild, roleMap) {
    log('INFO', `Loading ${categoriesData.length} categories`);
    for (const categoryData of categoriesData) {
      try {
        const createdCategory = await guild.channels.create(categoryData.name, {
          type: TYPE.category,
          permissionOverwrites: this.mapOverwritesFromData(categoryData.overwrites, guild, roleMap),
          reason: 'Server load',
        });
        await sleep(WRITE_DELAY_MS);

        for (const channelData of categoryData.channels || []) {
          await this.loadOneChannel(guild, createdCategory, channelData, roleMap);
        }
      } catch (error) {
        log('ERROR', `Failed to load category ${categoryData.name}: ${error.message}`, error);
      }
    }
  }

  async loadUncategorized(channelsData, guild, roleMap) {
    for (const channelData of channelsData || []) {
      await this.loadOneChannel(guild, null, channelData, roleMap);
    }
  }

  async loadOneChannel(guild, parent, channelData, roleMap) {
    const type = this.inferChannelType(channelData);
    const overwrites = this.mapOverwritesFromData(channelData.overwrites, guild, roleMap);
    const options = {
      name: channelData.name,
      parent: parent?.id,
      permissionOverwrites: overwrites,
      reason: 'Server load',
    };

    if (type === 'voice') {
      options.type = TYPE.voice;
      if (channelData.bitrate) options.bitrate = Math.min(channelData.bitrate, 96000);
      if (channelData.user_limit != null) options.userLimit = clampUserLimit(channelData.user_limit);
    } else {
      options.type = type === 'announcement' ? TYPE.news : TYPE.text;
      options.topic = channelData.topic || undefined;
      options.nsfw = Boolean(channelData.nsfw);
      if (channelData.rate_limit_per_user != null) {
        options.rateLimitPerUser = channelData.rate_limit_per_user;
      }
    }

    try {
      await this.createChannelSafe(guild, options);
      await sleep(WRITE_DELAY_MS);
    } catch (error) {
      log('ERROR', `Failed to load channel ${channelData.name}: ${error.message}`, error);
    }
  }

  inferChannelType(channelData) {
    if (channelData.type) return channelData.type;
    return Object.prototype.hasOwnProperty.call(channelData, 'topic') ? 'text' : 'voice';
  }

  async cloneEmojis(source, target) {
    const emojis = [...source.emojis.cache.values()];
    log('INFO', `Cloning ${emojis.length} emojis`);

    for (const emoji of emojis) {
      try {
        const buffer = await fetchBuffer(emoji.url);
        if (!buffer) continue;
        await target.emojis.create(buffer, emoji.name, {
          reason: 'Server clone',
        });
        await sleep(WRITE_DELAY_MS);
      } catch (error) {
        log('ERROR', `Failed to clone emoji ${emoji.name}: ${error.message}`, error);
      }
    }
  }

  async applyDefaultRole(guild, permissions) {
    try {
      await guild.roles.everyone.setPermissions(permissions, 'Server clone');
      log('INFO', `Updated @everyone permissions for ${guild.name}`);
    } catch (error) {
      log('ERROR', `Failed to update @everyone: ${error.message}`, error);
    }
  }

  async applyGuildIdentity(guild, { name, iconURL }) {
    const payload = {};
    if (name) payload.name = name;

    if (iconURL) {
      const icon = await fetchBuffer(iconURL);
      if (icon) payload.icon = icon;
    }

    if (!Object.keys(payload).length) return;

    try {
      await guild.edit(payload);
      log('INFO', `Updated identity for ${guild.id} to "${name || guild.name}"`);
    } catch (error) {
      log('ERROR', `Failed to set name/icon for ${guild.id}: ${error.message}`, error);
    }
  }

  async wipeGuild(guild, { resetIdentity }) {
    log('INFO', `Wiping ${guild.name} (${guild.id})`);

    const channels = [...guild.channels.cache.values()].sort((a, b) => {
      const aCat = isType(a, TYPE.category) ? 1 : 0;
      const bCat = isType(b, TYPE.category) ? 1 : 0;
      return aCat - bCat;
    });

    await this.deleteEntities(channels, 'channel');

    const roles = [...guild.roles.cache.values()].filter(
      (role) => role.id !== guild.id && !role.managed,
    );
    await this.deleteEntities(roles, 'role');

    const emojis = [...guild.emojis.cache.values()];
    await this.deleteEntities(emojis, 'emoji');

    try {
      const stickers = await guild.stickers.fetch();
      await this.deleteEntities([...stickers.values()], 'sticker');
    } catch (error) {
      log('WARN', `Could not wipe stickers: ${error.message}`, error);
    }

    if (resetIdentity) {
      await this.resetGuildIdentity(guild);
    }
    log('INFO', `Wipe finished for ${guild.name}`);
  }

  async deleteEntities(entities, type) {
    log('INFO', `Deleting ${entities.length} ${type}(s)`);
    for (const entity of entities) {
      try {
        await entity.delete('Server wipe');
        await sleep(WRITE_DELAY_MS);
      } catch (error) {
        log('ERROR', `Failed to delete ${type} ${entity.name || entity.id}: ${error.message}`, error);
      }
    }
  }

  async resetGuildIdentity(guild) {
    const icon = await fetchBuffer(WIPE_ICON_URL);
    const payload = {
      name: BLANK_NAME,
      icon: icon ?? null,
      verificationLevel: 'NONE',
      defaultMessageNotifications: 'ALL_MESSAGES',
      explicitContentFilter: 'DISABLED',
      afkChannel: null,
      systemChannel: null,
    };

    try {
      await guild.edit(payload);
      log('INFO', `Reset identity for ${guild.id}`);
    } catch (error) {
      log('ERROR', `Failed to reset guild identity: ${error.message}`, error);
    }
  }

  serializeOverwrites(channel, guild) {
    const overwrites = {};
    const everyone = channel.permissionOverwrites.cache.get(guild.id);
    if (everyone) {
      overwrites.default = {
        allow: bitfieldToString(everyone.allow),
        deny: bitfieldToString(everyone.deny),
      };
    }

    const roles = {};
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (!isRoleOverwrite(overwrite) || overwrite.id === guild.id) continue;
      roles[overwrite.id] = {
        allow: bitfieldToString(overwrite.allow),
        deny: bitfieldToString(overwrite.deny),
      };
    }
    if (Object.keys(roles).length) {
      overwrites.roles = roles;
    }
    return overwrites;
  }

  serializeChannel(channel, guild) {
    const isVoice = isType(channel, TYPE.voice) || isType(channel, TYPE.stage);
    const data = {
      name: channel.name,
      type: isVoice ? 'voice' : isType(channel, TYPE.news) ? 'announcement' : 'text',
      overwrites: this.serializeOverwrites(channel, guild),
    };

    if (isVoice) {
      data.bitrate = channel.bitrate;
      data.user_limit = channel.userLimit;
    } else {
      data.topic = channel.topic;
      data.nsfw = Boolean(channel.nsfw);
      data.rate_limit_per_user = channel.rateLimitPerUser;
    }
    return data;
  }

  collectGuildData(guild) {
    const categories = [...guild.channels.cache.values()]
      .filter((channel) => isType(channel, TYPE.category))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((category) => ({
        name: category.name,
        overwrites: this.serializeOverwrites(category, guild),
        channels: [...category.children.values()]
          .filter((channel) => !isType(channel, TYPE.forum))
          .sort((a, b) => a.rawPosition - b.rawPosition)
          .map((channel) => this.serializeChannel(channel, guild)),
      }));

    const uncategorized = [...guild.channels.cache.values()]
      .filter(
        (channel) =>
          !channel.parentId &&
          !isType(channel, TYPE.category) &&
          !isType(channel, TYPE.forum),
      )
      .map((channel) => this.serializeChannel(channel, guild));

    const roles = [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id && !role.managed)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        permissions: bitfieldToString(role.permissions),
        colour: role.color,
        colors: roleCreateColors(role),
        hoist: role.hoist,
        mentionable: role.mentionable,
        position: role.position,
      }));

    return {
      name: guild.name,
      icon_url: guild.iconURL({ format: 'png', size: 4096 }),
      default_role: {
        permissions: bitfieldToString(guild.roles.everyone.permissions),
      },
      roles,
      emojis: [],
      channels: {
        categories,
        uncategorized,
      },
    };
  }

  async saveGuildData(guild) {
    const folderName = sanitizeFilename(guild.name);
    const serverDir = join(CLONED_DIR, folderName);
    const emojisDir = join(serverDir, 'emojis');
    await mkdir(emojisDir, { recursive: true });

    const data = this.collectGuildData(guild);
    const emojis = [...guild.emojis.cache.values()];
    log('INFO', `Saving ${emojis.length} emojis for ${guild.name}`);

    for (const emoji of emojis) {
      try {
        const url = emoji.url;
        const extension = extname(new URL(url).pathname) || (emoji.animated ? '.gif' : '.png');
        const filename = `${sanitizeFilename(emoji.name)}${extension}`;
        const buffer = await fetchBuffer(url);
        if (!buffer) continue;
        await writeFile(join(emojisDir, filename), buffer);
        data.emojis.push({ name: emoji.name, filename });
      } catch (error) {
        log('ERROR', `Failed to save emoji ${emoji.name}: ${error.message}`, error);
      }
    }

    const jsonPath = join(serverDir, `${folderName}_clone.json`);
    await writeFile(jsonPath, JSON.stringify(data, null, 4), 'utf8');
    log('INFO', `Saved data to ${jsonPath}`);
    return jsonPath;
  }

  async chooseJsonFile() {
    const entries = existsSync(CLONED_DIR) ? await readdir(CLONED_DIR) : [];
    const serverDirs = [];

    for (const entry of entries) {
      const full = join(CLONED_DIR, entry);
      const info = await stat(full);
      if (!info.isDirectory()) continue;
      const files = (await readdir(full)).filter((file) => file.endsWith('.json'));
      if (files.length) {
        serverDirs.push({ name: entry, json: join(full, files[0]) });
      }
    }

    if (!serverDirs.length) {
      this.setStatus('warn', 'No saved servers found in ClonedServers');
      uiWarn('No saved servers found in ClonedServers');
      return null;
    }

    console.log(`  ${paint(COLOR.dim, 'Saved servers')}`);
    serverDirs.forEach((dir, index) => {
      console.log(`    ${paint(COLOR.cyan, String(index + 1).padStart(2))}  ${dir.name}`);
    });
    console.log('');

    const choice = await this.ask('Server number');
    const selected = serverDirs[Number(choice) - 1];
    if (!selected) {
      this.setStatus('warn', 'Invalid server choice');
      uiWarn('Invalid server choice');
      return null;
    }
    return selected.json;
  }

  async loadGuildData(jsonPath, guild) {
    log('INFO', `Loading ${jsonPath} onto ${guild.name} (${guild.id})`);
    let data;
    try {
      data = JSON.parse(await readFile(jsonPath, 'utf8'));
    } catch (error) {
      log('ERROR', `Could not read ${jsonPath}: ${error.message}`, error);
      this.setStatus('error', 'Could not read the selected JSON file');
      return;
    }

    const emojisDir = join(dirname(jsonPath), 'emojis');
    for (const emoji of data.emojis || []) {
      try {
        const image = await readFile(join(emojisDir, emoji.filename));
        await guild.emojis.create(image, emoji.name, {
          reason: 'Server load',
        });
        await sleep(WRITE_DELAY_MS);
      } catch (error) {
        log('ERROR', `Failed to load emoji ${emoji.name}: ${error.message}`, error);
      }
    }

    if (data.default_role?.permissions != null) {
      await this.applyDefaultRole(guild, toBitField(data.default_role.permissions));
    }

    const roleMap = await this.loadRoles(data.roles || [], guild);
    await this.loadChannels(data.channels?.categories || [], guild, roleMap);
    await this.loadUncategorized(data.channels?.uncategorized || [], guild, roleMap);
    await this.applyGuildIdentity(guild, {
      name: data.name,
      iconURL: data.icon_url,
    });
    log('INFO', `Finished loading onto ${guild.name}`);
  }
}

const cloner = new ServerCloner();

process.on('SIGINT', async () => {
  console.log('');
  uiBusy('Closing');
  await cloner.shutdown();
  process.exit(0);
});

cloner.start();
