#!/usr/bin/env tsx

import {
  KEY_BINDINGS,
  checkForConflicts,
  getAllKeys,
} from '../src/key-bindings'

console.log('')
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║           nodepm - Keyboard Bindings Configuration           ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log('')

// Group bindings by action type
const byAction = new Map<string, Array<{ name: string; binding: any }>>()

Object.entries(KEY_BINDINGS).forEach(([name, binding]) => {
  if (!byAction.has(binding.action)) {
    byAction.set(binding.action, [])
  }
  byAction.get(binding.action)!.push({ name, binding })
})

// Print grouped bindings
console.log('📋 Key Bindings by Action:\n')

const actionOrder = [
  'exit',
  'quit',
  'copy',
  'navigate_up',
  'navigate_down',
  'kill',
  'refresh',
  'filter',
  'sort_cycle',
  'sort_cpu',
  'sort_memory',
  'ai_explain',
  'ai_ask',
  'help',
]

actionOrder.forEach((action) => {
  const bindings = byAction.get(action)
  if (!bindings) return

  console.log(`\n${action.toUpperCase().replace(/_/g, ' ')}:`)
  bindings.forEach(({ name, binding }) => {
    const modifiers = []
    if (binding.requiresNoModal) modifiers.push('no modal')
    if (binding.requiresNoFilter) modifiers.push('not filtering')

    const modifierText =
      modifiers.length > 0 ? ` [${modifiers.join(', ')}]` : ''
    console.log(
      `  ${binding.label.padEnd(20)} → ${binding.description}${modifierText}`
    )
    console.log(`    Keys: ${binding.keys.join(', ')}`)
  })
})

// Check for conflicts
console.log('\n\n🔍 Conflict Check:\n')
const conflicts = checkForConflicts()

if (conflicts.length > 0) {
  console.log('⚠️  KEY CONFLICTS DETECTED:\n')
  conflicts.forEach(({ key, bindings }) => {
    console.log(`  ❌ Key "${key}" is mapped to multiple actions:`)
    bindings.forEach((bindingName) => {
      const binding = KEY_BINDINGS[bindingName as keyof typeof KEY_BINDINGS]
      console.log(`     - ${bindingName} (${binding.action})`)
    })
    console.log('')
  })
} else {
  console.log('✅ No key conflicts detected!')
}

// Summary
console.log('\n\n📊 Summary:\n')
console.log(`  Total key bindings: ${Object.keys(KEY_BINDINGS).length}`)
console.log(`  Unique keys used: ${getAllKeys().length}`)
console.log(`  Unique actions: ${byAction.size}`)

console.log('\n\n💡 Notes:\n')
console.log('  • C- prefix = Ctrl key (all platforms)')
console.log('  • M- prefix = Meta/Cmd key (Mac) or Alt key (Windows/Linux)')
console.log(
  '  • Some keys have context requirements (no modal, not filtering, etc.)'
)
console.log(
  '  • Multiple bindings can map to the same action (e.g., k and enter both kill)'
)
console.log('\n')
