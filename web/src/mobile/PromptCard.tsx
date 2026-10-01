import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PendingPrompt } from "./mobile-state";
import { Button, Card, Input, Textarea } from "./ui";

interface Props {
  pending: PendingPrompt;
  onAnswer: (id: string, result: Record<string, unknown>) => void;
  onReceived: (id: string) => void;
}

interface Question {
  qid: string;
  question: string;
  choices?: string[];
  multi_select?: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function shortLine(value: string, limit = 80): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

function secretTitle(name: string): string {
  const title = name.toLowerCase().replace(/_/g, " ").replace(/\bgithub\b/g, "GitHub");
  return shortLine(title ? title[0].toUpperCase() + title.slice(1) : "Secret", 64);
}

function helpUrl(value: unknown): string | undefined {
  try {
    const raw = text(value);
    const url = new URL(raw);
    return raw.length <= 2048 && !/\s/.test(raw) && url.protocol === "https:" && !url.username && !url.password ? raw : undefined;
  } catch {
    return undefined;
  }
}

function questionsOf(params: Record<string, unknown>): Question[] {
  if (Array.isArray(params.questions)) {
    return params.questions.filter((q): q is Question =>
      typeof q === "object" && q !== null && typeof q.qid === "string" && typeof q.question === "string");
  }
  return [{ qid: "single", question: text(params.question), choices: Array.isArray(params.choices) ? params.choices.filter((c): c is string => typeof c === "string") : undefined, multi_select: params.multi_select === true }];
}

function selectedChoices(raw: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export default function PromptCard({ pending, onAnswer, onReceived }: Props) {
  const { request } = pending;
  const p = request.params;
  const [value, setValue] = useState("");
  const [identifier, setIdentifier] = useState("");
  const acknowledged = useRef(false);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const locked = p.answers;
    return locked && typeof locked === "object" ? locked as Record<string, string> : {};
  });
  useEffect(() => {
    if (request.method === "approval" && typeof p.request_id === "string" && !acknowledged.current) {
      acknowledged.current = true;
      onReceived(p.request_id);
    }
  }, [request.id, request.method, p.request_id, onReceived]);
  const respond = (result: Record<string, unknown>) => onAnswer(request.id, result);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (request.method === "clarify") {
      const questions = questionsOf(p);
      if (Array.isArray(p.questions)) respond({ answers: Object.fromEntries(questions.map(q => [q.qid, answers[q.qid] ?? ""])) });
      else respond({ answer: answers.single ?? "" });
    } else if (request.method === "vault.save_login") {
      respond({ value: identifier.trim() && value ? JSON.stringify({ identifier: identifier.trim(), password: value }) : "" });
    } else {
      respond({ value });
    }
    setValue("");
  };

  if (request.method === "approval") {
    const choices = Array.isArray(p.choices) ? p.choices.filter((v): v is string => typeof v === "string") : ["once", "deny"];
    const visible = choices.filter(v => v !== "always" || p.allow_permanent !== false).filter(v => v !== "session" || p.allow_session !== false);
    return <Card aria-label="Command approval">
      <h2>Approve command?</h2>
      <p>{text(p.description)}</p><pre>{text(p.command)}</pre>
      <div className="m-actions">{visible.map(choice => <Button variant={choice === "once" ? "primary" : choice === "deny" ? "outline" : "secondary"} key={choice} type="button" onClick={() => respond({ choice })}>{({ once: "Allow once", session: "Allow for session", always: "Always allow", deny: "Deny" } as Record<string, string>)[choice] ?? choice}</Button>)}</div>
    </Card>;
  }

  if (request.method === "clarify") {
    const locked = p.answers && typeof p.answers === "object" ? p.answers as Record<string, string> : {};
    return <form className="m-card" onSubmit={submit} aria-label="Clarifying questions">
      <h2>Question from Hermes</h2>
      {questionsOf(p).map(q => <fieldset key={q.qid} disabled={Object.hasOwn(locked, q.qid)}>
        <legend>{q.question}</legend>
        {q.choices?.map(choice => <label key={choice} className="m-choice"><input type={q.multi_select ? "checkbox" : "radio"} name={q.qid} checked={q.multi_select ? selectedChoices(answers[q.qid]).includes(choice) : answers[q.qid] === choice} onChange={() => setAnswers(prev => {
          if (!q.multi_select) return { ...prev, [q.qid]: choice };
          const selected = selectedChoices(prev[q.qid]);
          return { ...prev, [q.qid]: JSON.stringify(selected.includes(choice) ? selected.filter(c => c !== choice) : [...selected, choice]) };
        })} />{choice}</label>)}
        {!q.choices?.length && <Textarea aria-label={q.question} value={answers[q.qid] ?? ""} onChange={e => setAnswers(prev => ({ ...prev, [q.qid]: e.target.value }))} />}
        {Object.hasOwn(locked, q.qid) && <small>Already answered</small>}
      </fieldset>)}
      <div className="m-actions"><Button variant="primary" type="submit">Answer</Button><Button variant="outline" type="button" onClick={() => respond(Array.isArray(p.questions) ? { answers: {} } : { answer: "" })}>Skip</Button></div>
    </form>;
  }

  if (request.method === "secret.request" || request.method === "secret") {
    const name = text(p.name) || text(p.env_var);
    const title = shortLine(text(p.title), 64) || secretTitle(name);
    const reason = text(p.reason) || text(p.prompt);
    const hint = shortLine(text(p.hint));
    const url = helpUrl(p.help_url);
    const destination = p.destination && typeof p.destination === "object" ? p.destination as Record<string, unknown> : null;
    return <form className="m-card m-secret-card" onSubmit={submit} aria-label={title}>
      <h2>{title}</h2>
      {reason && <p className="m-secret-reason">{shortLine(reason)}</p>}
      {url && <a className="m-secret-help" href={url} target="_blank" rel="noopener noreferrer">Create it ↗</a>}
      {hint && <p className="m-secret-hint">{hint}</p>}
      <Input aria-label={title} placeholder="Paste token" type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} required />
      <div className="m-actions"><Button variant="primary" type="submit">Save</Button><Button variant="outline" type="button" onClick={() => { respond({ value: "" }); setValue(""); }}>Decline</Button></div>
      <details className="m-secret-details">
        <summary>Details</summary>
        <p>{text(p.requester)}{p.requester ? " · " : ""}{name}</p>
        {reason && <p className="m-secret-full-reason">{reason}</p>}
        {hint && <p>{text(p.hint)}</p>}
        {destination && <p>Destination: <strong>{text(destination.kind)} · {text(destination.path) || text(destination.origin)}</strong>{destination.label ? ` · ${text(destination.label)}` : ""}{destination.identifier ? ` · ${text(destination.identifier)}` : ""}{destination.kind === "env_file" || destination.kind === "remote_file" ? " (file mode 0600)" : ""}.</p>}
        <p>This value is sent directly to Hermes; it is not added to chat history. Clear your clipboard after pasting.</p>
      </details>
    </form>;
  }

  const config: Record<string, { title: string; label: string; hint: string }> = {
    sudo: { title: "Sudo password", label: "Password", hint: text(p.command) },
    "vault.unlock_prompt": { title: "Unlock password manager", label: "Master password", hint: text(p.display_name) },
    "vault.save_login": { title: "Save site login", label: "Password", hint: `${text(p.site)} · ${text(p.origin)}` },
    "vault.code": { title: "Verification code", label: "Code", hint: `${text(p.site)} · ${text(p.hint)}` },
  };
  const details = config[request.method];
  if (!details) return null;
  return <form className="m-card" onSubmit={submit} aria-label={details.title}>
    <h2>{details.title}</h2><p>{details.hint}</p>
    {request.method === "vault.save_login" && <label>Username or email<Input autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} required /></label>}
    <label>{details.label}<Input type={request.method === "vault.code" ? "text" : "password"} autoComplete={request.method === "vault.code" ? "one-time-code" : request.method === "vault.save_login" ? "new-password" : "off"} value={value} onChange={e => setValue(e.target.value)} required /></label>
    <p className="m-muted m-prompt-hint">This value is sent directly to Hermes; it is not added to chat history.</p>
    <div className="m-actions"><Button variant="primary" type="submit">{request.method === "vault.save_login" ? "Save" : "Send"}</Button><Button variant="outline" type="button" onClick={() => { respond({ value: "" }); setValue(""); }}>Decline</Button></div>
  </form>;
}
