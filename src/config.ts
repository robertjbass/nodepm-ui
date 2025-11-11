import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type Config = {
  openAiApiKey?: string
  version?: string
}

export function getConfigPath(): string {
  const homeDir = os.homedir()
  const configDir = path.join(homeDir, '.config', 'nodepm')
  return path.join(configDir, 'config.json')
}

function ensureConfigDir(): void {
  const configPath = getConfigPath()
  const configDir = path.dirname(configPath)
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
}

export function loadConfig(): Config {
  try {
    const configPath = getConfigPath()
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch {
    // Config file might be corrupted or unreadable
  }
  return {}
}

export function saveConfig(config: Config): void {
  ensureConfigDir()
  const configPath = getConfigPath()
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
