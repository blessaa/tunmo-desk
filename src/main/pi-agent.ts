import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import log from 'electron-log'
import { loadSettings, saveSettings } from './settings'
import {
  jsonSafe,
  summarizeAssistant,
  toRpcWireEvent,
  type PiPromptCommand,
  type PiRpcWireEvent
} from '../shared/pi-rpc'

export type RpcStatus = 'idle' | 'starting' | 'running' | 'missing' | 'error'

export interface RpcState {
  status: RpcStatus
  engine: 'sdk'
  lastError: string
  modelId: string
  modelName: string
}

export interface ModelOption {
  id: string
  name: string
  provider: string
}

export type ChatStreamEvent = PiRpcWireEvent

type PiModule = typeof import('@earendil-works/pi-coding-agent')
type AgentSession = Awaited<ReturnType<PiModule['createAgentSession']>>['session']
type ModelRuntime = Awaited<ReturnType<PiModule['ModelRuntime']['create']>>

interface SessionEntry {
  session: AgentSession
  cwd: string
}

let pi: PiModule | null = null
let modelRuntime: ModelRuntime | null = null
const sessions = new Map<string, SessionEntry>()
let state: RpcState = {
  status: 'idle',
  engine: 'sdk',
  lastError: '',
  modelId: '',
  modelName: ''
}

function sendStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rpc:status', getRpcState())
  }
}

export function getRpcState(): RpcState {
  return { ...state }
}

async function loadPi(): Promise<PiModule> {
  if (pi) return pi
  try {
    const importer = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<PiModule>
    pi = await importer('@earendil-works/pi-coding-agent')
    return pi
  } catch (err) {
    state.status = 'missing'
    state.lastError = err instanceof Error ? err.message : String(err)
    throw err
  }
}

function defaultCwd(): string {
  const settings = loadSettings()
  return settings.workspacePath || process.cwd() || homedir()
}

function toolList(): string[] {
  const shell = process.platform === 'win32' ? 'powershell' : 'bash'
  return ['read', shell, 'edit', 'write', 'grep', 'find', 'ls']
}

async function applyApiKey(runtime: ModelRuntime): Promise<void> {
  const { apiKey, provider } = loadSettings()
  if (!apiKey || !provider) return
  await runtime.setRuntimeApiKey(provider, apiKey)
}

async function ensureRuntime(): Promise<{ mod: PiModule; runtime: ModelRuntime }> {
  const mod = await loadPi()
  if (!modelRuntime) {
    modelRuntime = await mod.ModelRuntime.create()
  }
  await applyApiKey(modelRuntime)
  return { mod, runtime: modelRuntime }
}

export async function listModels(overrides?: { provider?: string; apiKey?: string }): Promise<ModelOption[]> {
  const { runtime } = await ensureRuntime()
  const settings = loadSettings()
  const provider = overrides?.provider || settings.provider
  const apiKey = overrides?.apiKey ?? settings.apiKey
  if (apiKey && provider) {
    await runtime.setRuntimeApiKey(provider, apiKey)
  }
  let models: Awaited<ReturnType<ModelRuntime['getModels']>> = []
  try {
    models = [...(await runtime.getAvailable(provider))]
  } catch (err) {
    log.error('[pi] list models', err)
  }
  if (models.length === 0) {
    models = [...runtime.getModels(provider)]
  }
  return models.map((item) => ({
    id: item.id,
    name: item.name,
    provider: String(item.provider)
  }))
}

async function resolveModel(runtime: ModelRuntime) {
  const { provider, modelId } = loadSettings()
  if (modelId) {
    const selected = runtime.getModel(provider, modelId)
    if (selected) return selected
  }
  const options = await listModels()
  const first = options[0]
  if (!first) return undefined
  const model = runtime.getModel(first.provider, first.id)
  if (model) {
    saveSettings({ modelId: first.id })
  }
  return model
}

function markRuntimeReady(session?: AgentSession): void {
  const active = session?.model
  state.status = 'running'
  if (active) {
    state.modelId = active.id ?? state.modelId
    state.modelName = active.name ?? state.modelName
    state.lastError = ''
  } else if (!state.modelId) {
    state.lastError = '未选择模型：请在设置中填写 API Key 并选择模型'
  }
  sendStatus()
}

async function createSessionInstance(cwd: string): Promise<AgentSession> {
  const { mod, runtime } = await ensureRuntime()
  const model = await resolveModel(runtime)
  const created = await mod.createAgentSession({
    cwd,
    modelRuntime: runtime,
    sessionManager: mod.SessionManager.inMemory(cwd),
    tools: toolList(),
    ...(model ? { model } : {})
  })
  markRuntimeReady(created.session)
  return created.session
}

