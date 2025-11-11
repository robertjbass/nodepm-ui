/**
 * Keyboard bindings configuration for nodepm
 *
 * This file centralizes all keyboard shortcuts and their mappings.
 * Modifiers:
 * - C- : Ctrl key (works on all platforms)
 * - M- : Meta/Alt key (Cmd on Mac, Alt on Windows/Linux)
 */

export type KeyBinding = {
  keys: string[]
  action: string
  label: string
  description: string
  requiresNoModal?: boolean
  requiresNoFilter?: boolean
}

export const KEY_BINDINGS: Record<string, KeyBinding> = {
  // Exit/Quit
  EXIT_CTRL_D: {
    keys: ['C-d'],
    action: 'exit',
    label: 'Ctrl+D',
    description: 'Force quit the application',
  },
  EXIT_CTRL_C: {
    keys: ['C-c'],
    action: 'exit',
    label: 'Ctrl+C',
    description: 'Exit the application (Windows/Linux only)',
  },
  QUIT: {
    keys: ['q', 'escape'],
    action: 'quit',
    label: 'q/Esc',
    description: 'Quit the application (when no modal is open)',
    requiresNoModal: true,
  },

  // Clipboard
  COPY_TO_CLIPBOARD: {
    keys: ['M-c', 'C-S-c'],
    action: 'copy',
    label: 'Cmd+C/Ctrl+Shift+C',
    description: 'Copy selected process info to clipboard',
    requiresNoModal: true,
  },

  // Refresh
  REFRESH: {
    keys: ['C-r', 'M-r'],
    action: 'refresh',
    label: 'Cmd+R/Ctrl+R',
    description: 'Refresh the process list',
    requiresNoModal: true,
    requiresNoFilter: true,
  },

  // Filter
  FILTER: {
    keys: ['C-f', 'M-f'],
    action: 'filter',
    label: 'Cmd+F/Ctrl+F',
    description: 'Enter filter mode (fuzzy search)',
    requiresNoModal: true,
    requiresNoFilter: true,
  },

  // Kill process
  KILL_ENTER: {
    keys: ['enter'],
    action: 'kill',
    label: 'Enter',
    description: 'Kill selected process (with confirmation)',
    requiresNoModal: true,
  },
  KILL_K: {
    keys: ['k'],
    action: 'kill',
    label: 'k',
    description: 'Kill selected process (with confirmation)',
    requiresNoModal: true,
  },

  // Navigation
  NAV_UP: {
    keys: ['up'],
    action: 'navigate_up',
    label: '↑',
    description: 'Navigate up in process list',
    requiresNoModal: true,
  },
  NAV_DOWN: {
    keys: ['down'],
    action: 'navigate_down',
    label: '↓',
    description: 'Navigate down in process list',
    requiresNoModal: true,
  },
  NAV_DOWN_J: {
    keys: ['j'],
    action: 'navigate_down',
    label: 'j',
    description: 'Navigate down in process list (vim-style)',
    requiresNoModal: true,
  },

  // Sorting
  SORT_CYCLE: {
    keys: ['s'],
    action: 'sort_cycle',
    label: 's',
    description:
      'Cycle through sort modes (CPU↓, CPU↑, Mem↓, Mem↑, Name↑, Name↓, None)',
    requiresNoModal: true,
  },
  SORT_CPU: {
    keys: ['c'],
    action: 'sort_cpu',
    label: 'c',
    description: 'Quick sort by CPU usage (toggle ascending/descending)',
    requiresNoModal: true,
  },
  SORT_MEMORY: {
    keys: ['m'],
    action: 'sort_memory',
    label: 'm',
    description: 'Quick sort by Memory usage (toggle ascending/descending)',
    requiresNoModal: true,
  },

  // AI Features
  AI_EXPLAIN: {
    keys: ['?'],
    action: 'ai_explain',
    label: '?',
    description: 'Explain selected process with AI',
    requiresNoModal: true,
  },
  AI_ASK: {
    keys: ['/'],
    action: 'ai_ask',
    label: '/',
    description: 'Ask AI a custom question about processes',
    requiresNoModal: true,
  },

  // Help
  HELP: {
    keys: ['h'],
    action: 'help',
    label: 'h',
    description: 'Show help modal',
    requiresNoModal: true,
  },
}

/**
 * Get all unique keys used across all bindings
 */
export function getAllKeys(): string[] {
  const keys = new Set<string>()
  Object.values(KEY_BINDINGS).forEach((binding) => {
    binding.keys.forEach((key) => keys.add(key))
  })
  return Array.from(keys).sort()
}

/**
 * Check for key conflicts (same key mapped to multiple actions)
 */
export function checkForConflicts(): Array<{
  key: string
  bindings: string[]
}> {
  const keyMap = new Map<string, string[]>()

  Object.entries(KEY_BINDINGS).forEach(([name, binding]) => {
    binding.keys.forEach((key) => {
      if (!keyMap.has(key)) {
        keyMap.set(key, [])
      }
      keyMap.get(key)!.push(name)
    })
  })

  const conflicts: Array<{ key: string; bindings: string[] }> = []
  keyMap.forEach((bindings, key) => {
    if (bindings.length > 1) {
      conflicts.push({ key, bindings })
    }
  })

  return conflicts
}

/**
 * Get bindings by action type
 */
export function getBindingsByAction(action: string): KeyBinding[] {
  return Object.values(KEY_BINDINGS).filter((b) => b.action === action)
}

/**
 * Generate help bar text from key bindings
 */
export function generateHelpBarText(): string {
  const shortcuts = [
    { label: '↑↓', description: 'Nav' },
    { label: 'Enter', description: 'Kill' },
    { label: 'Cmd+C', description: 'Copy' },
    { label: '?', description: 'Explain' },
    { label: '/', description: 'Ask' },
    { label: 'Cmd+F', description: 'Filter' },
    { label: 'Cmd+R', description: 'Refresh' },
    { label: 's', description: 'Sort' },
    { label: 'q', description: 'Quit' },
  ]

  return (
    ' ' +
    shortcuts.map((s) => `{bold}${s.label}{/bold}:${s.description}`).join(' ')
  )
}

/**
 * Get key binding by action name
 */
export function getKeyByAction(action: string): string[] {
  const binding = Object.values(KEY_BINDINGS).find((b) => b.action === action)
  return binding ? binding.keys : []
}

/**
 * Print all key bindings (for debugging)
 */
export function printKeyBindings(): void {
  console.log('\n=== Key Bindings ===\n')
  Object.entries(KEY_BINDINGS).forEach(([name, binding]) => {
    console.log(`${name}:`)
    console.log(`  Keys: ${binding.keys.join(', ')}`)
    console.log(`  Action: ${binding.action}`)
    console.log(`  Label: ${binding.label}`)
    console.log(`  Description: ${binding.description}`)
    if (binding.requiresNoModal) console.log(`  Requires: No modal open`)
    if (binding.requiresNoFilter) console.log(`  Requires: Not in filter mode`)
    console.log()
  })

  const conflicts = checkForConflicts()
  if (conflicts.length > 0) {
    console.log('')
    console.log('⚠️  KEY CONFLICTS DETECTED:')
    console.log('')
    conflicts.forEach(({ key, bindings }) => {
      console.log(`  Key "${key}" is used by: ${bindings.join(', ')}`)
    })
  } else {
    console.log('✅ No key conflicts detected\n')
  }
}
