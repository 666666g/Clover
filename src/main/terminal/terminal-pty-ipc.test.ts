import { describe, expect, it } from 'vitest'
import { resolveTerminalShellCandidates } from './terminal-pty-ipc'

function lookup(results: Record<string, string>) {
  return ((command: string, args: string[]) => {
    const stdout = results[`${command} ${args.join(' ')}`] ?? ''
    return { status: stdout ? 0 : 1, stdout }
  }) as never
}

describe('terminal shell resolution', () => {
  it('opens Git Bash interactively before Windows shell fallbacks', () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const candidates = resolveTerminalShellCandidates('win32', {
      lookup: lookup({
        'where git.exe': 'C:\\Program Files\\Git\\cmd\\git.exe\r\n',
        'where bash.exe': `${bash}\r\n`,
        'where powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n'
      }),
      fileExists: (path) => path === bash,
      env: { SystemRoot: 'C:\\Windows' }
    })

    expect(candidates[0]).toEqual({
      file: bash,
      args: ['--login', '-i'],
      gitBash: true
    })
    expect(candidates.some((candidate) => candidate.file.endsWith('cmd.exe'))).toBe(true)
  })

  it('keeps the requested POSIX platform and environment fallback', () => {
    expect(resolveTerminalShellCandidates('darwin', { env: { SHELL: '/opt/homebrew/bin/fish' } })).toEqual([
      { file: '/opt/homebrew/bin/fish', args: [], gitBash: false }
    ])
    expect(resolveTerminalShellCandidates('linux', { env: {} })).toEqual([
      { file: '/bin/bash', args: [], gitBash: false }
    ])
  })
})
