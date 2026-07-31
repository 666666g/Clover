import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

type SpawnSyncLike = typeof spawnSync

export type WindowsShellKind = 'git-bash' | 'pwsh' | 'powershell' | 'cmd'

export type WindowsShellCandidate = {
  kind: WindowsShellKind
  file: string
  commandArgs: readonly string[]
  terminalArgs: readonly string[]
}

export type WindowsShellResolverOptions = {
  lookup?: SpawnSyncLike
  fileExists?: (path: string) => boolean
  env?: NodeJS.ProcessEnv
}

export const WINDOWS_POWERSHELL_COMMAND_ARGS = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-Command'
] as const

const GIT_BASH_COMMAND_ARGS = ['-lc'] as const
const GIT_BASH_TERMINAL_ARGS = ['--login', '-i'] as const
const CMD_COMMAND_ARGS = ['/d', '/s', '/c'] as const

let cachedDefaultCandidates: readonly WindowsShellCandidate[] | undefined

function lookupResults(lookup: SpawnSyncLike, command: string, args: string[]): string[] {
  try {
    const result = lookup(command, args, { encoding: 'utf8' })
    if (result.status !== 0 || typeof result.stdout !== 'string') return []
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function pathExists(fileExists: (path: string) => boolean, candidate: string): boolean {
  try {
    return fileExists(candidate)
  } catch {
    return false
  }
}

function normalizedPath(candidate: string): string {
  const trimmed = candidate.trim().replace(/^"|"$/g, '')
  if (!trimmed) return ''
  return win32.normalize(trimmed).replace(/[\\/]+$/, '')
}

function pathKey(candidate: string): string {
  return normalizedPath(candidate).toLowerCase()
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of paths) {
    const path = normalizedPath(raw)
    if (!path) continue
    const key = pathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(path)
  }
  return unique
}

function isWindowsAppsAlias(candidate: string): boolean {
  return /(?:^|[\\/])windowsapps(?:[\\/]|$)/i.test(candidate)
}

export function windowsSystemRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.SystemRoot || env.windir || env.SYSTEMROOT || 'C:\\Windows'
}

export function windowsComSpec(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ComSpec || env.COMSPEC
  return configured && win32.isAbsolute(configured)
    ? configured
    : win32.join(windowsSystemRoot(env), 'System32', 'cmd.exe')
}

function gitRootFromExecutable(candidate: string, executable: 'bash.exe' | 'git.exe'): string | null {
  const normalized = normalizedPath(candidate)
  const lower = normalized.toLowerCase()
  const suffixes = executable === 'bash.exe'
    ? [win32.join('bin', executable), win32.join('usr', 'bin', executable)]
    : [win32.join('cmd', executable)]
  for (const suffix of suffixes) {
    const marker = `\\${suffix.toLowerCase()}`
    if (lower.endsWith(marker)) return normalized.slice(0, -marker.length)
  }
  return null
}

function hasGitForWindowsMarker(root: string, fileExists: (path: string) => boolean): boolean {
  return [
    win32.join(root, 'git-bash.exe'),
    win32.join(root, 'cmd', 'git.exe')
  ].some((candidate) => pathExists(fileExists, candidate))
}

function registryInstallRoots(lookup: SpawnSyncLike, env: NodeJS.ProcessEnv): string[] {
  const reg = win32.join(windowsSystemRoot(env), 'System32', 'reg.exe')
  const keys = [
    'HKCU\\Software\\GitForWindows',
    'HKLM\\Software\\GitForWindows',
    'HKLM\\Software\\WOW6432Node\\GitForWindows'
  ]
  const roots: string[] = []
  for (const key of keys) {
    for (const line of lookupResults(lookup, reg, ['query', key, '/v', 'InstallPath'])) {
      const match = line.match(/^InstallPath\s+REG_\w+\s+(.+)$/i)
      if (match?.[1]) roots.push(match[1])
    }
  }
  return uniquePaths(roots)
}

function standardGitRoots(env: NodeJS.ProcessEnv): string[] {
  const localAppData = env.LOCALAPPDATA || env.LocalAppData
  const programFiles = env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
  const roots = [
    localAppData ? win32.join(localAppData, 'Programs', 'Git') : '',
    env.ProgramW6432 || env.PROGRAMW6432
      ? win32.join(env.ProgramW6432 || env.PROGRAMW6432 || '', 'Git')
      : '',
    win32.join(programFiles, 'Git'),
    win32.join(programFilesX86, 'Git')
  ]
  return uniquePaths(roots)
}

