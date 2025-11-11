import blessed from 'blessed'
import psList from 'ps-list'
import { exec } from 'child_process'
import { promisify } from 'util'
import OpenAI from 'openai'
import * as fs from 'fs'
import * as path from 'path'
import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'
import { loadConfig, saveConfig, getConfigPath } from './config'

const execAsync = promisify(exec)

export type ProcessInfo = {
  pid: number
  name: string
  cmd: string
  memory: number
  cpu: number
}

type SortColumn = 'pid' | 'name' | 'cpu' | 'memory' | 'none'
type SortOrder = 'asc' | 'desc'

export class NodeProcessManager {
  private screen: blessed.Widgets.Screen
  private table: blessed.Widgets.ListTableElement
  private statusBar: blessed.Widgets.BoxElement
  private helpBar: blessed.Widgets.BoxElement
  private toastBar: blessed.Widgets.BoxElement
  private processes: ProcessInfo[] = []
  private displayedProcesses: ProcessInfo[] = []
  private refreshInterval: NodeJS.Timeout | null = null
  private sortColumn: SortColumn = 'none'
  private sortOrder: SortOrder = 'desc'
  private openaiClient: OpenAI | null = null
  private modalStack: string[] = []
  private showAllProcesses: boolean = false
  private originalConsoleError: typeof console.error
  private originalConsoleLog: typeof console.log
  private helpBarClickHandler: () => void
  private filterMode: boolean = false
  private filterQuery: string = ''
  private filterBox: blessed.Widgets.BoxElement | null = null
  private toastTimeout: NodeJS.Timeout | null = null
  private activeToast: boolean = false

