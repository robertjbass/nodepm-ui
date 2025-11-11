# nodepm-ui

[![npm version](https://badge.fury.io/js/nodepm-ui.svg)](https://www.npmjs.com/package/nodepm-ui)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A beautiful terminal UI for managing and monitoring Node.js processes. Find and kill rogue processes, analyze resource usage, and get AI-powered insights.

## Features

- **Interactive Process List** - View all running Node.js processes with CPU, memory, and command details
- **Smart Filtering** - Automatically detects and displays only Node processes (or use `--all` to show all processes)
- **Fuzzy Search** - Press Ctrl+F to filter processes in real-time with fuzzy matching
- **Sortable Columns** - Sort by CPU usage, memory consumption, or process name with 's' key (arrows shown in column headers)
- **Clipboard Support** - Copy process information to clipboard with Ctrl+C (Mac) / Ctrl+Shift+C (Windows/Linux)
- **Process Management** - Kill processes with confirmation prompts
- **AI Integration** - Get explanations and insights about processes using OpenAI
- **Beautiful Terminal UI** - Clean, colorful interface with keyboard and mouse support

## Installation

Run directly without installation using your preferred package manager:

```bash
# Using pnpm
pnpx nodepm-ui

# Using npm
npx nodepm-ui

# Using bun
bunx nodepm-ui
```

Or install globally:

```bash
# Using pnpm
pnpm add -g nodepm-ui

# Using npm
npm install -g nodepm-ui

# Using bun
bun add -g nodepm-ui

# Then run
nodepm-ui
```

## Usage

```bash
nodepm-ui [options]
```

### Options

- `--all` - Show all processes (not just Node.js processes)
- `--help`, `-h` - Show help message

By default, nodepm-ui only displays Node.js processes. Use the `--all` flag to view all running processes on your system.

### Examples

```bash
# Show only Node.js processes (default)
nodepm-ui

# Show all processes
nodepm-ui --all

# Show help
nodepm-ui --help
```

## Keyboard Shortcuts

This section provides a comprehensive reference for all keyboard shortcuts in nodepm-ui.

### Running the Key Bindings Checker

To check for key conflicts and view the full mapping:

```bash
pnpm check-keys
```

### Key Modifier Legend

- **C-** : Ctrl key (works on all platforms)
- **M-** : Meta/Alt key (Alt/Option on all platforms including Mac)
- **[no modal]** : Only works when no modal window is open
- **[not filtering]** : Only works when not in filter mode

### Complete Key Bindings Map

#### Exit/Quit

| Key(s) | Action | Description | Constraints |
|--------|--------|-------------|-------------|
| `Ctrl+D` | exit | Force quit the application | - |
| `Ctrl+C` | exit | Exit the application (Windows/Linux only) | - |
| `q`, `Esc` | quit | Quit the application | [no modal] |

**Platform Notes:**
- **macOS**: Use `Ctrl+D` or `q` to exit. On Mac, `Ctrl+C` is used for clipboard copy instead of exit.
- **Windows/Linux**: Use `Ctrl+C`, `Ctrl+D`, or `q` to exit. `Ctrl+Shift+C` is used for clipboard copy.

#### Navigation

| Key(s) | Action | Description | Constraints |
|--------|--------|-------------|-------------|
| `↑` | navigate_up | Navigate up in process list | [no modal] |
| `↓` | navigate_down | Navigate down in process list | [no modal] |
| `j` | navigate_down | Navigate down (vim-style) | [no modal] |

You can also click with your mouse to select a process.

#### Process Management

| Key(s) | Action | Description | Constraints |
|--------|--------|-------------|-------------|
| `Enter` | menu | Show process menu with actions (AI Description, Kill, Copy, Cancel) | [no modal] |
| `x`, `k` | kill | Kill selected process directly (with confirmation) | [no modal] |
| `Ctrl+C` (Mac) / `Ctrl+Shift+C` (Win/Linux) | copy | Copy process info to clipboard (PID, Name, Command) | [no modal] |

##### Process Menu

When you press `Enter` on a selected process, a menu appears with the following options:
- **AI Description** - Get an AI-powered explanation of what the process does
- **Kill Process** - Kill the selected process (with confirmation)
- **Copy Process Info** - Copy process details to clipboard
- **Cancel** - Close the menu

Navigate the menu with arrow keys or mouse, press Enter to select, or Esc/Q to cancel.

#### Refresh & Filter

| Key(s) | Action | Description | Constraints |
|--------|--------|-------------|-------------|
| `Ctrl+R` (all platforms) | refresh | Refresh the process list | [no modal, not filtering] |
| `Ctrl+F` (all platforms) | filter | Enter filter mode (fuzzy search) | [no modal, not filtering] |

##### Filter Mode Details

When in filter mode:
- **Type** - Filter processes by PID, name, or command
- **Backspace** - Delete last character from filter
- **ESC** - Exit filter mode and show all processes again

Filter mode uses smart matching with three levels:
1. **Exact substring** - "node" matches "node", "nodejs", "node-server"
2. **Word boundaries** - "tsx" matches "tsx", "tsx-server" (starts with query)
3. **Tight fuzzy** - Characters must be within 3 positions of each other

#### Sorting

| Key(s) | Action | Description | Constraints |
|--------|--------|-------------|-------------|
| `s` | sort_cycle | Cycle through sort modes (CPU↓, CPU↑, Mem↓, Mem↑, Name↑, Name↓, None) | [no modal] |
| `c` | sort_cpu | Quick sort by CPU usage (toggle asc/desc) | [no modal] |
| `m` | sort_memory | Quick sort by Memory usage (toggle asc/desc) | [no modal] |

##### Sort Cycle Sequence

When pressing `s`, the sort mode cycles through these states:

1. **CPU (descending)** - Highest CPU usage first
2. **CPU (ascending)** - Lowest CPU usage first
3. **Memory (descending)** - Highest memory usage first
4. **Memory (ascending)** - Lowest memory usage first
5. **Name (ascending)** - Alphabetically A-Z
6. **Name (descending)** - Alphabetically Z-A
7. **None** - Default order (as returned by system)

The current sort mode is displayed in two places:
- **Status bar** at the bottom of the screen shows the sort column and direction (e.g., "Sort: CPU↓")
- **Table header** shows an arrow indicator (↑ or ↓) next to the sorted column name

#### AI Features

| Key(s) | Action | Description | Constraints |
|--------|--------|-------------|-------------|
| `?` | ai_explain | Explain selected process with AI | [no modal] |
| `/` | ai_ask | Ask AI a custom question about processes | [no modal] |

#### Help

| Key(s) | Action | Description | Constraints |
|--------|--------|-------------|-------------|
| `h` | help | Show help modal | [no modal] |

### Clipboard Format

When you copy a process to the clipboard using `Ctrl+C` (Mac) or `Ctrl+Shift+C` (Windows/Linux), the text is formatted as:

```
PID: <process_id> | Name: <process_name> | Command: <command>
```

A temporary notification "✓ Copied to clipboard" appears in the status bar for 2 seconds.

### Implementation Details

All key bindings are defined in [src/key-bindings.ts](src/key-bindings.ts), which provides:

- **Centralized configuration** - All keys defined in one place
- **Conflict detection** - Automatic checking for duplicate key mappings
- **Easy remapping** - Change keys in one location
- **Type safety** - TypeScript types for all bindings

To modify key bindings:

1. Edit `src/key-bindings.ts`
2. Run `pnpm check-keys` to verify no conflicts
3. Rebuild: `pnpm build`

### Platform Differences

#### macOS
- Use `Ctrl+C` for copy (not Cmd+C)
- Use `Ctrl+R` for refresh
- Use `Ctrl+F` for filter
- Use `Ctrl+D` or `q` to exit (Ctrl+C is used for copy, not exit)

#### Windows/Linux
- Use `Ctrl+Shift+C` for copy
- Use `Ctrl+R` for refresh
- Use `Ctrl+F` for filter
- Use `Ctrl+C`, `Ctrl+D`, or `q` to exit

**Important Note for Mac Users:**
Terminal applications cannot capture Cmd (⌘) key combinations - these are handled by the terminal emulator itself. On macOS, we use `Ctrl+C` for copying instead of exiting, which is why you need to use `Ctrl+D` or `q` to exit the app.

The key bindings are designed to work consistently across all platforms using Ctrl keys, which are universally available.

### Notes

- Multiple keys can map to the same action (e.g., `x` and `k` both kill processes directly)
- Some keys have contextual behavior (only work when no modal is open, etc.)
- The `k` key is used for **kill**, not for vim-style "up" navigation
- Filter mode intercepts most keypresses for typing the filter query
- Modal windows (help, AI responses, confirmations) block normal key bindings

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

- **Linux/Mac**: `~/.config/nodepm-ui/config.json`
- **Windows**: `%APPDATA%\nodepm-ui\config.json`

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
- Use the **s** key to cycle through sort modes, or **c**/**m** for quick CPU/Memory sorting
- Press **Ctrl+R** (all platforms) to refresh process information
- Use **Ctrl+F** (all platforms) for quick filtering
- Press **Enter** on a process to open the action menu, or **x**/**k** to kill directly

## License

ISC

## Author

Bob Bass

## Contributing

Issues and pull requests welcome at [github.com/robertjbass/nodepm-ui](https://github.com/robertjbass/nodepm-ui)

### Outstanding TODOs

For contributors looking to help improve nodepm-ui, check out [TODO.md](TODO.md) for a list of planned features and improvements, including:

- UI improvements (themes, chat interface, settings menu)
- Feature additions (key remapping, checkboxes, API customization)
- AI enhancements (support for other models, improved context)
