import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  isFileWithinDirectory,
  relativeWorkspacePath,
  type ComposerFileReference
} from './composer-file-references'

const FILE_MENTION_TEXT_EXTENSIONS = new Set([
  '.astro',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.dart',
  '.env',
  '.fish',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.lock',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])
const FILE_MENTION_TEXT_NAMES = new Set([
  '.env',
  '.gitignore',
  'dockerfile',
  'makefile',
  'package-lock.json',
  'pnpm-lock.yaml',
  'readme'
])
const FILE_MENTION_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
])
const FILE_MENTION_MAX_DEPTH = 6
const FILE_MENTION_MAX_DIRECTORIES = 140
const FILE_MENTION_MAX_FILES = 1200
const FILE_MENTION_MAX_DIRECTORY_SUGGESTIONS = 400
const FILE_MENTION_CACHE_TTL_MS = 30_000

export type WorkspaceFileIndex = {
  files: ComposerFileReference[]
  directories: ComposerFileReference[]
  loadedAt: number
}

const workspaceFileIndexCache = new Map<string, WorkspaceFileIndex | Promise<WorkspaceFileIndex>>()

export function isMentionableWorkspaceFile(entry: WorkspaceEntry): boolean {
  if (entry.type !== 'file') return false
  const name = entry.name.toLowerCase()
  if (FILE_MENTION_TEXT_NAMES.has(name)) return true
  if (!entry.ext) return false
  return FILE_MENTION_TEXT_EXTENSIONS.has(entry.ext.toLowerCase())
}

function referenceFromEntry(
  entry: WorkspaceEntry,
  workspaceRoot: string,
  type: 'file' | 'directory'
): ComposerFileReference {
  return {
    path: entry.path,
    relativePath: relativeWorkspacePath(entry.path, workspaceRoot),
    name: entry.name,
    type
  }
}

async function buildWorkspaceFileIndex(root: string): Promise<WorkspaceFileIndex> {
  const files: ComposerFileReference[] = []
  const directories: ComposerFileReference[] = []
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  let visitedDirectories = 0

  while (
    queue.length > 0 &&
    visitedDirectories < FILE_MENTION_MAX_DIRECTORIES &&
    files.length < FILE_MENTION_MAX_FILES
  ) {
    const current = queue.shift()
    if (!current) break
    visitedDirectories += 1
    const result = await window.kunGui.listWorkspaceDirectory({ workspaceRoot: root, path: current.path })
    if (!result.ok) continue

    for (const entry of result.entries) {
      if (entry.type === 'directory') {
        if (FILE_MENTION_IGNORED_DIRS.has(entry.name.toLowerCase())) continue
        if (directories.length < FILE_MENTION_MAX_DIRECTORY_SUGGESTIONS) {
          directories.push(referenceFromEntry(entry, root, 'directory'))
        }
        if (current.depth < FILE_MENTION_MAX_DEPTH) {
          queue.push({ path: entry.path, depth: current.depth + 1 })
        }
        continue
      }
      if (isMentionableWorkspaceFile(entry)) {
        files.push(referenceFromEntry(entry, root, 'file'))
        if (files.length >= FILE_MENTION_MAX_FILES) break
      }
    }
  }

  return { files, directories, loadedAt: Date.now() }
}

export async function loadWorkspaceFileIndex(workspaceRoot: string): Promise<WorkspaceFileIndex> {
  const root = workspaceRoot.trim()
  const cached = workspaceFileIndexCache.get(root)
  if (cached && !(cached instanceof Promise) && Date.now() - cached.loadedAt < FILE_MENTION_CACHE_TTL_MS) {
    return cached
  }
  if (cached instanceof Promise) return cached

  const task = buildWorkspaceFileIndex(root)
  workspaceFileIndexCache.set(root, task)
  try {
    const result = await task
    workspaceFileIndexCache.set(root, result)
    return result
  } catch (error) {
    workspaceFileIndexCache.delete(root)
    throw error
  }
}

/** All indexed files that live inside the given workspace-relative directory. */
export function filesUnderDirectory(
  files: ComposerFileReference[],
  dirRelativePath: string
): ComposerFileReference[] {
  return files.filter((file) => isFileWithinDirectory(file.relativePath, dirRelativePath))
}