  constructor(showAllProcesses: boolean = false) {
    this.showAllProcesses = showAllProcesses
    this.initializeOpenAI()

    this.originalConsoleError = console.error
    this.originalConsoleLog = console.log

    console.error = (...args: any[]) => {
      const message = args.join(' ')
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
      this.originalConsoleError.apply(console, args)
    }

    console.log = (...args: any[]) => {
      const message = args.join(' ')
      if (
        message.includes('\\u001b[58') ||
        message.includes('stack = []') ||
        message.includes('out.push')
      ) {
        return
      }
      this.originalConsoleLog.apply(console, args)
    }

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Node Process Manager',
      fullUnicode: true,
      warnings: false,
    })

    // Toast notification bar at the top
    this.toastBar = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: this.showAllProcesses ? 'All Processes' : 'Node Processes',
      style: {
        fg: 'white',
        bg: 'black',
        bold: true,
      },
      tags: true,
    })

    this.table = blessed.listtable({
      top: 1, // Start below toast bar
      left: 0,
      width: '100%',
      height: '100%-4', // Adjust for toast bar
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

    this.helpBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      content:
        ' {bold}↑↓{/bold}:Nav {bold}Enter{/bold}:Kill {bold}Cmd+C{/bold}:Copy {bold}?{/bold}:Explain {bold}/{/bold}:Ask {bold}Cmd+F{/bold}:Filter {bold}Cmd+R{/bold}:Refresh {bold}s{/bold}:Sort {bold}q{/bold}:Quit',
      style: {
        fg: 'black',
        bg: 'cyan',
      },
      tags: true,
      mouse: true,
      clickable: true,
    })

    this.screen.append(this.toastBar)
    this.screen.append(this.table)
    this.screen.append(this.statusBar)
    this.screen.append(this.helpBar)

    this.helpBarClickHandler = () => {
      this.cleanup()
      process.exit(0)
    }
    this.helpBar.on('click', this.helpBarClickHandler)

    this.setupKeyBindings()
  }

  private setupKeyBindings() {
    const isMac = process.platform === 'darwin'

    // Exit: Ctrl+D always, Ctrl+C only on non-Mac (Mac uses Ctrl+C for copy)
    this.screen.key(['C-d'], () => {
      this.cleanup()
      process.exit(0)
    })

    if (!isMac) {
      // On Windows/Linux, Ctrl+C exits (standard terminal behavior)
      this.screen.key(['C-c'], () => {
        this.cleanup()
        process.exit(0)
      })
    }

    this.screen.key(['q', 'escape'], () => {
      if (this.modalStack.length === 0) {
        this.cleanup()
        process.exit(0)
      }
    })

    // Copy to clipboard:
    // - Mac: Cmd+C (M-c)
    // - Windows/Linux: Ctrl+Shift+C (C-S-c)
    this.screen.key(['M-c', 'C-S-c'], async () => {
      if (this.modalStack.length === 0) {
        await this.copySelectedProcessToClipboard()
      }
    })

    // Refresh: Cmd+R on Mac, Ctrl+R on Windows/Linux
    this.screen.key(['C-r', 'M-r'], async () => {
      if (this.modalStack.length === 0 && !this.filterMode) {
        await this.refreshProcessList()
      }
    })

    // Filter: Cmd+F on Mac, Ctrl+F on Windows/Linux
    this.screen.key(['C-f', 'M-f'], () => {
      if (this.modalStack.length === 0 && !this.filterMode) {
        this.enterFilterMode()
      }
    })

    this.screen.key(['enter', 'k'], () => {
      if (this.modalStack.length === 0) {
        this.killSelectedProcess()
      }
    })

    this.screen.key(['up'], () => {
      if (this.modalStack.length === 0) {
        this.table.up(1)
        this.screen.render()
      }
    })

    this.screen.key(['down'], () => {
      if (this.modalStack.length === 0) {
        this.table.down(1)
        this.screen.render()
      }
    })

    this.screen.key(['j'], () => {
      if (this.modalStack.length === 0) {
        this.table.down(1)
        this.screen.render()
      }
    })

    // Sort cycling with 's' key
    this.screen.key(['s'], () => {
      if (this.modalStack.length === 0) {
        this.cycleSort()
      }
    })

    // Keep c and m for quick CPU/Memory sorting
    this.screen.key(['c'], () => {
      if (this.modalStack.length === 0) {
        this.toggleSort('cpu')
      }
    })

    this.screen.key(['m'], () => {
      if (this.modalStack.length === 0) {
        this.toggleSort('memory')
      }
    })

    this.screen.key(['?'], () => {
      if (this.modalStack.length === 0) {
        this.explainSelectedProcess()
      }
    })

    this.screen.key(['/'], () => {
      if (this.modalStack.length === 0) {
        this.askCustomQuestion()
      }
    })

    this.screen.key(['h'], () => {
      if (this.modalStack.length === 0) {
        this.showHelpModal()
      }
    })

    this.screen.on('keypress', (ch: string, key: any) => {
      if (this.filterMode && this.modalStack.length === 0) {
        this.handleFilterInput(ch, key)
      }
    })

    this.table.on('select', () => {
      if (this.modalStack.length === 0) {
        this.screen.render()
      }
    })

    this.table.on('click', () => {
      if (this.modalStack.length > 0) {
        return false
      }
    })
  }

  private initializeOpenAI() {
    const envApiKey = process.env.OPENAI_API_KEY
    const config = loadConfig()

    if (envApiKey && !config.openAiApiKey) {
      config.openAiApiKey = envApiKey
      config.version = '0.7.0'
      try {
        saveConfig(config)
      } catch {
        // Silently fail if can't save - env var will still work
      }
    }

    const apiKey = envApiKey || config.openAiApiKey

    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey })
    }
  }

  private async promptForApiKey(): Promise<string | null> {
    return new Promise((resolve) => {
      const modalId = 'api-key-prompt'
      this.modalStack.push(modalId)

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
        censor: true,
      })

      textarea.key('enter', () => {
        const value = textarea.getValue().trim()
        this.modalStack.pop()
        container.destroy()
        this.screen.render()
        resolve(value || null)
      })

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

  private async saveApiKeyToConfig(apiKey: string) {
    try {
      const config = loadConfig()
      config.openAiApiKey = apiKey
      config.version = '0.7.0'
      saveConfig(config)

      this.openaiClient = new OpenAI({ apiKey })
      const configPath = getConfigPath()
      this.statusBar.setContent(
        `{green-fg}✓ API key saved to ${configPath}{/green-fg}`
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

    this.helpBar.hide()
    this.statusBar.hide()

    const overlay = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: {
        bg: 'black',
        transparent: true,
      },
      clickable: true,
      mouse: true,
    })

    let readmeContent = ''
    try {
      let readmePath = path.join(process.cwd(), 'README.md')

      if (!fs.existsSync(readmePath) && typeof __dirname !== 'undefined') {
        readmePath = path.join(__dirname, '..', 'README.md')
        if (!fs.existsSync(readmePath)) {
          readmePath = path.join(__dirname, '..', '..', 'README.md')
        }
      }

      if (!fs.existsSync(readmePath)) {
        throw new Error('README.md not found at: ' + readmePath)
      }

      const markdownContent = fs.readFileSync(readmePath, 'utf-8')

      marked.use(
        markedTerminal({
          width: 100,
        }) as any
      )

      readmeContent = marked.parse(markdownContent) as string

      if (!readmeContent || readmeContent.trim().length === 0) {
        throw new Error('Markdown rendering produced empty content')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      readmeContent = `Error loading README: ${errorMsg}\n\nFallback Help:\n\nUse the arrow keys to navigate the process list.\nPress Enter to kill a selected process.\nPress ? to explain a process with AI.\nPress / to ask AI a custom question.\nPress h to open this help.\nPress r to refresh the list.\nPress c to sort by CPU.\nPress m to sort by Memory.\nPress q to quit.`
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
      overlay.destroy()
      this.helpBar.show()
      this.statusBar.show()
      this.screen.render()
    }

    this.screen.key(['escape', 'q', 'h', 'enter', 'space'], closeHandler)
    helpBox.focus()

    this.screen.render()
  }

  private async explainSelectedProcess() {
    const selectedRow = (this.table as any).selected - 1

    if (selectedRow < 0 || selectedRow >= this.displayedProcesses.length) {
      this.statusBar.setContent('{yellow-fg}⚠ No process selected{/yellow-fg}')
      this.screen.render()
      return
    }

    if (!this.openaiClient) {
      const apiKey = await this.promptForApiKey()
      if (!apiKey) {
        this.statusBar.setContent(
          '{yellow-fg}⚠ AI explain cancelled{/yellow-fg}'
        )
        this.screen.render()
        return
      }
      await this.saveApiKeyToConfig(apiKey)
    }

    const process = this.displayedProcesses[selectedRow]
    await this.explainProcessWithAI(process)
  }

  private async askCustomQuestion() {
    if (!this.openaiClient) {
      const apiKey = await this.promptForApiKey()
      if (!apiKey) {
        this.statusBar.setContent('{yellow-fg}⚠ AI ask cancelled{/yellow-fg}')
        this.screen.render()
        return
      }
      await this.saveApiKeyToConfig(apiKey)
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

      textarea.key('enter', () => {
        const value = textarea.getValue().trim()
        this.modalStack.pop()
        container.destroy()
        this.screen.render()
        resolve(value || null)
      })

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

      const processListText = this.processes
        .map(
          (p, index) =>
            `${index + 1}. [PID ${p.pid}] ${p.name} - CPU: ${p.cpu.toFixed(1)}%, Memory: ${this.formatBytes(p.memory)}\n   Command: ${p.cmd}`
        )
        .join('\n\n')

      const prompt = `I have the following ${this.showAllProcesses ? '' : 'Node.js '}processes currently running:

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

      const modalId = 'ai-answer'
      this.modalStack.push(modalId)

      this.helpBar.hide()
      this.statusBar.hide()

      const overlay = blessed.box({
        parent: this.screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        style: {
          bg: 'black',
          transparent: true,
        },
        clickable: true,
        mouse: true,
      })

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
        overlay.destroy()
        this.helpBar.show()
        this.statusBar.show()
        this.screen.render()
      }

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
      this.showToast('🤖 Asking AI, please wait...', 'info', 0)
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

      const modalId = 'ai-explanation'
      this.modalStack.push(modalId)

      this.helpBar.hide()
      this.statusBar.hide()

      const overlay = blessed.box({
        parent: this.screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        style: {
          bg: 'black',
          transparent: true,
        },
        clickable: true,
        mouse: true,
      })

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
        overlay.destroy()
        this.helpBar.show()
        this.statusBar.show()
        this.hideToast()
        this.screen.render()
      }

      this.screen.key(['escape', 'q', 'enter', 'space'], closeHandler)
      explainBox.focus()

      this.hideToast()
      this.statusBar.setContent(
        '{green-fg}✓ AI explanation retrieved{/green-fg}'
      )
      this.screen.render()
    } catch (error: any) {
      let errorMsg = 'Unknown error'
      if (error instanceof Error) {
        errorMsg = error.message
      }
      this.showToast(`✗ AI failed: ${errorMsg}`, 'error', 3000)
      this.statusBar.setContent(
        `{red-fg}✗ AI explain failed: ${errorMsg}{/red-fg}`
      )
      this.screen.render()
    }
  }

  private toggleSort(column: SortColumn) {
    if (this.sortColumn === column) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc'
    } else {
      this.sortColumn = column
      this.sortOrder = 'desc'
    }
    this.refreshProcessList()
  }

  private cycleSort() {
    const sortStates: Array<{ column: SortColumn; order: SortOrder }> = [
      { column: 'cpu', order: 'desc' },
      { column: 'cpu', order: 'asc' },
      { column: 'memory', order: 'desc' },
      { column: 'memory', order: 'asc' },
      { column: 'name', order: 'asc' },
      { column: 'name', order: 'desc' },
      { column: 'none', order: 'desc' },
    ]

    const currentIndex = sortStates.findIndex(
      (s) => s.column === this.sortColumn && s.order === this.sortOrder
    )

    const nextIndex = (currentIndex + 1) % sortStates.length
    const nextState = sortStates[nextIndex]

    this.sortColumn = nextState.column
    this.sortOrder = nextState.order

    this.refreshProcessList()
  }

  /**
   * Show a toast notification
   * @param message - The message to display
   * @param type - 'success', 'error', 'warning', or 'info'
   * @param duration - Duration in milliseconds (0 for persistent)
   */
  private showToast(
    message: string,
    type: 'success' | 'error' | 'warning' | 'info' = 'info',
    duration: number = 2000
  ) {
    // Clear any existing toast timeout
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout)
      this.toastTimeout = null
    }

    this.activeToast = true

    // Set color based on type
    let fg: string, bg: string
    switch (type) {
      case 'success':
        fg = 'black'
        bg = 'green'
        break
      case 'error':
        fg = 'white'
        bg = 'red'
        break
      case 'warning':
        fg = 'black'
        bg = 'yellow'
        break
      case 'info':
      default:
        fg = 'black'
        bg = 'cyan'
        break
    }

    this.toastBar.setContent(` ${message}`)
    this.toastBar.style.fg = fg
    this.toastBar.style.bg = bg
    this.toastBar.style.bold = true
    this.screen.render()

    // Auto-hide after duration if not persistent
    if (duration > 0) {
      this.toastTimeout = setTimeout(() => {
        this.hideToast()
      }, duration)
    }
  }

  /**
   * Hide the toast notification and restore default header
   */
  private hideToast() {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout)
      this.toastTimeout = null
    }

    this.activeToast = false

    const defaultText = this.showAllProcesses ? 'All Processes' : 'Node Processes'
    this.toastBar.setContent(defaultText)
    this.toastBar.style.fg = 'white'
    this.toastBar.style.bg = 'black'
    this.toastBar.style.bold = true
    this.screen.render()
  }

  /**
   * Copy text to clipboard using native system commands
   */
  private async copyToClipboard(text: string): Promise<void> {
    const platform = process.platform

    let command: string
    if (platform === 'darwin') {
      // macOS
      command = 'pbcopy'
    } else if (platform === 'win32') {
      // Windows
      command = 'clip'
    } else {
      // Linux - try xclip first, fall back to xsel
      try {
        await execAsync('which xclip')
        command = 'xclip -selection clipboard'
      } catch {
        try {
          await execAsync('which xsel')
          command = 'xsel --clipboard --input'
        } catch {
          throw new Error(
            'No clipboard utility found. Please install xclip or xsel.'
          )
        }
      }
    }

    return new Promise((resolve, reject) => {
      const proc = exec(command, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })

      if (proc.stdin) {
        proc.stdin.write(text)
        proc.stdin.end()
      } else {
        reject(new Error('Failed to access clipboard process stdin'))
      }
    })
  }

  private async copySelectedProcessToClipboard() {
    const selectedRow = (this.table as any).selected - 1

    if (selectedRow < 0 || selectedRow >= this.displayedProcesses.length) {
      this.showToast('⚠ No process selected', 'warning', 2000)
      return
    }

    const p = this.displayedProcesses[selectedRow]
    const clipboardText = `PID: ${p.pid} | Name: ${p.name} | Command: ${p.cmd}`

    try {
      await this.copyToClipboard(clipboardText)
      this.showToast('✓ Copied process to clipboard', 'success', 2000)
    } catch (error) {
      this.showToast(
        `✗ Failed to copy: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
        3000
      )
    }
  }

  private enterFilterMode() {
    this.filterMode = true
    this.filterQuery = ''

    this.filterBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
        bg: 'black',
      },
      label: ' {bold}{yellow-fg}Filter Mode{/yellow-fg}{/bold} ',
      content: '{yellow-fg}Type to filter (ESC to exit):{/yellow-fg} ',
      tags: true,
    })

    this.table.top = 3
    this.table.height = '100%-6'

    this.screen.render()
  }

  private exitFilterMode() {
    this.filterMode = false
    this.filterQuery = ''

    if (this.filterBox) {
      this.filterBox.destroy()
      this.filterBox = null
    }

    this.table.top = 0
    this.table.height = '100%-3'

    this.refreshProcessList()
  }

  private handleFilterInput(ch: string, key: any) {
    if (key.name === 'escape') {
      this.exitFilterMode()
      return
    }

    if (key.name === 'backspace') {
      this.filterQuery = this.filterQuery.slice(0, -1)
    } else if (key.name === 'space') {
      this.filterQuery += ' '
    } else if (ch && ch.length === 1 && !key.ctrl && !key.meta) {
      this.filterQuery += ch
    } else {
      return
    }

    if (this.filterBox) {
      this.filterBox.setContent(
        `{yellow-fg}Type to filter (ESC to exit):{/yellow-fg} ${this.filterQuery}`
      )
    }

    this.refreshProcessList()
  }

  private filterProcesses(processes: ProcessInfo[]): ProcessInfo[] {
    if (!this.filterQuery) return processes

    const lowerQuery = this.filterQuery.toLowerCase()

    return processes.filter((p) => {
      const pidStr = p.pid.toString()
      const lowerName = p.name.toLowerCase()
      const lowerCmd = p.cmd.toLowerCase()

      // Exact substring match (highest priority)
      if (
        pidStr.includes(this.filterQuery) ||
        lowerName.includes(lowerQuery) ||
        lowerCmd.includes(lowerQuery)
      ) {
        return true
      }

      // Word boundary match (e.g., "node" matches "node-server")
      const nameWords = lowerName.split(/[\s\-_.]/)
      const cmdWords = lowerCmd.split(/[\s\-_./]/)

      for (const word of [...nameWords, ...cmdWords]) {
        if (word.startsWith(lowerQuery)) {
          return true
        }
      }

      // Tight fuzzy match - only if characters are reasonably close together
      const maxGap = 3 // Maximum characters between matches
      const searchText = `${pidStr} ${lowerName} ${lowerCmd}`

      let queryIndex = 0
      let lastMatchIndex = -1

      for (
        let i = 0;
        i < searchText.length && queryIndex < lowerQuery.length;
        i++
      ) {
        if (searchText[i] === lowerQuery[queryIndex]) {
          if (lastMatchIndex !== -1 && i - lastMatchIndex > maxGap) {
            return false
          }
          lastMatchIndex = i
          queryIndex++
        }
      }

      return queryIndex === lowerQuery.length
    })
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

  private async getProcesses(): Promise<ProcessInfo[]> {
    const allProcesses = await psList()

    const filteredProcesses = this.showAllProcesses
      ? allProcesses
      : allProcesses.filter(
          (p) =>
            p.name.toLowerCase().includes('node') ||
            p.cmd?.toLowerCase().includes('node')
        )

    return filteredProcesses.map((p) => ({
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

      this.processes = await this.getProcesses()

      const filteredProcesses = this.filterProcesses(this.processes)
      const sortedProcesses = this.sortProcesses(filteredProcesses)

      this.displayedProcesses = sortedProcesses

      const currentPid = process.pid

      // Generate table headers with sort indicators
      const arrow = this.sortOrder === 'asc' ? '↑' : '↓'
      const headers = [
        this.sortColumn === 'pid' ? `PID ${arrow}` : 'PID',
        this.sortColumn === 'name' ? `Name ${arrow}` : 'Name',
        this.sortColumn === 'cpu' ? `CPU % ${arrow}` : 'CPU %',
        this.sortColumn === 'memory' ? `Memory ${arrow}` : 'Memory',
        'Command',
      ]

      const tableData = [
        headers,
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

      const totalProcessCount = this.processes.length
      const displayedProcessCount = sortedProcesses.length
      const totalMemory = this.processes.reduce((sum, p) => sum + p.memory, 0)

      let sortIndicator = ''
      if (this.sortColumn !== 'none') {
        const arrow = this.sortOrder === 'asc' ? '↑' : '↓'
        const columnName =
          this.sortColumn === 'cpu'
            ? 'CPU'
            : this.sortColumn === 'memory'
              ? 'Mem'
              : this.sortColumn === 'name'
                ? 'Name'
                : this.sortColumn
        sortIndicator = ` | {cyan-fg}Sort:{/cyan-fg} {bold}${columnName}${arrow}{/bold}`
      }

      let filterIndicator = ''
      if (this.filterMode && this.filterQuery) {
        filterIndicator = ` | {yellow-fg}Filtered: ${displayedProcessCount}/${totalProcessCount}{/yellow-fg}`
      }

      const processTypeLabel = this.showAllProcesses ? '' : 'Node '
      const processCountDisplay =
        this.filterMode && this.filterQuery
          ? `{bold}{cyan-fg}${displayedProcessCount}{/cyan-fg}{/bold}`
          : `{bold}{cyan-fg}${totalProcessCount}{/cyan-fg}{/bold}`
      const statusMessage = `{green-fg}✓{/green-fg} Found ${processCountDisplay} ${processTypeLabel}processes | Total Memory: {bold}{yellow-fg}${this.formatBytes(totalMemory)}{/yellow-fg}{/bold}${sortIndicator}${filterIndicator} | Last update: {gray-fg}${new Date().toLocaleTimeString()}{/gray-fg}`

      this.statusBar.setContent(statusMessage)

      this.screen.render()
    } catch (error) {
      this.statusBar.setContent(
        `{red-fg}✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}{/red-fg}`
      )
      this.screen.render()
    }
  }

  private killSelectedProcess() {
    const selectedRow = (this.table as any).selected - 1

    if (selectedRow < 0 || selectedRow >= this.displayedProcesses.length) {
      this.statusBar.setContent('{yellow-fg}⚠ No process selected{/yellow-fg}')
      this.screen.render()
      return
    }

    const process = this.displayedProcesses[selectedRow]
    this.showKillConfirmation(process)
  }

  private showKillConfirmation(process: ProcessInfo) {
    const modalId = 'kill-confirmation'
    this.modalStack.push(modalId)

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
        `{green-fg}✓ Successfully killed process ${process.pid} (${process.name}){/green-fg}`
      )

      setTimeout(async () => {
        await this.refreshProcessList()
      }, 500)
    } catch (error) {
      this.statusBar.setContent(
        `{red-fg}✗ Failed to kill process ${process.pid}: ${error instanceof Error ? error.message : 'Unknown error'}{/red-fg}`
      )
    }

    this.screen.render()
  }

  cleanup() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }

    // Clear any active toast timeout
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout)
      this.toastTimeout = null
    }

    // Restore original console functions
    console.error = this.originalConsoleError
    console.log = this.originalConsoleLog

    // Remove event listener
    if (this.helpBarClickHandler) {
      this.helpBar.removeListener('click', this.helpBarClickHandler)
    }

    // Clean up filter box if active
    if (this.filterBox) {
      this.filterBox.destroy()
      this.filterBox = null
    }

    // Destroy screen (also destroys all child widgets)
    this.screen.destroy()

    // Clear process arrays
    this.processes = []
    this.displayedProcesses = []
  }

  async start() {
    await this.refreshProcessList()

    this.screen.render()
  }
}
