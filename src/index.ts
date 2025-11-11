#!/usr/bin/env node

import blessed from 'blessed'
import psList from 'ps-list'
import { exec } from 'child_process'
import { promisify } from 'util'
import { config } from 'dotenv'
import OpenAI from 'openai'
import * as fs from 'fs'
import * as path from 'path'

config({ debug: false }) // Load .env file without debug output

const execAsync = promisify(exec)

type ProcessInfo = {
  pid: number
  name: string
  cmd: string
  memory: number
  cpu: number
}

type SortColumn = 'pid' | 'name' | 'cpu' | 'memory' | 'none'
type SortOrder = 'asc' | 'desc'

class NodeProcessManager {
  private screen: blessed.Widgets.Screen
  private table: blessed.Widgets.ListTableElement
  private statusBar: blessed.Widgets.BoxElement
  private helpBar: blessed.Widgets.BoxElement
  private processes: ProcessInfo[] = []
  private refreshInterval: NodeJS.Timeout | null = null
  private sortColumn: SortColumn = 'none'
  private sortOrder: SortOrder = 'desc'
  private openaiClient: OpenAI | null = null
  private envFilePath: string
  private modalStack: string[] = []

  constructor() {
    // Set up env file path
    this.envFilePath = path.join(process.cwd(), '.env')

    // Initialize OpenAI if API key exists
    this.initializeOpenAI()

    // Suppress blessed terminal capability errors
    const originalConsoleError = console.error
    const originalConsoleLog = console.log

    console.error = (...args: any[]) => {
      const message = args.join(' ')
      // Suppress blessed terminal capability warnings and errors
      if (
        message.includes('Error on xterm') ||
        message.includes('Setulc') ||
        message.includes('stack = []') ||
        message.includes('params[0]') ||
        message.includes('\\u001b[58') ||
        message.includes('out.push')
      ) {
        return
      }
      originalConsoleError.apply(console, args)
    }

    console.log = (...args: any[]) => {
      const message = args.join(' ')
      // Suppress blessed terminal escape sequences
      if (
        message.includes('\\u001b[58') ||
        message.includes('stack = []') ||
        message.includes('out.push')
      ) {
        return
      }
      originalConsoleLog.apply(console, args)
    }

    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Node Process Manager',
      fullUnicode: true,
      warnings: false, // Disable warnings
    })

    // Create table for process list
    this.table = blessed.listtable({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
        header: {
          fg: 'white',
          bold: true,
          bg: 'blue',
        },
        cell: {
          fg: 'white',
          selected: {
            bg: 'magenta',
            fg: 'white',
            bold: true,
          },
        },
      },
      align: 'left',
      keys: false, // We'll handle keys manually
      vi: false,
      mouse: true,
      tags: true,
      scrollable: true,
      interactive: true,
    })

    // Create status bar
    this.statusBar = blessed.box({
      bottom: 2,
      left: 0,
      width: '100%',
      height: 1,
      content: 'Loading processes...',
      style: {
        fg: 'white',
        bg: 'black',
      },
      tags: true,
    })

    // Create help bar
    this.helpBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      content:
        ' {bold}↑↓{/bold}:Nav {bold}Enter{/bold}:Kill {bold}?{/bold}:Explain {bold}/{/bold}:Ask {bold}h{/bold}:Help {bold}r{/bold}:Refresh {bold}c{/bold}:CPU {bold}m{/bold}:Mem {bold}q{/bold}:Quit',
      style: {
        fg: 'black',
        bg: 'cyan',
      },
      tags: true,
      mouse: true,
      clickable: true,
    })

    this.screen.append(this.table)
    this.screen.append(this.statusBar)
    this.screen.append(this.helpBar)

    // Add click handler for help bar to quit
    this.helpBar.on('click', () => {
      this.cleanup()
      process.exit(0)
    })

    this.setupKeyBindings()
  }

  private setupKeyBindings() {
    // Quit with Ctrl+C or Ctrl+D (always quits immediately)
    this.screen.key(['C-c', 'C-d'], () => {
      this.cleanup()
      process.exit(0)
    })

    // Quit with q or escape (only quits if no modal is open)
    this.screen.key(['q', 'escape'], () => {
      if (this.modalStack.length === 0) {
        this.cleanup()
        process.exit(0)
      }
    })

    // Refresh
    this.screen.key(['r'], async () => {
      await this.refreshProcessList()
    })

    // Kill process
    this.screen.key(['enter', 'k'], () => {
      this.killSelectedProcess()
    })

    // Navigation - handle on screen level for better control
    this.screen.key(['up'], () => {
      this.table.up(1)
      this.screen.render()
    })

    this.screen.key(['down'], () => {
      this.table.down(1)
      this.screen.render()
    })

    // Vi-style navigation
    this.screen.key(['j'], () => {
      this.table.down(1)
      this.screen.render()
    })

    // Sort by CPU
    this.screen.key(['c'], () => {
      this.toggleSort('cpu')
    })

    // Sort by Memory
    this.screen.key(['m'], () => {
      this.toggleSort('memory')
    })

    // AI Explain process
    this.screen.key(['?'], () => {
      this.explainSelectedProcess()
    })

    // AI Ask custom question
    this.screen.key(['/'], () => {
      this.askCustomQuestion()
    })

    // Help modal
    this.screen.key(['h'], () => {
      this.showHelpModal()
    })

    // Mouse support for selection
    this.table.on('select', () => {
      this.screen.render()
    })
  }

  private initializeOpenAI() {
    const apiKey = process.env.OPENAI_API_KEY
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey })
    }
  }

  private async promptForApiKey(): Promise<string | null> {
    return new Promise((resolve) => {
      const modalId = 'api-key-prompt'
      this.modalStack.push(modalId)

      // Create container box
      const container = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: 70,
        height: 11,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'yellow',
          },
          bg: 'black',
        },
        label: ' {bold}{yellow-fg}OpenAI API Key Required{/yellow-fg}{/bold} ',
        tags: true,
      })

      // Instructions text
      blessed.text({
        parent: container,
        top: 0,
        left: 1,
        width: '100%-2',
        height: 4,
        content:
          'No OpenAI API key found.\n\nPlease enter your OpenAI API key:\n(Press ENTER to submit, ESC to cancel)',
        tags: true,
      })

      // Create textarea for API key input
      const textarea = blessed.textarea({
        parent: container,
        top: 5,
        left: 1,
        width: '100%-2',
        height: 3,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'white',
          },
          focus: {
            border: {
              fg: 'yellow',
            },
          },
        },
        inputOnFocus: true,
        censor: true, // Hide the API key input
      })

      // Handle submit
      textarea.key('enter', () => {
        const value = textarea.getValue().trim()
        this.modalStack.pop()
        container.destroy()
        this.screen.render()
        resolve(value || null)
      })

      // Handle cancel
      textarea.key(['escape', 'q'], () => {
        this.modalStack.pop()
        container.destroy()
        this.screen.render()
        resolve(null)
      })

      textarea.focus()
      this.screen.render()
    })
  }

  private async saveApiKeyToEnv(apiKey: string) {
    try {
      const envContent = `OPENAI_API_KEY=${apiKey}\n`
      fs.writeFileSync(this.envFilePath, envContent, { flag: 'a' })
      process.env.OPENAI_API_KEY = apiKey
      this.openaiClient = new OpenAI({ apiKey })
      this.statusBar.setContent(
        '{green-fg}✓ API key saved to .env file{/green-fg}'
      )
    } catch (error) {
      this.statusBar.setContent(
        `{red-fg}✗ Failed to save API key: ${error instanceof Error ? error.message : 'Unknown error'}{/red-fg}`
      )
    }
    this.screen.render()
  }

  private showHelpModal() {
    const modalId = 'help-modal'
    this.modalStack.push(modalId)

    // Hide help bar and status bar while modal is open
    this.helpBar.hide()
    this.statusBar.hide()

    // Read README.md content
    let readmeContent = ''
    try {
      const readmePath = path.join(__dirname, '..', 'README.md')
      readmeContent = fs.readFileSync(readmePath, 'utf-8')
    } catch (error) {
      readmeContent =
        'README.md not found.\n\nUse the arrow keys to navigate the process list.\nPress Enter to kill a selected process.\nPress ? to explain a process with AI.\nPress / to ask AI a custom question.\nPress r to refresh the list.\nPress c to sort by CPU.\nPress m to sort by Memory.\nPress q to quit.'
    }

    const helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '80%',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
        bg: 'black',
      },
      label: ' {bold}{cyan-fg}Help - README{/cyan-fg}{/bold} ',
      tags: true,
      keys: true,
      vi: true,
      scrollable: true,
      alwaysScroll: true,
      input: true,
      keyable: true,
      scrollbar: {
        ch: ' ',
        style: {
          bg: 'cyan',
        },
      },
      content:
        readmeContent +
        '\n\n{gray-fg}Press ESC, Q, H, Enter, or Space to close... Use ↑↓ or j/k to scroll{/gray-fg}',
    })

    const closeHandler = () => {
      this.modalStack.pop()
      this.screen.unkey('escape', closeHandler)
      this.screen.unkey('q', closeHandler)
      this.screen.unkey('h', closeHandler)
      this.screen.unkey('enter', closeHandler)
      this.screen.unkey('space', closeHandler)
      helpBox.destroy()
      this.helpBar.show()
      this.statusBar.show()
      this.screen.render()
    }

    // Use screen-level key handler to ensure it's captured
    this.screen.key(['escape', 'q', 'h', 'enter', 'space'], closeHandler)
    helpBox.focus()

    this.screen.render()
  }

  private async explainSelectedProcess() {
    const selectedRow = (this.table as any).selected - 1

    if (selectedRow < 0 || selectedRow >= this.processes.length) {
      this.statusBar.setContent('{yellow-fg}⚠ No process selected{/yellow-fg}')
      this.screen.render()
      return
    }

    // Check if API key exists
    if (!this.openaiClient) {
      const apiKey = await this.promptForApiKey()
      if (!apiKey) {
        this.statusBar.setContent(
          '{yellow-fg}⚠ AI explain cancelled{/yellow-fg}'
        )
        this.screen.render()
        return
      }
      await this.saveApiKeyToEnv(apiKey)
    }

    const process = this.processes[selectedRow]
    await this.explainProcessWithAI(process)
  }

  private async askCustomQuestion() {
    // Check if API key exists
    if (!this.openaiClient) {
      const apiKey = await this.promptForApiKey()
      if (!apiKey) {
        this.statusBar.setContent('{yellow-fg}⚠ AI ask cancelled{/yellow-fg}')
        this.screen.render()
        return
      }
      await this.saveApiKeyToEnv(apiKey)
    }

    const question = await this.promptForQuestion()
    if (!question) {
      this.statusBar.setContent('{yellow-fg}⚠ AI ask cancelled{/yellow-fg}')
      this.screen.render()
      return
    }

    await this.answerCustomQuestion(question)
  }

  private async promptForQuestion(): Promise<string | null> {
    return new Promise((resolve) => {
      const modalId = 'question-prompt'
      this.modalStack.push(modalId)

      // Create container box
      const container = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: 80,
        height: 13,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'cyan',
          },
          bg: 'black',
        },
        label: ' {bold}{cyan-fg}AI Ask - Custom Question{/cyan-fg}{/bold} ',
        tags: true,
      })

      // Instructions text
      blessed.text({
        parent: container,
        top: 0,
        left: 1,
        width: '100%-2',
        height: 6,
        content:
          'Ask a question about your running Node processes.\n\nExamples: "Which process is using the most memory?"\n"I\'ve been using Vitest, which processes are related?"\n\nPress ENTER to submit, ESC to cancel',
        tags: true,
      })

      // Create textarea for input
      const textarea = blessed.textarea({
        parent: container,
        top: 7,
        left: 1,
        width: '100%-2',
        height: 3,
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'white',
          },
          focus: {
            border: {
              fg: 'cyan',
            },
          },
        },
        inputOnFocus: true,
      })

      // Handle submit
      textarea.key('enter', () => {
        const value = textarea.getValue().trim()
        this.modalStack.pop()
        container.destroy()
        this.screen.render()
        resolve(value || null)
      })

      // Handle cancel
      textarea.key(['escape', 'q'], () => {
        this.modalStack.pop()
        container.destroy()
        this.screen.render()
        resolve(null)
      })

      textarea.focus()
      this.screen.render()
    })
  }

  private async answerCustomQuestion(question: string) {
    try {
      this.statusBar.setContent(
        '{yellow-fg}🤖 AI is analyzing your processes...{/yellow-fg}'
      )
      this.screen.render()

      // Build process list context
      const processListText = this.processes
        .map(
          (p, index) =>
            `${index + 1}. [PID ${p.pid}] ${p.name} - CPU: ${p.cpu.toFixed(1)}%, Memory: ${this.formatBytes(p.memory)}\n   Command: ${p.cmd}`
        )
        .join('\n\n')

      const prompt = `I have the following Node.js processes currently running:

${processListText}

User question: ${question}

Please provide a helpful, concise answer based on the process list above. If identifying specific processes, reference them by their number, PID, and name.`

      const completion = await this.openaiClient!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      })

      const answer =
        completion.choices[0]?.message?.content || 'No answer available.'

      // Show answer in a box
      const modalId = 'ai-answer'
      this.modalStack.push(modalId)

      // Hide help bar and status bar while modal is open
      this.helpBar.hide()
      this.statusBar.hide()

      const answerBox = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '85%',
        height: '70%',
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'cyan',
          },
          bg: 'black',
        },
        label: ` {bold}{cyan-fg}AI Answer{/cyan-fg}{/bold} `,
        tags: true,
        keys: true,
        vi: true,
        scrollable: true,
        alwaysScroll: true,
        input: true,
        keyable: true,
        scrollbar: {
          ch: ' ',
          style: {
            bg: 'cyan',
          },
        },
        content: `{bold}Q: ${question}{/bold}\n\n${answer}\n\n{gray-fg}Press ESC, Q, Enter, or Space to close...{/gray-fg}`,
      })

      const closeHandler = () => {
        this.modalStack.pop()
        this.screen.unkey('escape', closeHandler)
        this.screen.unkey('q', closeHandler)
        this.screen.unkey('enter', closeHandler)
        this.screen.unkey('space', closeHandler)
        answerBox.destroy()
        this.helpBar.show()
        this.statusBar.show()
        this.screen.render()
      }

      // Use screen-level key handler to ensure it's captured
      this.screen.key(['escape', 'q', 'enter', 'space'], closeHandler)
      answerBox.focus()

      this.statusBar.setContent('{green-fg}✓ AI answer retrieved{/green-fg}')
      this.screen.render()
    } catch (error: any) {
      let errorMsg = 'Unknown error'
      if (error instanceof Error) {
        errorMsg = error.message
      }
      this.statusBar.setContent(`{red-fg}✗ AI ask failed: ${errorMsg}{/red-fg}`)
      this.screen.render()
    }
  }

  private async explainProcessWithAI(process: ProcessInfo) {
    try {
      this.statusBar.setContent(
        '{yellow-fg}🤖 Asking AI about this process...{/yellow-fg}'
      )
      this.screen.render()

      const prompt = `I have a running process with the following details:

Process Name: ${process.name}
PID: ${process.pid}
Command: ${process.cmd}
CPU Usage: ${process.cpu}%
Memory Usage: ${this.formatBytes(process.memory)}

Please explain in 2-3 sentences what this process likely does and whether it's normal to see it running. Be concise and practical.`

      const completion = await this.openaiClient!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
      })

      const explanation =
        completion.choices[0]?.message?.content || 'No explanation available.'

      // Show explanation in a box
      const modalId = 'ai-explanation'
      this.modalStack.push(modalId)

      // Hide help bar and status bar while modal is open
      this.helpBar.hide()
      this.statusBar.hide()

      const explainBox = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '80%',
        height: '60%',
        border: {
          type: 'line',
        },
        style: {
          border: {
            fg: 'green',
          },
          bg: 'black',
        },
        label: ` {bold}{green-fg}AI Explanation - ${process.name} (PID: ${process.pid}){/green-fg}{/bold} `,
        tags: true,
        keys: true,
        vi: true,
        scrollable: true,
        alwaysScroll: true,
        input: true,
        keyable: true,
        scrollbar: {
          ch: ' ',
          style: {
            bg: 'green',
          },
        },
        content:
          explanation +
          '\n\n{gray-fg}Press ESC, Q, Enter, or Space to close...{/gray-fg}',
      })

      const closeHandler = () => {
        this.modalStack.pop()
        this.screen.unkey('escape', closeHandler)
        this.screen.unkey('q', closeHandler)
        this.screen.unkey('enter', closeHandler)
        this.screen.unkey('space', closeHandler)
        explainBox.destroy()
        this.helpBar.show()
        this.statusBar.show()
        this.screen.render()
      }

      // Use screen-level key handler to ensure it's captured
      this.screen.key(['escape', 'q', 'enter', 'space'], closeHandler)
      explainBox.focus()

      this.statusBar.setContent(
        '{green-fg}✓ AI explanation retrieved{/green-fg}'
      )
      this.screen.render()
    } catch (error: any) {
      let errorMsg = 'Unknown error'
      if (error instanceof Error) {
        errorMsg = error.message
      }
      this.statusBar.setContent(
        `{red-fg}✗ AI explain failed: ${errorMsg}{/red-fg}`
      )
      this.screen.render()
    }
  }

  private toggleSort(column: SortColumn) {
    if (this.sortColumn === column) {
      // Toggle sort order
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc'
    } else {
      // New column, default to descending
      this.sortColumn = column
      this.sortOrder = 'desc'
    }
    this.refreshProcessList()
  }

  private sortProcesses(processes: ProcessInfo[]): ProcessInfo[] {
    if (this.sortColumn === 'none') {
      return processes
    }

    return [...processes].sort((a, b) => {
      let comparison = 0

      switch (this.sortColumn) {
        case 'cpu':
          comparison = a.cpu - b.cpu
          break
        case 'memory':
          comparison = a.memory - b.memory
          break
        case 'pid':
          comparison = a.pid - b.pid
          break
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
      }

      return this.sortOrder === 'asc' ? comparison : -comparison
    })
  }

  private async getNodeProcesses(): Promise<ProcessInfo[]> {
    const allProcesses = await psList()

    // Filter for node processes
    const nodeProcesses = allProcesses.filter(
      (p) =>
        p.name.toLowerCase().includes('node') ||
        p.cmd?.toLowerCase().includes('node')
    )

    return nodeProcesses.map((p) => ({
      pid: p.pid,
      name: p.name,
      cmd: p.cmd || 'N/A',
      memory: p.memory || 0,
      cpu: p.cpu || 0,
    }))
  }

  private formatBytes(bytes: number | undefined): string {
    if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = Math.floor(Math.log(bytes) / Math.log(k))
    i = Math.max(0, Math.min(i, sizes.length - 1))
    const value = Math.round((bytes / Math.pow(k, i)) * 100) / 100
    return `${value} ${sizes[i]}`
  }

  private truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str
    return str.substring(0, maxLength - 3) + '...'
  }

  async refreshProcessList() {
    try {
      this.statusBar.setContent('{yellow-fg}Refreshing...{/yellow-fg}')
      this.screen.render()

      this.processes = await this.getNodeProcesses()

      // Sort processes
      const sortedProcesses = this.sortProcesses(this.processes)

      // Prepare table data with colors
      const currentPid = process.pid
      const tableData = [
        ['PID', 'Name', 'CPU %', 'Memory', 'Command'],
        ...sortedProcesses.map((p) => {
          const cpuPercent = p.cpu || 0
          const cpuColor =
            cpuPercent > 50
              ? '{red-fg}'
              : cpuPercent > 20
                ? '{yellow-fg}'
                : '{green-fg}'
          const memoryMB = (p.memory || 0) / (1024 * 1024)
          const memColor =
            memoryMB > 500
              ? '{red-fg}'
              : memoryMB > 200
                ? '{yellow-fg}'
                : '{cyan-fg}'

          // Mark current process
          const isCurrentProcess = p.pid === currentPid
          const nameDisplay = isCurrentProcess
            ? `{white-fg}{bold}${this.truncateString(p.name, 12)} {green-fg}(This Process){/green-fg}{/bold}{/white-fg}`
            : `{white-fg}${this.truncateString(p.name, 20)}{/white-fg}`

          return [
            `{cyan-fg}${p.pid}{/cyan-fg}`,
            nameDisplay,
            `${cpuColor}${p.cpu.toFixed(1)}%{/}`,
            `${memColor}${this.formatBytes(p.memory || 0)}{/}`,
            `{gray-fg}${this.truncateString(p.cmd, 60)}{/gray-fg}`,
          ]
        }),
      ]

      this.table.setData(tableData)

      const processCount = this.processes.length
      const totalMemory = this.processes.reduce((sum, p) => sum + p.memory, 0)

      // Build sort indicator
      let sortIndicator = ''
      if (this.sortColumn !== 'none') {
        const arrow = this.sortOrder === 'asc' ? '↑' : '↓'
        const columnName =
          this.sortColumn === 'cpu'
            ? 'CPU'
            : this.sortColumn === 'memory'
              ? 'Memory'
              : this.sortColumn
        sortIndicator = ` | Sort: {bold}${columnName} ${arrow}{/bold}`
      }

      const statusMessage = `{green-fg}✓{/green-fg} Found {bold}{cyan-fg}${processCount}{/cyan-fg}{/bold} Node processes | Total Memory: {bold}{yellow-fg}${this.formatBytes(totalMemory)}{/yellow-fg}{/bold}${sortIndicator} | Last update: {gray-fg}${new Date().toLocaleTimeString()}{/gray-fg}`

      this.statusBar.setContent(statusMessage)

      this.screen.render()
    } catch (error) {
      this.statusBar.setContent(
        `{red-fg} Error: ${error instanceof Error ? error.message : 'Unknown error'}{/red-fg}`
      )
      this.screen.render()
    }
  }

  private killSelectedProcess() {
    const selectedRow = (this.table as any).selected - 1 // Subtract header row

    if (selectedRow < 0 || selectedRow >= this.processes.length) {
      this.statusBar.setContent('{yellow-fg}⚠ No process selected{/yellow-fg}')
      this.screen.render()
      return
    }

    const process = this.processes[selectedRow]
    this.showKillConfirmation(process)
  }

  private showKillConfirmation(process: ProcessInfo) {
    const modalId = 'kill-confirmation'
    this.modalStack.push(modalId)

    // Create confirmation dialog box
    const confirmBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 9,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'red',
        },
        bg: 'black',
      },
      label: ' {bold}{red-fg}Confirm Kill Process{/red-fg}{/bold} ',
      tags: true,
      content: `\nKill process?\n\n{cyan-fg}PID:{/cyan-fg} ${process.pid}\n{cyan-fg}Name:{/cyan-fg} ${process.name}\n{cyan-fg}Command:{/cyan-fg} ${this.truncateString(process.cmd, 40)}\n\n{bold}Press 'y' to confirm, 'n' to cancel{/bold}`,
    })

    // Handle keypresses
    const keyHandler = async (_ch: any, key: any) => {
      if (key.name === 'y') {
        this.modalStack.pop()
        confirmBox.destroy()
        this.screen.unkey('y', keyHandler)
        this.screen.unkey('n', keyHandler)
        this.screen.unkey('escape', keyHandler)
        this.screen.unkey('q', keyHandler)
        this.screen.render()
        await this.executeKill(process)
      } else if (
        key.name === 'n' ||
        key.name === 'escape' ||
        key.name === 'q'
      ) {
        this.modalStack.pop()
        confirmBox.destroy()
        this.screen.unkey('y', keyHandler)
        this.screen.unkey('n', keyHandler)
        this.screen.unkey('escape', keyHandler)
        this.screen.unkey('q', keyHandler)
        this.statusBar.setContent('{yellow-fg}⚠ Kill cancelled{/yellow-fg}')
        this.screen.render()
      }
    }

    // Register key handlers
    this.screen.key(['y', 'n', 'escape', 'q'], keyHandler)

    confirmBox.focus()
    this.screen.render()
  }

  private async executeKill(process: ProcessInfo) {
    try {
      this.statusBar.setContent(
        `{yellow-fg}Killing process ${process.pid}...{/yellow-fg}`
      )
      this.screen.render()

      await execAsync(`kill ${process.pid}`)

      this.statusBar.setContent(
        `{green-fg} Successfully killed process ${process.pid} (${process.name}){/green-fg}`
      )

      // Refresh the list after a short delay
      setTimeout(async () => {
        await this.refreshProcessList()
      }, 500)
    } catch (error) {
      this.statusBar.setContent(
        `{red-fg} Failed to kill process ${process.pid}: ${error instanceof Error ? error.message : 'Unknown error'}{/red-fg}`
      )
    }

    this.screen.render()
  }

  private cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
    }
  }

  async start() {
    // Initial load
    await this.refreshProcessList()

    this.screen.render()
  }
}

// Main execution
const manager = new NodeProcessManager()
manager.start().catch((error) => {
  console.error('Failed to start Node Process Manager:', error)
  process.exit(1)
})
