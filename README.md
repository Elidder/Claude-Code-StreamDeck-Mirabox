# Claude Code StreamDeck (Mirabox)

Launch [Claude Code](https://claude.com/claude-code) with one key on a Mirabox / AJAZZ Stream Dock
(e.g. AKP153R).

## Stream Dock plugin — `com.claudecode.streamdeck.sdPlugin`

A key opens Claude Code in a project folder:

- **Chat** — pick any chat by its name (rename chats with `/rename`); the folder is filled in for you.
- **Mode** — pinned chat (`--resume <id>`), latest chat (`--continue`), Claude Code's own chat picker
  (`--resume`), or a new chat.
- **Terminal** — Windows Terminal, cmd, or any PowerShell found on the PC (versions are detected;
  opens as a Windows Terminal tab with that PowerShell's profile).
- Key title shows the pinned chat's name.
- English and Russian UI — follows Stream Dock's language.

## Install (Windows)

Requires the Mirabox / AJAZZ Stream Dock app and [Claude Code](https://claude.com/claude-code).

Run in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Elidder/Claude-Code-StreamDeck-Mirabox/main/install.ps1 | iex
```

The installer downloads the latest release, puts the plugin into Stream Dock's plugins folder and
restarts Stream Dock. Then drag **Claude Code** onto a key.

Manual install: download `Claude-Code-StreamDeck-Mirabox.zip` from [Releases](../../releases) and
extract it into `%APPDATA%\HotSpot\StreamDock\plugins\`.

Set `CCSD_CLAUDE` to the full path of `claude` if it is installed somewhere unusual.

From source: copy (or link) the folder into the plugins folder, run `npm install` in `plugin\`,
restart Stream Dock.
