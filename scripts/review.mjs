import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Review resumes the selected target; it never selects the invoking checkout.
const reviewHome = process.env.APPLYTRACK_REVIEW_HOME || path.join(homedir(), 'Documents', 'ChatGPT', 'ApplyTrack', 'review')
const launcher = path.join(reviewHome, 'launcher.mjs')
if (!existsSync(launcher)) {
  console.error(`Local review tooling is missing: ${launcher}\nInstall the workspace review tooling there, or set APPLYTRACK_REVIEW_HOME to its directory. See docs/local-review.md. npm run dev still develops this checkout normally.`)
  process.exitCode = 1
} else {
  const child = spawn(process.execPath, [launcher, 'start'], { stdio: 'inherit', windowsHide: true })
  child.on('error', error => { console.error(`Could not start local review: ${error.message}`); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
