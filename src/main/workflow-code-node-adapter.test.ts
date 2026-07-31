import { describe, expect, it } from 'vitest'
import { resolveWorkflowBashBin } from './workflow-code-node-adapter'

function lookup(results: Record<string, string>) {
  return ((command: string, args: string[]) => {
    const stdout = results[`${command} ${args.join(' ')}`] ?? ''
    return { status: stdout ? 0 : 1, stdout }
  }) as never
}

describe('workflow Bash resolution', () => {
  it('keeps the explicit workflow override above automatic Git Bash discovery', () => {
    expect(resolveWorkflowBashBin('win32', {
      WORKFLOW_BASH_BIN: 'D:\\Managed\\bash.exe'
    }, {
      lookup: lookup({}),
      fileExists: () => false
    })).toBe('D:\\Managed\\bash.exe')
  })

  it('uses Git Bash on Windows and reports bare bash when it is unavailable', () => {
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(resolveWorkflowBashBin('win32', { SystemRoot: 'C:\\Windows' }, {
      lookup: lookup({ 'where git.exe': 'C:\\Program Files\\Git\\cmd\\git.exe\r\n' }),
      fileExists: (path) => path === bash
    })).toBe(bash)
    expect(resolveWorkflowBashBin('win32', { SystemRoot: 'C:\\Windows' }, {
      lookup: lookup({}),
      fileExists: () => false
    })).toBe('bash')
  })
})
