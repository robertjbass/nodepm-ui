# nodepm

[![npm version](https://badge.fury.io/js/nodepm.svg)](https://www.npmjs.com/package/nodepm)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A beautiful terminal UI for managing and monitoring Node.js processes. Find and kill rogue processes, analyze resource usage, and get AI-powered insights.

## Features

- **Interactive Process List** - View all running Node.js processes with CPU, memory, and command details
- **Smart Filtering** - Automatically detects and displays only Node processes
- **Sortable Columns** - Sort by CPU usage or memory consumption
- **Process Management** - Kill processes with confirmation prompts
- **AI Integration** - Get explanations and insights about processes using OpenAI
- **Beautiful Terminal UI** - Clean, colorful interface with keyboard and mouse support

## Installation

Run directly without installation using your preferred package manager:

```bash
# Using pnpm
pnpx nodepm

# Using npm
npx nodepm

# Using bun
bunx nodepm
```

Or install globally:

```bash
# Using pnpm
pnpm add -g nodepm

# Using npm
npm install -g nodepm

# Using bun
bun add -g nodepm

# Then run
nodepm
```

## Usage

```bash
nodepm [options]
```

### Options

- `--all` - Show all processes (not just Node.js processes)
- `--help`, `-h` - Show help message

By default, nodepm only displays Node.js processes. Use the `--all` flag to view all running processes on your system.

### Examples

```bash
# Show only Node.js processes (default)
nodepm

# Show all processes
nodepm --all

# Show help
nodepm --help
```

## Keyboard Shortcuts

### Navigation
- **↑/↓** or **j/k** - Navigate up/down through processes
- **Mouse Click** - Select a process

### Actions
- **Enter** or **k** - Kill selected process (with confirmation)
- **r** - Refresh process list
- **c** - Sort by CPU usage (toggle ascending/descending)
- **m** - Sort by Memory usage (toggle ascending/descending)

### AI Features
- **?** - Explain selected process with AI
- **/** - Ask AI a custom question about your processes

### Other
- **h** - Show this help menu
- **q** or **Esc** - Quit (Ctrl+C/Ctrl+D also work)

## AI Features

Node Process Manager includes optional AI-powered features using OpenAI:

### Process Explanations
Press **?** on any process to get an AI explanation of what it does and whether it's normal.

### Custom Questions
Press **/** to ask AI questions like:
- "Which process is using the most memory?"
- "I've been using Vitest, which processes are related?"
- "Are any of these processes unusual?"

### API Key Setup
On first use of AI features, you'll be prompted to enter your OpenAI API key. The key is saved in your user config directory:
- **Linux/Mac**: `~/.config/nodepm/config.json`
- **Windows**: `%APPDATA%\nodepm\config.json`

You can also set the `OPENAI_API_KEY` environment variable, which takes priority over the config file:
```bash
export OPENAI_API_KEY=your_key_here
```

## Requirements

- Node.js 18.0.0 or higher
- Terminal with ANSI color support

## Use Cases

- **Find Memory Leaks** - Quickly identify Node processes consuming excessive memory
- **Kill Orphaned Processes** - Clean up leftover development servers and build tools
- **Monitor Resource Usage** - Track CPU and memory usage of your Node applications
- **Debug Port Conflicts** - Find which process is using a specific port
- **Team Debugging** - Understand what processes are running during development

## Tips

- The process marked as **(This Process)** is the Node Process Manager itself
- CPU percentages can exceed 100% on multi-core systems (represents total across all cores)
- Use the sort functions (c/m) to quickly find resource-heavy processes
- Refresh (r) to update process information if things change

## License

ISC

## Author

Bob Bass

## Contributing

Issues and pull requests welcome at [github.com/robertjbass/nodepm](https://github.com/robertjbass/nodepm)
