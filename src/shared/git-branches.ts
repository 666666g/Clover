export type GitBranchRow = {
  name: string
  current: boolean
}

export type GitBranchesResult =
  | {
      ok: true
      repositoryRoot: string
      currentBranch: string | null
      branches: GitBranchRow[]
      dirtyCount: number
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitWorktreeCheckoutResult =
  | {
      ok: true
      repositoryRoot: string
      sourceRepositoryRoot: string
      worktreePath: string
      currentBranch: string | null
      branches: GitBranchRow[]
      dirtyCount: number
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitBranchWorktreeRow = {
  path: string
  branch: string | null
  head: string
}

export type GitBranchWorktreesResult =
  | {
      ok: true
      repositoryRoot: string
      worktreeRoot: string
      worktrees: GitBranchWorktreeRow[]
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }
