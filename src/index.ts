#!/usr/bin/env node

import { NodeProcessManager } from './process-manager'

const args = process.argv.slice(2)
const showAllProcesses = args.includes('--all')

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
nodepm - Terminal UI for managing Node.js processes

Usage:
  nodepm [options]

Options:
  --all       Show all processes (not just Node.js processes)
  --help, -h  Show this help message

Without --all flag, nodepm will only display Node.js processes.
  `)
  process.exit(0)
}

const manager = new NodeProcessManager(showAllProcesses)

process.on('SIGINT', () => {
  manager.cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  manager.cleanup()
  process.exit(0)
})

manager.start().catch((error) => {
  console.error('Failed to start Node Process Manager:', error)
  process.exit(1)
})
