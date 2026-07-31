import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCAFFOLD_TEMPLATES = ['node', 'webview', 'react']
export const RESERVED_PUBLISHERS = ['builtin', 'kun', 'openai', 'system']

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ID_PATTERN = /^[a-z][a-z0-9-]*$/
const PUBLISHER_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export function validateScaffoldOptions(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Scaffold options are required')
  const targetDirectory = resolve(String(options.targetDirectory ?? ''))
  const publisher = String(options.publisher ?? '')
  const name = String(options.name ?? '')
  const template = String(options.template ?? 'node')
  if (!options.targetDirectory) throw new Error('EXT_SCAFFOLD_TARGET_REQUIRED: target directory is required')
  if (!PUBLISHER_PATTERN.test(publisher) || publisher.length > 64) {
    throw new Error('EXT_SCAFFOLD_INVALID_PUBLISHER: publisher must be lowercase letters, numbers, or hyphens')
  }
  if (RESERVED_PUBLISHERS.includes(publisher)) {
    throw new Error(`EXT_SCAFFOLD_RESERVED_PUBLISHER: ${publisher} is reserved`)
  }
  if (!ID_PATTERN.test(name) || name.length > 64) {
    throw new Error('EXT_SCAFFOLD_INVALID_NAME: name must start with a lowercase letter and use letters, numbers, or hyphens')
  }
  if (!SCAFFOLD_TEMPLATES.includes(template)) {
    throw new Error(`EXT_SCAFFOLD_INVALID_TEMPLATE: choose ${SCAFFOLD_TEMPLATES.join(', ')}`)
  }
  const displayName = String(options.displayName ?? titleCase(name))
  const hasControlCharacter = [...displayName].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (displayName.length < 1 || displayName.length > 128 || hasControlCharacter) {
    throw new Error('EXT_SCAFFOLD_INVALID_DISPLAY_NAME: display name must be 1-128 characters without control characters')
  }
  return {
    targetDirectory,
    publisher,
    name,
    template,
    displayName
  }
}

export async function scaffoldExtension(options) {
  const validated = validateScaffoldOptions(options)
  await assertTargetAvailable(validated.targetDirectory)
  const parent = dirname(validated.targetDirectory)
  await mkdir(parent, { recursive: true })
  const staging = join(parent, `.create-kun-extension-${process.pid}-${Date.now()}`)
  const templateRoot = join(PACKAGE_ROOT, 'templates', validated.template)
  const replacements = new Map([
    ['{{EXTENSION_ID}}', `${validated.publisher}.${validated.name}`],
    ['{{PUBLISHER}}', validated.publisher],
    ['{{NAME}}', validated.name],
    ['"{{DISPLAY_NAME_JSON}}"', JSON.stringify(validated.displayName)],
    ['"{{HELLO_TITLE_JSON}}"', JSON.stringify(`Hello from ${validated.displayName}`)],
    ['"{{REFRESH_TITLE_JSON}}"', JSON.stringify(`Refresh ${validated.displayName}`)],
    ['{{DISPLAY_NAME_JSON}}', JSON.stringify(validated.displayName)],
    ['{{DISPLAY_NAME_HTML}}', escapeHtml(validated.displayName)],
    ['{{HELLO_TITLE_JSON}}', JSON.stringify(`Hello from ${validated.displayName}`)],
    ['{{REFRESH_TITLE_JSON}}', JSON.stringify(`Refresh ${validated.displayName}`)],
    ['{{DISPLAY_NAME}}', validated.displayName]
  ])

  try {
    await cp(templateRoot, staging, { recursive: true, errorOnExist: true })
    await renderDirectory(staging, replacements)
    await rename(staging, validated.targetDirectory)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }

  return {
    extensionId: `${validated.publisher}.${validated.name}`,
    template: validated.template,
    targetDirectory: validated.targetDirectory,
    files: await listFiles(validated.targetDirectory)
  }
}

async function assertTargetAvailable(targetDirectory) {
  try {
    await access(targetDirectory)
    throw new Error(`EXT_SCAFFOLD_TARGET_EXISTS: ${targetDirectory} already exists`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function renderDirectory(root, replacements) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = join(root, entry.name)
    if (entry.isDirectory()) {
      await renderDirectory(sourcePath, replacements)
      continue
    }
    if (!entry.isFile()) continue
    let content = await readFile(sourcePath, 'utf8')
    for (const [token, value] of replacements) content = content.replaceAll(token, value)
    const targetName = entry.name === '_gitignore' ? '.gitignore' : entry.name
    const targetPath = join(root, targetName)
    await writeFile(targetPath, content, 'utf8')
    if (targetPath !== sourcePath) await rm(sourcePath)
  }
}

async function listFiles(root) {
  const result = []
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name)
      const info = await stat(path)
      if (info.isDirectory()) await visit(path)
      else if (info.isFile()) result.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  await visit(root)
  return result.sort()
}

function titleCase(value) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character])
}
