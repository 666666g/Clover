import { describe, expect, it } from 'vitest'
import {
  resolveWindowsGitBashCandidates,
  resolveWindowsShellCandidates
} from './windows-shell-resolver.js'

function lookup(results: Record<string, string>) {
  return ((command: string, args: string[]) => {
    const stdout = results[`${command} ${args.join(' ')}`] ?? ''
    return { status: stdout ? 0 : 1, stdout }
  }) as never
}

describe('Windows shell resolution', () => {
  it('prefers PATH-selected Git for Windows Bash over PowerShell', () => {
    const bash = 'D:\\Dev Tools\\Git\\bin\\bash.exe'
    const candidates = resolveWindowsShellCandidates({
      lookup: lookup({
        'where git.exe': 'D:\\Dev Tools\\Git\\cmd\\git.exe\r\n',
        'where bash.exe': `${bash}\r\n`,
        'where pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n'
      }),
      fileExists: (path) => path === bash,
      env: { SystemRoot: 'C:\\Windows' }
    })

    expect(candidates[0]).toEqual({
      kind: 'git-bash',
      file: bash,
      commandArgs: ['-lc'],
      terminalArgs: ['--login', '-i']
    })
    expect(candidates.some((candidate) => candidate.kind === 'pwsh')).toBe(true)
  })

  it('finds a custom Git installation from the Git for Windows registry key', () => {
    const root = 'E:\\Portable Apps\\Git'
    const bash = `${root}\\bin\\bash.exe`
    const reg = 'C:\\Windows\\System32\\reg.exe'
    const candidates = resolveWindowsGitBashCandidates({
      lookup: lookup({
        [`${reg} query HKCU\\Software\\GitForWindows /v InstallPath`]: [
          'HKEY_CURRENT_USER\\Software\\GitForWindows',
          `    InstallPath    REG_SZ    ${root}`
        ].join('\r\n')
      }),
      fileExists: (path) => path === bash,
      env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }
    })

    expect(candidates.map((candidate) => candidate.file)).toEqual([bash])
  })

  it('checks per-user and machine standard locations in stable order', () => {
    const local = 'C:\\Users\\demo\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'
    const machine = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const candidates = resolveWindowsGitBashCandidates({
      lookup: lookup({}),
      fileExists: (path) => path === local || path === machine,
      env: {
        LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local',
        PROGRAMFILES: 'C:\\Program Files',
        SystemRoot: 'C:\\Windows'
      }
    })

    expect(candidates.map((candidate) => candidate.file)).toEqual([local, machine])
  })

  it('ignores WindowsApps and legacy Windows bash aliases', () => {
    const pwsh = 'C:\\Tools\\PowerShell\\pwsh.exe'
    const candidates = resolveWindowsShellCandidates({
      lookup: lookup({
        'where bash.exe': [
          'C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe',
          'C:\\Windows\\System32\\bash.exe'
        ].join('\r\n'),
        'where pwsh.exe': `${pwsh}\r\n`
      }),
      fileExists: () => false,
      env: { SystemRoot: 'C:\\Windows' }
    })

    expect(candidates[0]?.kind).toBe('pwsh')
    expect(candidates.some((candidate) => candidate.kind === 'git-bash')).toBe(false)
  })

  it('deduplicates case-insensitive paths and keeps absolute cmd fallbacks', () => {
    const candidates = resolveWindowsShellCandidates({
      lookup: lookup({
        'where pwsh.exe': [
          'C:\\Tools\\PowerShell\\pwsh.exe',
          'c:\\tools\\powershell\\PWSH.EXE'
        ].join('\r\n')
      }),
      fileExists: () => false,
      env: { SystemRoot: 'C:\\Windows', ComSpec: 'D:\\Windows\\System32\\cmd.exe' }
    })

    expect(candidates.filter((candidate) => candidate.kind === 'pwsh')).toHaveLength(1)
    expect(candidates.filter((candidate) => candidate.kind === 'cmd').map((candidate) => candidate.file)).toEqual([
      'D:\\Windows\\System32\\cmd.exe',
      'C:\\Windows\\System32\\cmd.exe'
    ])
  })

  it('does not trust a bare ComSpec command name', () => {
    const candidates = resolveWindowsShellCandidates({
      lookup: lookup({}),
      fileExists: () => false,
      env: { SystemRoot: 'E:\\Windows', ComSpec: 'cmd.exe' }
    })

    expect(candidates.filter((candidate) => candidate.kind === 'cmd').map((candidate) => candidate.file)).toEqual([
      'E:\\Windows\\System32\\cmd.exe'
    ])
  })
})
