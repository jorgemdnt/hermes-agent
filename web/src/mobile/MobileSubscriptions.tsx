import { useCallback, useEffect, useState } from "react";
import { api, type SubscriptionEntry, type SubscriptionWindow, type SubscriptionsResponse } from "@/lib/api";
import "./subscriptions.css";

const names: Record<string, string> = { "openai-codex": "Codex", anthropic: "Claude", "xai-oauth": "Grok" };
const strategies = ["fill_first", "round_robin", "least_used", "random"];
const errorMessage = () => "Subscription request failed. Try again.";

function Meter({ label, value }: { label: string; value?: SubscriptionWindow }) {
  return <div className="m-sub-meter" aria-label={`${label}: ${value ? `${value.used_percent}% used` : "not reported"}`}>
    <div><span>{label}</span><strong>{value ? `${value.used_percent}% used` : "Not reported"}</strong></div>
    {value && <><progress max={100} value={value.used_percent} />
      <small>{value.reset_at ? `Resets ${new Date(value.reset_at).toLocaleString()}` : "Reset time not reported"}</small></>}
  </div>;
}

function Account({ entry, provider, busy, remove }: { entry: SubscriptionEntry; provider: string; busy: boolean; remove: (index: number) => void }) {
  return <article className="m-sub-account">
    <div className="m-sub-account-top"><div><strong>{entry.account}</strong><p>{entry.plan || "Plan not reported"} · {entry.status}{entry.in_use && " · Next eligible"}</p></div>
      {entry.index !== null && <button type="button" disabled={busy} aria-label={`Remove ${entry.account} from ${names[provider]}`} onClick={() => remove(entry.index!)}>Remove</button>}</div>
    <div className="m-sub-meters"><Meter label="5-hour" value={entry.windows.five_hour} /><Meter label="Weekly" value={entry.windows.weekly} /></div>
  </article>;
}

export default function MobileSubscriptions() {
  const [snapshot, setSnapshot] = useState<SubscriptionsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState<{ provider: string; session: string; code: string; url: string } | null>(null);
  const load = useCallback(async (fresh = false) => {
    try { setSnapshot(await api.getSubscriptions(fresh)); setError(""); }
    catch { setError(errorMessage()); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!login) return;
    const timer = window.setInterval(() => {
      void api.pollOAuthSession(login.provider, login.session).then(state => {
        if (state.status === "pending") return;
        window.clearInterval(timer);
        setLogin(null);
        if (state.status === "approved") void load(true);
        else setError(`Sign-in ${state.status}`);
      }).catch(() => { window.clearInterval(timer); setLogin(null); setError(errorMessage()); });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [login, load]);
  const add = async (provider: string) => {
    setBusy(true); setError("");
    try {
      const started = await api.startOAuthLogin(provider, true);
      const url = started.flow === "pkce" ? started.auth_url : started.verification_url;
      if (!/^https:\/\//.test(url)) throw new Error("Provider returned an invalid login URL");
      setLogin({ provider, session: started.session_id, code: started.flow === "device_code" ? started.user_code : "", url });
      // The native shell opens https links in the system browser; on phones this is a new tab.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch { setError(errorMessage()); }
    finally { setBusy(false); }
  };
  const remove = async (provider: string, index: number) => {
    if (!window.confirm("Remove this subscription? Other accounts stay connected.")) return;
    setBusy(true);
    try { await api.removeCredentialPoolEntry(provider, index); await load(true); }
    catch { setError(errorMessage()); }
    finally { setBusy(false); }
  };
  const strategy = async (provider: string, value: string) => {
    setBusy(true);
    try { await api.setCredentialPoolStrategy(provider, value); await load(); }
    catch { setError(errorMessage()); }
    finally { setBusy(false); }
  };
  return <section className="m-subscriptions" aria-label="Subscriptions">
    <div className="m-sub-intro"><div><h2>Subscriptions</h2><p>Limits reported by each provider. Empty meters mean that provider did not report a window.</p></div>
      <button type="button" disabled={busy} onClick={() => void load(true)}>Refresh</button></div>
    {error && <p className="m-sub-error" role="alert">{error}</p>}
    {login && <div className="m-sub-login" role="status"><strong>Finish signing in to {names[login.provider]}</strong>
      {login.code && <p>Enter code <code>{login.code}</code> on the provider’s page.</p>}
      <a href={login.url} target="_blank" rel="noreferrer">Open login page</a><p>This account must be different from an existing login. Signing into the same account again signs out the first one.</p>
      <button type="button" onClick={() => { void api.cancelOAuthSession(login.session); setLogin(null); }}>Cancel</button></div>}
    {!snapshot && !error && <p role="status">Checking subscriptions…</p>}
    {snapshot?.providers.map(section => <section key={section.provider} className="m-sub-provider" aria-label={names[section.provider]}>
      <div className="m-sub-provider-head"><div><h3>{names[section.provider]}</h3><small>{section.entries.length} connected</small></div>
        {section.rotation_supported && <button type="button" disabled={busy || !!login} onClick={() => void add(section.provider)}>Add subscription</button>}</div>
      {section.rotation_supported ? <><p className="m-sub-note">Use a different account. Signing into the same one again signs the first one out.</p>
        <label className="m-sub-strategy">Rotation <select aria-label={`${names[section.provider]} rotation`} value={section.strategy} disabled={busy} onChange={event => void strategy(section.provider, event.target.value)}>
          {strategies.map(item => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
        <p className="m-sub-note">Next eligible is an estimate; an existing chat may still use another account.</p></>
        : <p className="m-sub-note">Claude runs through your official Claude Code login. That CLI currently uses one account; Hermes pool rotation and browser add are not supported for this provider.</p>}
      {section.entries.length ? section.entries.map(entry => <Account key={entry.id} entry={entry} provider={section.provider} busy={busy} remove={index => void remove(section.provider, index)} />)
        : <p className="m-sub-empty">No subscription connected.</p>}
    </section>)}
  </section>;
}
