function loadPersonaMap() {
  try {
    const raw = localStorage.getItem('weflowReplyPersonaBySession')
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const map = {}
    for (const [sessionId, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) map[sessionId] = value
      else if (typeof value === 'string' && value.trim()) map[sessionId] = [value.trim()]
    }
    return map
  } catch {
    return {}
  }
}

const state = {
  sessions: [],
  activeSessionId: null,
  lastIncomingKey: null,
  pollTimer: null,
  generating: false,
  personaBySession: loadPersonaMap(),
}

const els = {
  sessionList: document.getElementById('sessionList'),
  sessionSearch: document.getElementById('sessionSearch'),
  refreshSessions: document.getElementById('refreshSessions'),
  activeSessionName: document.getElementById('activeSessionName'),
  status: document.getElementById('status'),
  messageList: document.getElementById('messageList'),
  suggestionBar: document.getElementById('suggestionBar'),
  suggestionList: document.getElementById('suggestionList'),
  regenerate: document.getElementById('regenerate'),
  personaInput: document.getElementById('personaInput'),
  personaSend: document.getElementById('personaSend'),
  personaClear: document.getElementById('personaClear'),
  personaTarget: document.getElementById('personaTarget'),
  personaList: document.getElementById('personaList'),
}

let pushSource = null

function connectPush() {
  if (pushSource) pushSource.close()
  pushSource = new EventSource('/api/push')
  const handleEvent = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.sessionId && data.sessionId === state.activeSessionId) {
        pollMessages()
      }
    } catch {
      // 忽略无法解析的事件。
    }
  }
  pushSource.addEventListener('message.new', handleEvent)
  pushSource.addEventListener('message.revoke', handleEvent)
  pushSource.onerror = () => {
    setStatus('消息推送连接中断，正在重连...', true)
  }
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function extractXmlTitle(xml) {
  const match = String(xml || '').match(/<title>([\s\S]*?)<\/title>/i)
  if (!match) return ''
  const title = decodeXmlEntities(match[1])
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return title
}

function extractXmlTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return ''
  return decodeXmlEntities(match[1])
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatMessageContent(message) {
  const localType = Number(message.localType)
  const raw = String(message.rawContent || message.content || '')
  const text = String(message.parsedContent || message.content || '').trim()

  if (localType === 1) return text || '[文本]'
  if (localType === 3) return '[图片]'
  if (localType === 34) return '[语音]'
  if (localType === 43) return '[视频]'
  if (localType === 47) return '[动画表情]'
  if (localType === 49) {
    const title = extractXmlTitle(raw)
    return title || text || '[链接/文件]'
  }
  if (localType === 50) return '[视频通话]'
  if (localType === 10000) {
    const revoke = extractXmlTag(raw, 'content')
    if (revoke && revoke.includes('撤回')) {
      return /你撤回/.test(revoke) ? '你撤回了一条消息' : revoke
    }
    const title = extractXmlTitle(raw)
    return title || text || '[系统消息]'
  }

  const title = extractXmlTitle(raw)
  if (title) return title
  if (/^<\?xml|^<msg\b|^<appmsg\b/i.test(raw)) return '[消息]'
  return text || '[消息]'
}

function mediaProxyUrl(url) {
  return String(url || '').replace(/^https?:\/\/127\.0\.0\.1:\d+\/api\/v1\/media\//, '/api/media/')
}

async function api(pathname) {
  const response = await fetch(pathname)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `请求失败 ${response.status}`)
  }
  return data
}

async function apiPost(pathname, body) {
  const response = await fetch(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `请求失败 ${response.status}`)
  }
  return data
}

function setStatus(text, isError = false) {
  els.status.textContent = text
  els.status.style.color = isError ? '#dc2626' : ''
}

function displayName(session) {
  return session.displayName || session.username || '未命名会话'
}

