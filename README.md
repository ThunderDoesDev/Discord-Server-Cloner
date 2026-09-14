# Discord Server Cloner

Node.js tool that copies a Discord server’s layout onto another server you already belong to. It logs in with a **user token**, then lets you clone live, save a snapshot, restore that snapshot, clone several servers in one run, or wipe a target.

**Use with caution** as this script is designed for Discord server cloning and violates Discord's [Terms of Service](https://discord.com/terms). Never share your token.

## Features

- **Live Copy** — roles, categories, channels, overwrites, emojis, name, and icon
- **Save** — snapshot to JSON plus emoji image files under `ClonedServers/`
- **Load** — restore a snapshot onto an existing server
- **Multi Clone** — clone several source/target pairs in one run
- **Wipe** — delete roles, channels, emojis, and stickers (members stay)
- **Logging** — `Logs/cloner.logs` for the full run, `Logs/error.logs` for failures

Load and live copy can wipe the target first so you do not stack duplicate channels.

## Requirements

- [Node.js](https://nodejs.org/) 20.18 or newer
- A Discord **user** token (bot tokens are not supported)
- The account must already be in every source and target server

## Setup

```bash
git clone https://github.com/ThunderDoesDev/Discord-Server-Cloner.git
cd Discord-Server-Cloner
npm install
```

Copy `Settings/config.example.json` to `Settings/config.json` and put your token in the `token` field:

```json
{
  "token": "YOUR_TOKEN_HERE"
}
```

`Settings/config.json` is gitignored. Do not commit it.

## Usage

```bash
npm start
```

After login:

```text
  ┌────────────────────────────────────────────────────────┐
  │  DISCORD SERVER CLONER                                 │
  │  signed in as username                                 │
  └────────────────────────────────────────────────────────┘

     1  Live Copy     Copy one server onto another
     2  Save          Write a snapshot to JSON
     3  Load          Restore a snapshot onto a server
     4  Multi Clone   Clone several servers at once
     5  Wipe          Clear roles, channels, and emojis
     6  Exit

  ›  Select 1-6:
```

Turn on Developer Mode in Discord (**User Settings → Advanced**), then right-click a server icon and copy its ID when the script asks.

Load needs a server that already exists. Create an empty one in the Discord app first, then paste that ID.

## Commands

| # | Command | What it does |
| --- | --- | --- |
| 1 | **Live Copy** | Copies a source server onto a target. Optional wipe of the target first. |
| 2 | **Save** | Writes `ClonedServers/<server-name>/<server-name>_clone.json` and an `emojis/` folder. |
| 3 | **Load** | Restores a saved snapshot onto a target. Optional wipe first. Accepts this app’s JSON and older Python snapshots that used `colour` / `topic`. |
| 4 | **Multi Clone** | Same as live copy, for matching comma-separated source and target ID lists. |
| 5 | **Wipe** | Deletes channels, unmanaged roles, emojis, and stickers. Asks for confirmation. Members are not kicked. |

## Copied vs skipped

**Copied:** name, icon, `@everyone` permissions, unmanaged roles, categories, text / news / voice channels, role overwrites, emojis.

**Not copied:** messages, members, bans, webhooks, threads, forum channels, stage channels (cloned as voice), stickers, bot roles, or anything the account cannot manage.

Writes are spaced ~800ms apart to stay under rate limits. Large servers take a while.

## Logging

Runs append to `Logs/` and keep older entries:

- `cloner.logs` — login, start/end of each action, per-item progress, retries
- `error.logs` — `ERROR` lines and stack traces only

## Troubleshooting

**Unknown Guild** — the account is not in that server, or the ID is wrong. Join it, wait a few seconds, try again.

**Rate limits** — the script waits between writes and retries downloads. Let it finish.

**Token errors** — use a user token in `Settings/config.json`, not a bot token.

**Failed to create guild / Unknown Message** — this tool does not create servers. Make one in Discord, then use Load with that server’s ID.

## Disclaimer

The creator of this script does not take any responsibility for how the script is used. Use this tool at your own risk. The author is not liable for any consequences or damages, including but not limited to account bans or data loss, that result from using this tool.

## Support

For support, issues, or enhancements, please open an issue in this repository or join our discord support server.

[Join Support Server](https://discord.gg/thunderdoesdev)

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
