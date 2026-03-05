# tabby-sysmon

System monitoring panel for [Tabby Terminal](https://tabby.sh). Displays real-time hardware metrics for local machine and remote servers over SSH.

## Features

- **CPU** — usage percentage, per-core breakdown
- **RAM** — used / total, usage percentage
- **Disk** — used / total per mount point
- **Network** — upload / download speeds (delta-based)
- **TCP Connections** — active connection count
- **Local monitoring** via `systeminformation`
- **Remote monitoring** via SSH — supports Linux and Windows servers
- Collapsible bottom panel with drag-to-resize
- Automatic SSH session detection and switching

## Requirements

- Tabby Terminal v1.0.230 or later

## Installation

### From npm

```bash
cd ~/.config/tabby/plugins   # Linux
cd ~/Library/Application\ Support/tabby/plugins   # macOS
cd %APPDATA%\tabby\plugins   # Windows
npm install tabby-sysmon
```

### From source

```bash
git clone https://github.com/Zigrane/tabby-sysmon.git
cd tabby-sysmon
npm install
npm run build
```

Then copy `package.json` and `dist/` to your Tabby plugins directory:

```
<tabby-plugins>/node_modules/tabby-sysmon/
├── package.json
└── dist/
    └── index.js
```

Restart Tabby after installation.

## Configuration

Open Settings → Plugins → tabby-sysmon to configure:

- Panel position and default height
- Polling intervals (metrics and connections)
- Visible sections (CPU, RAM, Disk, Network, TCP)
- Collapsed state on startup

## Screenshot

![tabby-sysmon panel](https://raw.githubusercontent.com/Zigrane/tabby-sysmon/master/assets/screenshot.png)

## What gets published where

### GitHub — full source (29 files)

```
.gitignore, .npmignore, LICENSE, README.md
package.json, package-lock.json
tsconfig.json, webpack.config.mjs
src/
├── index.ts
├── interfaces/          (metrics.ts, ssh-session.ts)
├── services/            (7 services)
├── components/sidebar/  (.ts, .pug, .scss)
├── components/settings/ (.ts, .pug, .scss)
└── utils/               (format.ts, parse-linux-stats.ts, parse-windows-stats.ts)
```

### npm — runtime only (4 files, ~27 kB packed)

```
LICENSE
README.md
package.json
dist/index.js      (123 kB, webpack UMD bundle)
```

Source code, configs, and lock file are excluded via `.npmignore`.

## Author

[Zigrane](https://github.com/Zigrane)

## License

[MIT](LICENSE)