function gitBashFiles(options: Required<WindowsShellResolverOptions>): string[] {
  const { lookup, fileExists, env } = options
  const gitRootsFromPath = lookupResults(lookup, 'where', ['git.exe'])
    .filter((candidate) => !isWindowsAppsAlias(candidate))
    .map((candidate) => gitRootFromExecutable(candidate, 'git.exe'))
    .filter((root): root is string => Boolean(root))
  const knownPathRoots = new Set(gitRootsFromPath.map(pathKey))
  const directBashes: string[] = []
  const directRoots: string[] = []

  for (const candidate of lookupResults(lookup, 'where', ['bash.exe'])) {
    if (isWindowsAppsAlias(candidate) || !pathExists(fileExists, candidate)) continue
    const root = gitRootFromExecutable(candidate, 'bash.exe')
    if (!root) continue
    if (!knownPathRoots.has(pathKey(root)) && !hasGitForWindowsMarker(root, fileExists)) continue
    directBashes.push(candidate)
    directRoots.push(root)
  }

  const roots = uniquePaths([
    ...directRoots,
    ...gitRootsFromPath,
    ...registryInstallRoots(lookup, env),
    ...standardGitRoots(env)
  ])
  const candidates = [...directBashes]
  for (const root of roots) {
    candidates.push(win32.join(root, 'bin', 'bash.exe'))
    candidates.push(win32.join(root, 'usr', 'bin', 'bash.exe'))
  }
  return uniquePaths(candidates).filter((candidate) => pathExists(fileExists, candidate))
}

function shellCandidate(kind: WindowsShellKind, file: string): WindowsShellCandidate {
  switch (kind) {
    case 'git-bash':
      return { kind, file, commandArgs: GIT_BASH_COMMAND_ARGS, terminalArgs: GIT_BASH_TERMINAL_ARGS }
    case 'pwsh':
    case 'powershell':
      return {
        kind,
        file,
        commandArgs: WINDOWS_POWERSHELL_COMMAND_ARGS,
        terminalArgs: ['-NoLogo']
      }
    case 'cmd':
      return { kind, file, commandArgs: CMD_COMMAND_ARGS, terminalArgs: [] }
  }
}

function resolveUncached(options: Required<WindowsShellResolverOptions>): WindowsShellCandidate[] {
  const { lookup, fileExists, env } = options
  const candidates: WindowsShellCandidate[] = gitBashFiles(options)
    .map((file) => shellCandidate('git-bash', file))
  const programFilesRoots = uniquePaths([
    env.ProgramW6432 || env.PROGRAMW6432 || '',
    env.ProgramFiles || env.PROGRAMFILES || '',
    env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'] || ''
  ])
  for (const root of programFilesRoots) {
    const pwsh = win32.join(root, 'PowerShell', '7', 'pwsh.exe')
    if (pathExists(fileExists, pwsh)) candidates.push(shellCandidate('pwsh', pwsh))
  }
  for (const pwsh of lookupResults(lookup, 'where', ['pwsh.exe'])) {
    if (!isWindowsAppsAlias(pwsh)) candidates.push(shellCandidate('pwsh', pwsh))
  }

  const windowsPowerShell = win32.join(
    windowsSystemRoot(env),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  if (pathExists(fileExists, windowsPowerShell)) {
    candidates.push(shellCandidate('powershell', windowsPowerShell))
  }
  for (const powershell of lookupResults(lookup, 'where', ['powershell.exe'])) {
    if (!isWindowsAppsAlias(powershell)) candidates.push(shellCandidate('powershell', powershell))
  }

  candidates.push(shellCandidate('cmd', windowsComSpec(env)))
  candidates.push(shellCandidate('cmd', win32.join(windowsSystemRoot(env), 'System32', 'cmd.exe')))

  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = pathKey(candidate.file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function resolveWindowsShellCandidates(
  options: WindowsShellResolverOptions = {}
): readonly WindowsShellCandidate[] {
  const usesProcessDefaults = options.lookup === undefined &&
    options.fileExists === undefined &&
    options.env === undefined
  if (usesProcessDefaults && cachedDefaultCandidates) return cachedDefaultCandidates

  const resolved = resolveUncached({
    lookup: options.lookup ?? spawnSync,
    fileExists: options.fileExists ?? existsSync,
    env: options.env ?? process.env
  })
  if (usesProcessDefaults) cachedDefaultCandidates = resolved
  return resolved
}

export function resolveWindowsGitBashCandidates(
  options: WindowsShellResolverOptions = {}
): readonly WindowsShellCandidate[] {
  return resolveWindowsShellCandidates(options).filter((candidate) => candidate.kind === 'git-bash')
}
