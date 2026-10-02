const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const RUNTIME_DIR = path.join(ROOT, 'runtime')
const VERSION = 'v1.1.1'
const BASE_URL = `https://github.com/334456777/WeFlow/releases/download/${VERSION}`

const ASSETS = {
  'win32-x64': 'weflow-v1.1.1-windows-x64.zip',
  'win32-arm64': 'weflow-v1.1.1-windows-arm64.zip',
  'darwin-arm64': 'weflow-v1.1.1-macos-arm64.tar.gz',
  'darwin-x64': 'weflow-v1.1.1-macos-x64.tar.gz',
  'linux-x64': 'weflow-v1.1.1-linux-x64.tar.gz',
  'linux-arm64': 'weflow-v1.1.1-linux-arm64.tar.gz',
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

async function main() {
  const key = `${process.platform}-${process.arch}`
  const asset = ASSETS[key]
  if (!asset) {
    console.error(`暂不支持当前平台：${key}`)
    process.exit(1)
  }

  const binName = process.platform === 'win32' ? 'weflow.exe' : 'weflow'
  const dest = path.join(RUNTIME_DIR, binName)
  if (fs.existsSync(dest)) {
    console.log(`weflow 已存在：${dest}`)
    return
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true })
  const url = `${BASE_URL}/${asset}`
  console.log(`正在下载 ${asset} ...`)
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`下载失败：HTTP ${response.status}`)
    process.exit(1)
  }

  const archivePath = path.join(os.tmpdir(), asset)
  fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))

  const extractDir = path.join(os.tmpdir(), `weflow-extract-${Date.now()}`)
  fs.mkdirSync(extractDir, { recursive: true })

  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${extractDir}' -Force`],
      { stdio: 'inherit' }
    )
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' })
  }

  const found = findFile(extractDir, binName)
  if (!found) {
    console.error('未在解压结果中找到 weflow 可执行文件')
    process.exit(1)
  }

  fs.copyFileSync(found, dest)
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755)
  console.log(`weflow 已就绪：${dest}`)
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error)
  process.exit(1)
})
