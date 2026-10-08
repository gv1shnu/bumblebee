// electron-builder afterSign hook. Without a Developer ID (mac.identity is null), electron-builder
// leaves the app with a broken bundle signature, which macOS reports as "damaged". Re-sign the
// whole bundle ad-hoc so it verifies. With a real identity configured, this does nothing.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  let info = ''
  try { info = execFileSync('codesign', ['-dv', app], { stdio: ['ignore', 'pipe', 'pipe'] }).toString() } catch (e) { info = String(e.stderr ?? '') }
  if (/Authority=Developer ID/.test(info)) return
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${app}`)
}