function renderSessions() {
  const keyword = (els.sessionSearch.value || '').trim().toLowerCase()
  const list = state.sessions.filter((session) => {
    if (!keyword) return true
    return `${session.username || ''} ${session.displayName || ''}`.toLowerCase().includes(keyword)
  })
  els.sessionList.innerHTML = ''
  if (list.length === 0) {
    els.sessionList.innerHTML = '<div class="empty-state">没有会话</div>'
    return
  }
  for (const session of list) {
    const button = document.createElement('button')
    button.className = `session-item${session.username === state.activeSessionId ? ' active' : ''}`
    button.dataset.letter = (displayName(session) || '?').trim().charAt(0).toUpperCase()
    const name = document.createElement('div')
    name.className = 'session-name'
    name.textContent = displayName(session)
    const preview = document.createElement('div')
    preview.className = 'session-preview'
    preview.textContent = session.username || ''
    const body = document.createElement('div')
    body.className = 'session-body'
    body.appendChild(name)
    body.appendChild(preview)
    button.appendChild(body)
    button.addEventListener('click', () => selectSession(session.username))
    els.sessionList.appendChild(button)
  }
}

async function loadSessions() {
  try {
    setStatus('正在加载会话...')
    const data = await api('/api/weflow/sessions?limit=200')
    state.sessions = data.sessions || []
    renderSessions()
    setStatus(`已加载 ${state.sessions.length} 个会话`)
  } catch (error) {
    setStatus(error.message, true)
  }
}

