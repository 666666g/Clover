import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'

const sourceRoot = join(process.cwd(), 'src')
const outputRoot = join(process.cwd(), 'dist')
const staticExtensions = new Set(['.css', '.html', '.svg'])

async function copyStaticAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name)
    if (entry.isDirectory()) {
      await copyStaticAssets(source)
      continue
    }
    if (!entry.isFile() || !staticExtensions.has(extname(entry.name))) continue
    const target = join(outputRoot, relative(sourceRoot, source))
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
}

await copyStaticAssets(sourceRoot)
