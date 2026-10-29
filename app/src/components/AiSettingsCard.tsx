import { useState } from 'react'
import { useApp } from '../AppContext'
import { useAction, useFeedback } from './Feedback'
import { Seg } from './Seg'
import { aiConfig, aiSourceOf, DEFAULT_MODELS, fallbackPreference, forgetAiStatus, normalizeEndpoint, probeAi, useAiAvailable, type AiProvider } from '../lib/ai'
import { householdAiPossible } from '../lib/household-ai'
import type { Settings } from '../types'
import './ai-settings.css'

const PROVIDERS: Array<{ v: AiProvider; label: string }> = [
  { v: 'anthropic', label: 'Anthropic' },
  { v: 'openai', label: 'OpenAI' },
  { v: 'custom', label: 'Custom' },
]

export const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros % 1_000_000 === 0 ? 0 : 2)}`
export const shortDay = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Live plain-words check of a pasted key, so a wrong paste is caught before "Test". */
function keyHint(provider: AiProvider, key: string): { text: string; warn?: boolean } {
  const k = key.trim()
  if (provider === 'custom') return { text: k ? 'Sent as a Bearer token to your endpoint.' : 'Optional — only if your endpoint asks for one.' }
  if (!k) return { text: provider === 'anthropic' ? 'Create one at console.anthropic.com → API keys.' : 'Create one at platform.openai.com → API keys.' }
  if (provider === 'anthropic' && !k.startsWith('sk-ant-')) return { text: 'Anthropic keys start with “sk-ant-”. Check you copied the whole key.', warn: true }
  if (provider === 'openai' && (!k.startsWith('sk-') || k.startsWith('sk-ant-'))) return { text: 'OpenAI keys start with “sk-”. Check you copied the whole key.', warn: true }
  return { text: 'Looks like a valid key. Test & save will confirm it works.' }
}

function modelHint(provider: AiProvider, model: string): string {
  const m = model.trim()
  if (!m) return provider === 'anthropic'
    ? `Blank uses ${DEFAULT_MODELS.anthropic} — the cheapest Claude that reads photos.`
    : `Blank uses ${DEFAULT_MODELS[provider]}.`
  if (provider === 'anthropic' && !m.startsWith('claude-')) return 'Claude model names start with “claude-”.'
  return `Every AI request will use ${m}.`
}

/**
 * Where this person's AI comes from: the household key (nothing to set up,
 * metered) or their own key, called straight from this device.
 */
export function AiSettingsCard() {
  const { api, settings, refreshSettings } = useApp()
  const action = useAction()
  const notify = useFeedback()
  const ai = useAiAvailable(settings)
  const source = aiSourceOf(settings)
  const [editingOwn, setEditingOwn] = useState(source === 'own' || !householdAiPossible)
  const [provider, setProvider] = useState<AiProvider>(settings.aiProvider ?? 'custom')
  const [endpoint, setEndpoint] = useState(settings.aiEndpoint ?? '')
  const [apiKey, setApiKey] = useState(settings.aiApiKey ?? '')
  const [model, setModel] = useState(settings.aiModel ?? '')
  // household users switching to their own key start with the fallback on; migrated endpoint users keep it off
  const [fallback, setFallback] = useState(() => source === 'household' || fallbackPreference(settings))
  const [test, setTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const ownOpen = editingOwn || source === 'own'
  const dirty = () => setTest('idle')

  const pickHousehold = () => action.run(async () => {
    setEditingOwn(false)
    await api.patchSettings({ aiSource: 'household' })
    await refreshSettings()
    forgetAiStatus()
    notify('Using household AI')
  })

  const saveOwn = () => action.run(async () => {
    setTest('testing')
    const next: Partial<Settings> = {
      aiSource: 'own',
      aiProvider: provider,
      aiEndpoint: provider === 'custom' ? endpoint.trim() || undefined : settings.aiEndpoint,
      aiApiKey: apiKey.trim() || undefined,
      aiModel: model.trim() || undefined,
      aiFallback: fallback,
    }
    try {
      const config = aiConfig({ ...settings, ...next })
      if (!config || config.source !== 'own') {
        setTest('fail')
        notify(provider === 'custom' ? 'Add your endpoint address first.' : 'Paste your API key first.', { error: true })
        return
      }
      await api.patchSettings(next)
      await refreshSettings()
      forgetAiStatus()
      const ok = await probeAi(config)
      setTest(ok ? 'ok' : 'fail')
      notify(ok ? 'Your key is saved and working' : 'Saved, but the connection could not be verified.', { error: !ok })
    } catch (error) { setTest('fail'); throw error }
  })

  const statusLabel = ai.checking ? 'Checking…' : ai.available ? (ai.viaFallback ? 'Household stand-in' : ai.source === 'own' ? 'Connected ✓' : 'Ready ✓') : ai.configured ? 'Unavailable' : ''
  const household = ai.source === 'household' ? ai.household : undefined
  const meterPct = household?.capMicros ? Math.min(100, (household.spentMicros / household.capMicros) * 100) : 0
  const key = keyHint(provider, apiKey)
  const insecureEndpoint = (endpoint.trim().startsWith('http://') && window.location.protocol === 'https:')
    || /^(https?:\/\/)?\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(endpoint.trim().replace(/\/+$/, ''))

  return (
    <div className="card ai-settings">
      <div className="row">
        <span className="lab">✦ AI assist</span>
        {statusLabel && <span className={`lab${ai.available ? ' lm' : ''}`} role="status" style={!ai.available && ai.configured && !ai.checking ? { color: 'var(--danger)' } : undefined}>{statusLabel}</span>}
      </div>
      <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
        Food estimates, machine help and workout reviews. Switch any time; your choice is saved to your account.
      </span>

      <div role="radiogroup" aria-label="Where AI comes from" className="ai-sources">
        {householdAiPossible && (
          <div className={`ai-source${!ownOpen ? ' on' : ''}`}>
            <button role="radio" aria-checked={!ownOpen} className="ai-source-pick" disabled={action.busy} onClick={() => { if (ownOpen) void pickHousehold() }}>
              <span className="ai-radio" aria-hidden="true" />
              <span className="ai-source-text"><b>Household AI</b><span>Shared by everyone here. Nothing to set up.</span></span>
            </button>
            {!ownOpen && household && (household.capMicros !== null && meterPct >= 50 || !household.available) && (
              <div className="ai-source-foot">
                <div className="row"><span>This month</span><span className="small">{usd(household.spentMicros)}{household.capMicros !== null && ` of ${usd(household.capMicros)}`} · refreshes {shortDay(household.resetsAt)}</span></div>
                {household.capMicros !== null && <div className={`ai-meter${meterPct >= 100 ? ' over' : meterPct >= 80 ? ' hot' : ''}`}><i style={{ width: `${meterPct}%` }} /></div>}
              </div>
            )}
            {!ownOpen && ai.status === 'unavailable' && ai.message && <p className="small ai-source-note" role="alert">{ai.message}</p>}
          </div>
        )}

        <div className={`ai-source${ownOpen ? ' on' : ''}`}>
          <button role="radio" aria-checked={ownOpen} className="ai-source-pick" disabled={action.busy} onClick={() => setEditingOwn(true)}>
            <span className="ai-radio" aria-hidden="true" />
            <span className="ai-source-text"><b>Your own key</b><span>Anthropic, OpenAI, or your own endpoint. You pay your provider{householdAiPossible ? '; nothing counts toward the household limit' : ''}.</span></span>
          </button>
          {ownOpen && (
            <div className="ai-own">
              <Seg options={PROVIDERS} value={provider} onPick={(p) => { setProvider(p); dirty() }} />
              {provider === 'custom' && (
                <div className="field">
                  <label htmlFor="ai-endpoint">Endpoint</label>
                  <input id="ai-endpoint" aria-label="AI endpoint" className="text-in" placeholder="https://optiplex.tailnet.ts.net" autoCapitalize="off" autoCorrect="off"
                    disabled={test === 'testing'} value={endpoint} onChange={(e) => { setEndpoint(e.target.value); dirty() }} />
                  <span className="small ai-hint">{endpoint.trim() ? `Requests go to ${normalizeEndpoint(endpoint)}/v1/chat/completions.` : 'Any OpenAI-compatible server, like CLIProxyAPI over Tailscale.'}</span>
                </div>
              )}
              <div className="field">
                <label htmlFor="ai-key">API key</label>
                <input id="ai-key" aria-label="AI API key" className="text-in" type="password" placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'} autoComplete="off"
                  disabled={test === 'testing'} value={apiKey} onChange={(e) => { setApiKey(e.target.value); dirty() }} />
                <span className={`small ai-hint${key.warn ? ' warn' : ''}`}>{key.text}</span>
              </div>
              <div className="field">
                <label htmlFor="ai-model">Model</label>
                <input id="ai-model" aria-label="AI model" className="text-in" placeholder={DEFAULT_MODELS[provider]} autoCapitalize="off" autoCorrect="off"
                  disabled={test === 'testing'} value={model} onChange={(e) => { setModel(e.target.value); dirty() }} />
                <span className="small ai-hint">{modelHint(provider, model)}</span>
              </div>
              <span className="small ai-hint" style={{ marginBottom: 10 }}>
                Your key stays in your account and goes straight from this phone to {provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'your endpoint'}. The household server never uses it.
              </span>
              {householdAiPossible && (
                <button className="ai-switch-row" role="switch" aria-checked={fallback} disabled={test === 'testing'} onClick={() => { setFallback(!fallback); dirty() }}>
                  <span><b>If my key fails, use Household AI</b><span className="small">Handy off Tailscale. Those requests count toward your household limit.</span></span>
                  <span className={`ai-toggle${fallback ? ' on' : ''}`} aria-hidden="true" />
                </button>
              )}
              <button className="ghost-btn" style={{ marginTop: 10 }} disabled={test === 'testing' || action.busy} onClick={() => void saveOwn()}>
                {test === 'testing' ? 'Testing…' : test === 'ok' ? 'Saved ✓' : 'Test & save'}
              </button>
              {test === 'fail' && (
                <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 6 }}>
                  {provider !== 'custom'
                    ? `Saved, but ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} didn't accept the request. Check the key and model.`
                    : insecureEndpoint
                      ? 'The browser can only call an https:// endpoint, and an IP address can\'t get a certificate — it has to be a name. On the proxy machine run "sudo tailscale serve --bg localhost:8317", then use its https://…ts.net address here (no port).'
                      : "Saved, but the endpoint didn't answer. Are you on Tailscale, and is the endpoint HTTPS?"}
                </span>
              )}
              {source === 'own' && ai.viaFallback && <p className="small ai-source-note">{ai.message}</p>}
              {householdAiPossible && source !== 'own' && (
                <button className="text-button" onClick={() => setEditingOwn(false)}>Cancel — keep household AI</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
