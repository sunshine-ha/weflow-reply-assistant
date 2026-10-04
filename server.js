const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { URL } = require('node:url')

const ROOT = __dirname
const PUBLIC_DIR = path.join(ROOT, 'public')

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (!Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      process.env[match[1]] = value
    }
  }
}
loadEnvFile()

const APP_PORT = Number(process.env.PORT || 8787)
const WEFLOW_PORT = Number(process.env.WEFLOW_PORT || 5031)
const WEFLOW_TOKEN = String(process.env.WEFLOW_TOKEN || 'weflow-local-token-2026')
const WEFLOW_BASE = `http://127.0.0.1:${WEFLOW_PORT}`

function resolveWeflowExe() {
  if (process.env.WEFLOW_EXE) return String(process.env.WEFLOW_EXE)
  const runtimeDir = path.join(ROOT, 'runtime')
  return path.join(runtimeDir, process.platform === 'win32' ? 'weflow.exe' : 'weflow')
}

const WEFLOW_EXE = resolveWeflowExe()
const DEEPSEEK_API_KEY = String(process.env.DEEPSEEK_API_KEY || '')
const DEEPSEEK_MODEL = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat')
const DEEPSEEK_BASE = String(process.env.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')
const DEEPSEEK_CHAT_URL = /\/chat\/completions$/i.test(DEEPSEEK_BASE)
  ? DEEPSEEK_BASE
  : `${DEEPSEEK_BASE}/chat/completions`

let weflowProc = null

function startWeflow() {
  if (String(process.env.NO_SPAWN || '') === '1') return
  if (!fs.existsSync(WEFLOW_EXE)) {
    console.error(`未找到 weflow 可执行文件：${WEFLOW_EXE}`)
    console.error('请先运行 setup.cmd（Windows）或 setup.sh（macOS/Linux）下载它。')
    return
  }
  weflowProc = spawn(
    WEFLOW_EXE,
    ['serve', '--http', '--message-push', '--port', String(WEFLOW_PORT), '--api-token', WEFLOW_TOKEN],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  weflowProc.stdout.on('data', (chunk) => console.log('[weflow]', String(chunk).trim()))
  weflowProc.stderr.on('data', (chunk) => console.error('[weflow]', String(chunk).trim()))
  weflowProc.on('exit', () => { weflowProc = null })
}

function requestWeflow(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: WEFLOW_PORT,
        path: pathname,
        headers: { Authorization: `Bearer ${WEFLOW_TOKEN}` },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch (error) { reject(new Error(`WeFlow 返回了无法解析的数据：${String(data).slice(0, 160)}`)) }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(new Error('WeFlow 请求超时')) })
    req.end()
  })
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (error) {
        reject(new Error('请求体不是有效 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function displayNameFor(item, isGroupMember) {
  if (isGroupMember) {
    return firstNonEmpty(item.groupNickname, item.remark, item.nickname, item.displayName, item.alias) || item.wxid
  }
  return firstNonEmpty(item.remark, item.displayName, item.nickname, item.alias) || item.username
}

let contactsCache = { at: 0, map: new Map() }
const groupMembersCache = new Map()
const NAME_CACHE_TTL = 30 * 60 * 1000

async function loadContacts() {
  if (contactsCache.map.size > 0 && Date.now() - contactsCache.at < NAME_CACHE_TTL) {
    return contactsCache.map
  }
  const data = await requestWeflow('/api/v1/contacts?limit=10000')
  const map = new Map()
  for (const contact of (data && data.contacts) || []) {
    if (!contact.username) continue
    map.set(contact.username, displayNameFor(contact, false) || contact.username)
  }
  contactsCache = { at: Date.now(), map }
  return map
}

async function loadGroupMembers(chatroomId) {
  const cached = groupMembersCache.get(chatroomId)
  if (cached && Date.now() - cached.at < NAME_CACHE_TTL) return cached.map
  const data = await requestWeflow(`/api/v1/group-members?chatroomId=${encodeURIComponent(chatroomId)}`)
  const map = new Map()
  for (const member of (data && data.members) || []) {
    if (!member.wxid) continue
    map.set(member.wxid, displayNameFor(member, true) || member.wxid)
  }
  groupMembersCache.set(chatroomId, { at: Date.now(), map })
  return map
}

async function resolveSenderNames(sessionId, messages) {
  const map = new Map()
  const needed = new Set()
  for (const message of messages) {
    if (message.isSend !== 1 && message.senderUsername) needed.add(message.senderUsername)
  }
  if (needed.size === 0) return map

  const isGroup = String(sessionId || '').endsWith('@chatroom')
  try {
    if (isGroup) {
      const members = await loadGroupMembers(sessionId)
      for (const username of needed) {
        if (members.has(username)) map.set(username, members.get(username))
      }
    }
  } catch {
    // 群成员读取失败时继续用联系人缓存兜底。
  }

  try {
    const contacts = await loadContacts()
    for (const username of needed) {
      if (!map.has(username) && contacts.has(username)) map.set(username, contacts.get(username))
    }
  } catch {
    // 联系人读取失败时保留原始 wxid。
  }

  for (const username of needed) {
    if (!map.has(username)) map.set(username, username)
  }
  return map
}

function parseReplyList(raw, count) {
  const text = String(raw || '').trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const body = fenced ? fenced[1].trim() : text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1))
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, count)
      }
    } catch {
      // 数组解析失败时回退到按行拆分。
    }
  }
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*\d.、]+)\s*/, '').trim())
    .map((line) => line.replace(/^["“”']+|["“”']+$/g, '').trim())
    .filter(Boolean)
    .slice(0, count)
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function stripXmlTags(value) {
  return decodeXmlEntities(String(value || ''))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function xmlTagContent(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? stripXmlTags(match[1]) : ''
}

function buildTranscript(messages, max, senderNames) {
  const recent = (Array.isArray(messages) ? messages : []).slice(0, max).reverse()
  const names = senderNames || new Map()
  const lines = []

  for (const message of recent) {
    const localType = Number(message.localType)

    if (localType === 1) {
      const sender = message.isSend === 1
        ? '我'
        : (names.get(message.senderUsername) || message.senderUsername || '对方')
      const text = String(message.parsedContent || message.content || '').replace(/\s+/g, ' ').trim()
      if (text) lines.push(`${sender}：${text}`)
      continue
    }

    if (localType === 10000) {
      const raw = String(message.rawContent || message.content || '')
      const revoke = xmlTagContent(raw, 'content')
      if (revoke && revoke.includes('撤回')) {
        if (/你撤回/.test(revoke)) {
          lines.push('我：撤回了一条消息')
        } else {
          lines.push(`对方：${revoke}`)
        }
      }
    }
  }

  return lines.join('\n')
}

async function suggestReplies(transcript, count, persona) {
  if (!DEEPSEEK_API_KEY) throw new Error('未配置 DEEPSEEK_API_KEY，请在 reply-assistant/.env 中填写')
  const personaText = String(persona || '').trim().slice(0, 4000)
  const personaBlock = personaText
    ? `以下是聊天对象设定以及用户给出的要求（在整个聊天过程中必须始终保持并遵守，不得偏离）：\n${personaText}\n\n`
    : ''
  const systemPrompt = `${personaBlock}你是微信聊天里的“回复助手”，负责帮「我」回复聊天对象。

角色关系（务必始终分清，绝不能混淆）：
- 「我」：使用这个工具的用户，是需要你代写回复的人。
- 「对方」：聊天对象；私聊中就是对方，群聊中则是群里的其他人。

你的任务：根据最近的对话，生成 ${count} 个「我」发给「对方」的候选回复。
必须站在「我」的立场和语气说话，用第一人称对「对方」表达；绝不能站在「对方」的立场，也不能生成「对方」会说的话。

硬性要求：
1. 只输出一个 JSON 字符串数组，例如 ["好的，没问题","哈哈，我也这么觉得"]。
2. 不要输出解释、思考过程、Markdown、代码块或数组之外的任何内容。
3. 每条回复 1 到 40 字，语气自然，彼此不要重复。`
  const response = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `最近对话（“我”是用户，其余是聊天对象）：\n${transcript}\n\n请只输出 ${count} 个「我」回复给「对方」的候选回复的 JSON 数组。` },
      ],
      temperature: 0.7,
      max_tokens: 256,
    }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`DeepSeek ${response.status}：${String(text).slice(0, 180)}`)
  const parsed = JSON.parse(text)
  const raw = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
    ? parsed.choices[0].message.content
    : ''
  const suggestions = parseReplyList(raw, count)
  if (suggestions.length === 0) throw new Error('DeepSeek 没有返回有效的候选回复')
  return suggestions
}