async function getOrCreateSession(sessionId: string): Promise<AgentSession> {
  const existing = sessions.get(sessionId)
  if (existing) return existing.session
  const cwd = defaultCwd()
  log.info('[pi] create session', sessionId, cwd)
  const session = await createSessionInstance(cwd)
  sessions.set(sessionId, { session, cwd })
  return session
}

function disposeOne(sessionId: string): void {
  const entry = sessions.get(sessionId)
  if (!entry) return
  try {
    entry.session.dispose()
  } catch {
    // ignore
  }
  sessions.delete(sessionId)
}

function disposeAll(): void {
  for (const id of [...sessions.keys()]) {
    disposeOne(id)
  }
}

export async function startPiAgent(): Promise<RpcState> {
  try {
    const { runtime } = await ensureRuntime()
    const model = await resolveModel(runtime)
    state.status = 'running'
    state.modelId = model?.id ?? ''
    state.modelName = model?.name ?? ''
    state.lastError = model ? '' : '未选择模型：请在设置中填写 API Key 并选择模型'
    sendStatus()
  } catch (err) {
    if (state.status !== 'missing') state.status = 'error'
    state.lastError = err instanceof Error ? err.message : String(err)
    log.error('[pi]', state.lastError)
    sendStatus()
  }
  return getRpcState()
}

export async function applySettingsToRuntime(): Promise<RpcState> {
  try {
    const { runtime } = await ensureRuntime()
    await applyApiKey(runtime)
    const model = await resolveModel(runtime)
    state.modelId = model?.id ?? state.modelId
    state.modelName = model?.name ?? state.modelName
    if (model) state.lastError = ''
    sendStatus()
  } catch (err) {
    log.error('[pi] apply settings', err)
  }
  return getRpcState()
}

export async function restartPiAgent(): Promise<RpcState> {
  disposeAll()
  return startPiAgent()
}

export async function bindWorkspace(_cwd: string): Promise<RpcState> {
  return getRpcState()
}

export function stopPiAgent(): void {
  disposeAll()
  modelRuntime = null
  state.status = 'idle'
  state.lastError = ''
  state.modelId = ''
  state.modelName = ''
}

export async function promptPi(
  sessionId: string,
  command: PiPromptCommand,
  emit: (event: PiRpcWireEvent) => void
): Promise<PiRpcWireEvent> {
  log.info('[pi-rpc] command', sessionId, command)
  const tagged = (event: PiRpcWireEvent): void => {
    emit({ ...event, sessionId })
  }

  let current: AgentSession
  try {
    current = await getOrCreateSession(sessionId)
  } catch (err) {
    const response = {
      id: command.id,
      type: 'response' as const,
      command: 'prompt' as const,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    }
    tagged(response)
    return response
  }

  if (command.type !== 'prompt') {
    const response = {
      id: command.id,
      type: 'response' as const,
      command: 'prompt' as const,
      success: false,
      error: `unsupported rpc command: ${String((command as { type?: string }).type)}`
    }
    tagged(response)
    return response
  }

  if (!current.model) {
    const response = {
      id: command.id,
      type: 'response' as const,
      command: 'prompt' as const,
      success: false,
      error: '还没有可用模型。请在设置中填写 API Key，刷新并选择模型后再发送。'
    }
    tagged(response)
    return response
  }

  const unsubscribe = current.subscribe((event) => {
    const wire = toRpcWireEvent(event as { type?: string; [key: string]: unknown })
    log.info('[pi-rpc] event', sessionId, wire)
    tagged(wire)
  })

  try {
    log.info('[pi-rpc] prompt start', current.model.id, current.model.provider)
    await current.prompt(command.message)
    const lastAssistant = [...(current.messages ?? [])]
      .reverse()
      .find((item) => (item as { role?: string }).role === 'assistant')
    const summary = summarizeAssistant(lastAssistant)
    const stateError = current.state?.errorMessage
    log.info('[pi-rpc] prompt done', jsonSafe({ summary, stateError }))
    if (summary.error || stateError) {
      const response = {
        id: command.id,
        type: 'response' as const,
        command: 'prompt' as const,
        success: false,
        error: summary.error || String(stateError)
      }
      tagged(response)
      return response
    }
    if (summary.text) {
      tagged({
        type: 'message_end',
        role: 'assistant',
        content: [{ type: 'text', text: summary.text }]
      })
    }
    const response = {
      id: command.id,
      type: 'response' as const,
      command: 'prompt' as const,
      success: true
    }
    tagged(response)
    return response
  } catch (err) {
    const response = {
      id: command.id,
      type: 'response' as const,
      command: 'prompt' as const,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    }
    log.error('[pi-rpc] prompt failed', sessionId, response.error)
    tagged(response)
    return response
  } finally {
    unsubscribe()
  }
}
