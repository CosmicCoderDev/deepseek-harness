/** Launch the packaged app with an empty Harness home so workspace links cannot mask missing files. */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const productName = 'DeepSeek Harness'
const appPath = resolve(process.argv[2] ?? join('dist', `mac-${process.arch}`, `${productName}.app`))
const executable = join(appPath, 'Contents', 'MacOS', productName)
const isolatedHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))

try {
  const dshHome = join(isolatedHome, '.dsh')
  await mkdir(dshHome, { recursive: true })
  await writeFile(join(dshHome, 'desktop-settings.json'), '{corrupt-settings}\n')
  const result = await launch(executable, isolatedHome)
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (result.code !== 0) {
    throw new Error(`packaged desktop smoke test exited with code ${String(result.code)}`)
  }
  if (!result.stdout.includes('[desktop] packaged smoke test passed')) {
    throw new Error('packaged desktop smoke test did not reach Host readiness')
  }
  const settingsFiles = await readdir(dshHome)
  if (!settingsFiles.some(name => name.startsWith('desktop-settings.corrupt-'))) {
    throw new Error('packaged desktop smoke test did not preserve corrupt settings')
  }
} finally {
  await rm(isolatedHome, { recursive: true, force: true })
}

function launch(command, home) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, ['--smoke-test'], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        DSH_HOME: join(home, '.dsh'),
        ELECTRON_ENABLE_LOGGING: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('packaged desktop smoke test timed out after 120 seconds'))
    }, 120_000)
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolveResult({ code, stdout, stderr })
    })
  })
}