function pasteToWeChat(text, send = false) {
  return new Promise((resolve, reject) => {
    const lines = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      '$text = $env:WEFLOW_PASTE_TEXT',
      'if ([string]::IsNullOrEmpty($text)) { exit 2 }',
      'Set-Clipboard -Value $text',
      'Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class Win32Input {',
      '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
      '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
      '  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);',
      '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
      '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
      '}',
      '"@',
      '$target = $null',
      "foreach ($name in @('Weixin','WeChat')) {",
      "  $p = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      '  if ($p) { $target = $p; break }',
      '}',
      'if (-not $target) { exit 3 }',
      '$hwnd = $target.MainWindowHandle',
      '$focused = $false',
      'for ($attempt = 1; $attempt -le 5; $attempt++) {',
      '  if ([Win32Input]::IsIconic($hwnd)) { [void][Win32Input]::ShowWindow($hwnd, 9) }',
      '  [Win32Input]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)',
      '  [Win32Input]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)',
      '  Start-Sleep -Milliseconds 120',
      '  $foreground = [Win32Input]::GetForegroundWindow()',
      '  [uint32]$foregroundPid = 0; [uint32]$targetPid = 0',
      '  $foregroundThread = [Win32Input]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)',
      '  $targetThread = [Win32Input]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)',
      '  if ($foregroundThread -ne $targetThread) { [void][Win32Input]::AttachThreadInput($foregroundThread, $targetThread, $true) }',
      '  [void][Win32Input]::ShowWindow($hwnd, 9)',
      '  [void][Win32Input]::BringWindowToTop($hwnd)',
      '  [void][Win32Input]::SetForegroundWindow($hwnd)',
      '  [void][Win32Input]::SetFocus($hwnd)',
      '  if ($foregroundThread -ne $targetThread) { [void][Win32Input]::AttachThreadInput($foregroundThread, $targetThread, $false) }',
      '  Start-Sleep -Milliseconds 350',
      '  if ([Win32Input]::GetForegroundWindow() -eq $hwnd) { $focused = $true; break }',
      '}',
      'if (-not $focused) { exit 4 }',
      'Start-Sleep -Milliseconds 250',
      '[Win32Input]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)',
      '[Win32Input]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)',
      '[Win32Input]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)',
      '[Win32Input]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)',
    ]
    if (send) {
      lines.push('Start-Sleep -Milliseconds 350')
      lines.push('[Win32Input]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)')
      lines.push('[Win32Input]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)')
    }
    lines.push('exit 0')
    const script = lines.join('\n')

    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: { ...process.env, WEFLOW_PASTE_TEXT: text },
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else if (code === 2) reject(new Error('要写入的内容为空'))
      else if (code === 3) reject(new Error('没有找到微信窗口，请先打开微信'))
      else if (code === 4) reject(new Error('无法切换到微信窗口，请手动点一下微信后重试'))
      else reject(new Error(`写入微信失败（code=${code}）${String(stderr).slice(0, 160)}`))
    })
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    if (url.pathname === '/api/push') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()
      const upstream = http.request(
        {
          host: '127.0.0.1',
          port: WEFLOW_PORT,
          path: '/api/v1/push/messages',
          headers: { Authorization: `Bearer ${WEFLOW_TOKEN}` },
        },
        (upRes) => {
          upRes.pipe(res)
        }
      )
      upstream.on('error', () => {
        try { res.end() } catch { /* ignore */ }
      })
      req.on('close', () => {
        try { upstream.destroy() } catch { /* ignore */ }
      })
      upstream.end()
      return
    }

    if (url.pathname === '/api/suggest') {
      const params = req.method === 'POST'
        ? await readJsonBody(req)
        : {
            sessionId: url.searchParams.get('sessionId') || '',
            text: url.searchParams.get('text') || '',
            limit: url.searchParams.get('limit') || '',
            persona: url.searchParams.get('persona') || '',
          }
      const sessionId = String(params.sessionId || '').trim()
      const limit = Math.max(1, Math.min(100, Number(params.limit || 40)))
      let transcript = String(params.text || '').trim()

      if (!transcript && sessionId) {
        const data = await requestWeflow(`/api/v1/messages?talker=${encodeURIComponent(sessionId)}&limit=${limit}`)
        if (!data || data.success !== true) throw new Error((data && data.error) || '读取消息失败')
        const senderNames = await resolveSenderNames(sessionId, data.messages || [])
        transcript = buildTranscript(data.messages, limit, senderNames)
      }
      if (!transcript) {
        sendJson(res, 400, { success: false, error: '没有可用的聊天上下文' })
        return
      }
      const persona = String(params.persona || '').trim().slice(0, 4000)
      const suggestions = await suggestReplies(transcript, 3, persona)
      sendJson(res, 200, { success: true, suggestions })
      return
    }

    if (url.pathname === '/api/paste-to-wechat') {
      const text = String(url.searchParams.get('text') || '')
      const send = url.searchParams.get('send') === '1' || url.searchParams.get('send') === 'true'
      if (!text) {
        sendJson(res, 400, { success: false, error: '内容为空' })
        return
      }
      try {
        await pasteToWeChat(text, send)
        sendJson(res, 200, { success: true })
      } catch (error) {
        sendJson(res, 500, { success: false, error: error && error.message ? error.message : String(error) })
      }
      return
    }

    if (url.pathname.startsWith('/api/media/')) {
      const target = `/api/v1/media${url.pathname.slice('/api/media'.length)}${url.search}`
      const upstream = http.request(
        {
          host: '127.0.0.1',
          port: WEFLOW_PORT,
          path: target,
          headers: { Authorization: `Bearer ${WEFLOW_TOKEN}` },
        },
        (upRes) => {
          res.writeHead(upRes.statusCode || 200, upRes.headers)
          upRes.pipe(res)
        }
      )
      upstream.on('error', () => {
        try { res.writeHead(502); res.end() } catch { /* ignore */ }
      })
      req.on('close', () => {
        try { upstream.destroy() } catch { /* ignore */ }
      })
      upstream.end()
      return
    }

    if (url.pathname.startsWith('/api/weflow/')) {
      const target = `/api/v1${url.pathname.slice('/api/weflow'.length)}${url.search}`
      const data = await requestWeflow(target)
      sendJson(res, 200, data)
      return
    }

    let filePath = url.pathname === '/' ? '/index.html' : url.pathname
    filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''))
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    fs.readFile(filePath, (error, buffer) => {
      if (error) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
      res.end(buffer)
    })
  } catch (error) {
    sendJson(res, 500, { success: false, error: error && error.message ? error.message : String(error) })
  }
})

startWeflow()
server.listen(APP_PORT, '127.0.0.1', () => {
  console.log(`回复建议已启动：http://127.0.0.1:${APP_PORT}`)
  console.log(`WeFlow API：${WEFLOW_BASE}`)
})

let warmAttempts = 0
const warmTimer = setInterval(() => {
  warmAttempts += 1
  loadContacts()
    .then(() => {
      console.log('联系人昵称缓存已预热')
      clearInterval(warmTimer)
    })
    .catch(() => {
      if (warmAttempts >= 20) clearInterval(warmTimer)
    })
}, 5000)

function shutdown() {
  clearInterval(warmTimer)
  if (weflowProc) {
    try { weflowProc.kill() } catch { /* ignore */ }
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
