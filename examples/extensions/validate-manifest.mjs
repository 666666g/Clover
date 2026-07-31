import { access, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { parseExtensionManifest } from '../../packages/extension-api/dist/index.js'

const manifestPath = resolve(process.argv[2] ?? 'kun-extension.json')
const extensionRoot = dirname(manifestPath)
const manifest = parseExtensionManifest(JSON.parse(await readFile(manifestPath, 'utf8')))

const requiredFiles = new Set()
if (manifest.main) requiredFiles.add(manifest.main)
if (manifest.browser) requiredFiles.add(manifest.browser)

for (const key of [
  'views.leftSidebar',
  'views.rightSidebar',
  'views.auxiliaryPanel',
  'views.editorTab',
  'views.fullPage',
  'message.resultPreviews'
]) {
  for (const contribution of manifest.contributes[key]) requiredFiles.add(contribution.entry)
}
for (const contribution of manifest.contributes.hostContentScripts) {
  for (const script of contribution.scripts) requiredFiles.add(script)
  for (const style of contribution.styles) requiredFiles.add(style)
}

for (const relativePath of requiredFiles) {
  const absolutePath = resolve(extensionRoot, relativePath)
  const packageRelativePath = relative(extensionRoot, absolutePath)
  if (packageRelativePath.startsWith('..') || isAbsolute(packageRelativePath)) {
    throw new Error(`Manifest resource escapes the extension root: ${relativePath}`)
  }
  await access(absolutePath)
  if (!(await stat(absolutePath)).isFile()) {
    throw new Error(`Manifest resource is not a file: ${relativePath}`)
  }
}

console.log(
  `Validated ${manifest.publisher}.${manifest.name}@${manifest.version} with ${requiredFiles.size} built resources`
)