function renderMessages(messages) {
  els.messageList.innerHTML = ''
  if (!messages || messages.length === 0) {
    els.messageList.innerHTML = '<div class="empty-state">暂无消息</div>'
    return
  }
  const ordered = messages.slice().reverse()
  for (const message of ordered) {
    const wrapper = document.createElement('div')
    wrapper.className = `message ${message.isSend === 1 ? 'me' : 'other'}`
    const meta = document.createElement('div')
    meta.className = 'meta'
    const time = message.createTime ? new Date(message.createTime * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
    meta.textContent = `${message.isSend === 1 ? '我' : (message.senderUsername || '对方')} ${time}`
    const content = document.createElement('div')
    if ((message.mediaType === 'image' || message.mediaType === 'emoji') && message.mediaUrl) {
      const image = document.createElement('img')
      image.className = message.mediaType === 'emoji' ? 'message-emoji' : 'message-image'
      image.src = mediaProxyUrl(message.mediaUrl)
      image.alt = message.parsedContent || '[图片]'
      image.loading = 'lazy'
      content.appendChild(image)
    } else {
      content.textContent = formatMessageContent(message)
    }
    wrapper.appendChild(meta)
    wrapper.appendChild(content)
    els.messageList.appendChild(wrapper)
  }
  els.messageList.scrollTop = els.messageList.scrollHeight
}

async function loadMessages(sessionId) {
  const data = await api(`/api/weflow/messages?talker=${encodeURIComponent(sessionId)}&limit=60&media=1&image=1&voice=0&video=0&emoji=1`)
  const messages = data.messages || []
  renderMessages(messages)
  const lastIncoming = messages.find((message) => message.isSend !== 1)
  state.lastIncomingKey = lastIncoming ? `${lastIncoming.serverId || lastIncoming.localId}` : null
}

async function pollMessages() {
  if (!state.activeSessionId || state.generating) return
  try {
    const data = await api(`/api/weflow/messages?talker=${encodeURIComponent(state.activeSessionId)}&limit=40&media=1&image=1&voice=0&video=0&emoji=1`)
    const messages = data.messages || []
    renderMessages(messages)
    const lastIncoming = messages.find((message) => message.isSend !== 1)
    const key = lastIncoming ? `${lastIncoming.serverId || lastIncoming.localId}` : null
    if (key && key !== state.lastIncomingKey) {
      state.lastIncomingKey = key
      await generateSuggestions()
    }
  } catch (error) {
    setStatus(error.message, true)
  }
}

async function generateSuggestions() {
  if (!state.activeSessionId || state.generating) return
  state.generating = true
  setStatus('正在生成回复建议...')
  els.regenerate.disabled = true
  try {
    const data = await apiPost('/api/suggest', {
      sessionId: state.activeSessionId,
      limit: 40,
      persona: currentInstructions().join('\n'),
    })
    renderSuggestions(data.suggestions || [])
    setStatus('回复建议已更新')
  } catch (error) {
    setStatus(error.message, true)
  } finally {
    state.generating = false
    els.regenerate.disabled = false
  }
}

function renderSuggestions(suggestions) {
  els.suggestionList.innerHTML = ''
  if (suggestions.length === 0) {
    els.suggestionBar.classList.add('hidden')
    return
  }
  els.suggestionBar.classList.remove('hidden')
  for (const suggestion of suggestions) {
    const item = document.createElement('div')
    item.className = 'suggestion-item'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'suggestion-input'
    input.value = suggestion

    const sendBtn = document.createElement('button')
    sendBtn.className = 'suggestion-action primary'
    sendBtn.textContent = '确认发送'
    sendBtn.title = '把编辑后的内容粘贴到当前微信聊天并回车发送'
    sendBtn.addEventListener('click', () => pasteToWeChat(input.value.trim(), sendBtn))

    item.appendChild(input)
    item.appendChild(sendBtn)
    els.suggestionList.appendChild(item)
  }
}

async function pasteToWeChat(text, button) {
  if (!text) {
    setStatus('内容为空', true)
    return
  }
  const original = button.textContent
  button.disabled = true
  button.textContent = '发送中...'
  try {
    const response = await fetch(`/api/paste-to-wechat?text=${encodeURIComponent(text)}&send=1`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.success === false) throw new Error(data.error || '写入失败')
    button.textContent = '已发送'
    setTimeout(() => {
      button.textContent = original
      button.disabled = false
    }, 1500)
  } catch (error) {
    button.textContent = '失败'
    setStatus(error.message || String(error), true)
    setTimeout(() => {
      button.textContent = original
      button.disabled = false
    }, 2000)
  }
}

function selectSession(sessionId) {
  if (state.pollTimer) clearInterval(state.pollTimer)
  state.activeSessionId = sessionId
  state.lastIncomingKey = null
  const session = state.sessions.find((item) => item.username === sessionId)
  els.activeSessionName.textContent = session ? displayName(session) : sessionId
  els.personaInput.value = ''
  els.personaTarget.textContent = session ? `（${displayName(session)}）` : ''
  els.suggestionBar.classList.add('hidden')
  renderSessions()
  renderPersonaList()
  setStatus('正在读取消息...')
  loadMessages(sessionId)
    .then(() => generateSuggestions())
    .catch((error) => setStatus(error.message, true))
  state.pollTimer = setInterval(pollMessages, 8000)
}

function currentInstructions() {
  return state.personaBySession[state.activeSessionId] || []
}

function renderPersonaList() {
  els.personaList.innerHTML = ''
  const list = currentInstructions()
  if (list.length === 0) {
    els.personaList.classList.add('hidden')
    return
  }
  els.personaList.classList.remove('hidden')
  for (const text of list) {
    const item = document.createElement('div')
    item.className = 'persona-list-item'
    item.textContent = text
    els.personaList.appendChild(item)
  }
}

els.refreshSessions.addEventListener('click', loadSessions)
els.sessionSearch.addEventListener('input', renderSessions)
els.regenerate.addEventListener('click', generateSuggestions)
els.personaSend.addEventListener('click', async () => {
  const text = els.personaInput.value.trim()
  if (!state.activeSessionId) {
    setStatus('请先选择一个聊天', true)
    return
  }
  if (!text) {
    setStatus('请先输入指令', true)
    return
  }
  if (!state.personaBySession[state.activeSessionId]) state.personaBySession[state.activeSessionId] = []
  state.personaBySession[state.activeSessionId].push(text)
  localStorage.setItem('weflowReplyPersonaBySession', JSON.stringify(state.personaBySession))
  els.personaInput.value = ''
  renderPersonaList()
  await generateSuggestions()
  setStatus('指令已发送并已更新回复')
})
els.personaClear.addEventListener('click', () => {
  if (!state.activeSessionId) return
  state.personaBySession[state.activeSessionId] = []
  localStorage.setItem('weflowReplyPersonaBySession', JSON.stringify(state.personaBySession))
  renderPersonaList()
  setStatus('当前聊天指令已清空')
})

connectPush()
loadSessions()
