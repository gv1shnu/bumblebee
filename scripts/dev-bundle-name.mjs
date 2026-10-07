// In dev, the app runs inside node_modules/electron's stock Electron.app, so macOS shows
// "Electron" in the Dock and menu bar. Rename that bundle to match the packaged app: the
// Dock reads the bundle's folder name, the menu bar reads CFBundleName.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const NAME = 'Bumblebee'

if (process.platform === 'darwin') {
  const electronDir = dirname(createRequire(import.meta.url).resolve('electron/package.json'))
  const stock = join(electronDir, 'dist', 'Electron.app')
  const renamed = join(electronDir, 'dist', `${NAME}.app`)
  if (existsSync(stock) && !existsSync(renamed)) renameSync(stock, renamed)

  // electron/index.js locates the binary through path.txt.
  const pathFile = join(electronDir, 'path.txt')
  writeFileSync(pathFile, readFileSync(pathFile, 'utf8').replace(/^Electron\.app\//, `${NAME}.app/`))

  const plist = join(renamed, 'Contents', 'Info.plist')
  if (existsSync(plist)) {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('plutil', ['-replace', key, '-string', NAME, plist])
    }
  }
}
