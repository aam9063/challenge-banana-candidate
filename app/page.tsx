'use client';
import { useEffect, useRef, useState } from 'react';
import type { Person } from '../src/types';
type AnyRecord = Record<string, any>;
type PendingProposal = {
  approvalId: string;
  expiresAt?: string;
  proposal?: AnyRecord;
  expired?: boolean;
};
const countdown = (remainingMs: number) => {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const money = (cents: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const date = (value: string) =>
  new Intl.DateTimeFormat('en-IE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    chat: (
      <>
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4 8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z" />
      </>
    ),
    transfer: (
      <>
        <path d="M4 7h15m-5-5 5 5-5 5M20 17H5m5 5-5-5 5-5" />
      </>
    ),
    document: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </>
    ),
    arrow: (
      <>
        <path d="m5 12 14 0m-6-6 6 6-6 6" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.overview}
    </svg>
  );
}
export default function Home() {
  const [people, setPeople] = useState<Person[]>([]),
    [current, setCurrent] = useState<Person | null>(null),
    [tab, setTab] = useState('overview');
  const [dashboard, setDashboard] = useState<AnyRecord | null>(null),
    [conversations, setConversations] = useState<AnyRecord[]>([]),
    [conversationId, setConversationId] = useState<string | null>(null),
    [messages, setMessages] = useState<AnyRecord[]>([]);
  const [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [docs, setDocs] = useState<AnyRecord[]>([]),
    [document, setDocument] = useState<AnyRecord | null>(null),
    [query, setQuery] = useState(''),
    [sources, setSources] = useState<AnyRecord[] | null>(null);
  const [selectedCase, setSelectedCase] = useState<AnyRecord | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [amount, setAmount] = useState(''),
    [concept, setConcept] = useState('');
  const [pending, setPending] = useState<PendingProposal | null>(null),
    [now, setNow] = useState(() => Date.now());
  const activeConversation = useRef<string | null>(null);
  const generation = useRef(0),
    messagesEnd = useRef<HTMLDivElement>(null),
    confirmCardRef = useRef<HTMLElement>(null);
  async function refresh(g = generation.current) {
    const data = await api('dashboard');
    if (g !== generation.current) return;
    setDashboard(data);
    if (data.accounts?.length)
      setFrom((v) => (data.accounts.some((a: AnyRecord) => a.id === v) ? v : data.accounts[0].id));
  }
  async function resolveCase() {
    if (!selectedCase) return;
    setBusy(true);
    setError('');
    try {
      await api(`incidents/${selectedCase.incident.id}/close`, {});
      const g = generation.current;
      const [detail, dash] = await Promise.all([
        api(`incidents/${selectedCase.incident.id}`),
        api('dashboard'),
      ]);
      if (g !== generation.current) return;
      setSelectedCase(detail);
      setDashboard(dash);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function selectPerson(id: string) {
    const g = ++generation.current;
    setCurrent(null);
    setDashboard(null);
    setConversations([]);
    activeConversation.current = null;
    setConversationId(null);
    setMessages([]);
    setSelectedCase(null);
    setDocument(null);
    setDocs([]);
    setSources(null);
    setError('');
    setNotice('');
    setPending(null);
    setBusy(false);
    setText('');
    setFrom('');
    setTo('');
    setAmount('');
    setConcept('');
    setTab('overview');
    try {
      const result = await api('session', { userId: id });
      if (g !== generation.current) return;
      setCurrent(result.person);
      await refresh(g);
      if (result.person.role === 'customer') {
        const cs = await api('conversations');
        if (g === generation.current) setConversations(cs);
      }
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    api('people').then(setPeople);
    api('session')
      .then((x) => selectPerson(x.person.id))
      .catch(() => selectPerson('lucia'));
  }, []);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  // Tick once per second while there is any live expiry to display; the
  // cleanup keeps intervals from leaking across renders.
  const ticking = !!pending || (dashboard?.approvals?.length ?? 0) > 0;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  // Bring the inline confirmation card into view once it mounts.
  const pendingApprovalId = pending?.approvalId;
  useEffect(() => {
    if (!pendingApprovalId) return;
    const raf = requestAnimationFrame(() =>
      confirmCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
    );
    return () => cancelAnimationFrame(raf);
  }, [pendingApprovalId]);
  const remainingMs = (expiresAt?: string) =>
    expiresAt ? new Date(expiresAt).getTime() - now : NaN;
  const accountLabel = (id: string) => {
    const account = dashboard?.accounts?.find((a: AnyRecord) => a.id === id);
    if (account) return account.label;
    const contact = dashboard?.contacts?.find((c: AnyRecord) => c.id === id);
    return contact ? contact.name : id;
  };
  async function openConversation(id: string) {
    const g = generation.current;
    activeConversation.current = id;
    setConversationId(id);
    setTab('chat');
    setMessages([]);
    setError('');
    try {
      const c = await api(`conversations/${id}`);
      if (g === generation.current && activeConversation.current === id) setMessages(c.messages);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  async function newConversation() {
    const g = generation.current;
    try {
      const c = await api('conversations', {});
      if (g !== generation.current) return;
      const cs = await api('conversations');
      if (g !== generation.current) return;
      setConversations(cs);
      activeConversation.current = c.id;
      setConversationId(c.id);
      setMessages([]);
      setTab('chat');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(value = text) {
    if (!value.trim() || busy || !current) return;
    const g = generation.current;
    setBusy(true);
    setError('');
    setText('');
    let id = conversationId;
    try {
      if (!id) {
        const c = await api('conversations', {});
        if (g !== generation.current) return;
        id = c.id;
        activeConversation.current = id;
        setConversationId(id);
      }
      setTab('chat');
      setMessages((m) => [
        ...m,
        { id: 'pending-user', role: 'user', content: value, created_at: new Date().toISOString() },
      ]);
      await api(`conversations/${id}/messages`, { content: value });
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) {
        try {
          if (id) {
            const c = await api(`conversations/${id}`);
            if (g === generation.current && activeConversation.current === id)
              setMessages(c.messages);
          }
          const cs = await api('conversations');
          if (g === generation.current) setConversations(cs);
          await refresh(g);
        } catch {}
        if (g === generation.current) setBusy(false);
      }
    }
  }
  async function openLibrary() {
    const g = generation.current;
    setTab('documents');
    setDocument(null);
    try {
      const result = await api('documents');
      if (g === generation.current) setDocs(result.documents);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    }
  }
  async function openCitation(docId: string) {
    if (!docs.length) return; // Library not loaded yet: the chip stays non-navigating.
    setTab('documents');
    if (!docs.some((d) => d.id === docId)) return;
    const g = generation.current;
    try {
      const result = await api(`documents/${docId}`);
      if (g === generation.current) setDocument(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submitTransfer() {
    const g = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api('actions', {
        name: 'transfer_money',
        arguments: {
          fromAccountId: from,
          toAccountId: to,
          amountCents: Math.round(Number(amount.replace(',', '.')) * 100),
          concept,
        },
        conversationId,
      });
      if (g !== generation.current) return;
      if (result.status === 'requires_confirmation' && result.approvalId)
        setPending({
          approvalId: result.approvalId,
          expiresAt: result.expiresAt,
          proposal: result.proposal,
        });
      setNotice(
        result.status === 'completed'
          ? 'Transfer completed. You can check it in your activity.'
          : result.status === 'requires_confirmation'
            ? 'Review the proposal to confirm the transfer.'
            : result.error || 'The operation is still pending.',
      );
      await refresh(g);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function confirm(id: string) {
    const g = generation.current;
    try {
      const result = await api(`approvals/${id}/confirm`, {});
      if (g !== generation.current) return;
      setNotice(
        result.status === 'completed'
          ? 'Transfer confirmed and completed.'
          : result.error || result.status,
      );
      if (pending?.approvalId === id) setPending(null);
      await refresh(g);
    } catch (e) {
      if (g !== generation.current) return;
      const message = (e as Error).message;
      if (/already confirmed/i.test(message)) {
        // The proposal was consumed elsewhere; it is done, so drop the card.
        if (pending?.approvalId === id) setPending(null);
        setNotice('This proposal was already confirmed.');
        try {
          await refresh(g);
        } catch {}
      } else if (/expired/i.test(message) && pending?.approvalId === id) {
        setPending({ ...pending, expired: true });
        setError(message);
      } else {
        setError(message);
      }
    }
  }
  function requestAgain() {
    const p = pending;
    if (!p?.proposal) return;
    setFrom(p.proposal.fromAccountId || '');
    setTo(p.proposal.toAccountId || '');
    setAmount(((p.proposal.amountCents || 0) / 100).toFixed(2));
    setConcept(p.proposal.concept || '');
    setPending(null);
  }
  const operator = current?.role === 'operator';
  const nav = operator
    ? [
        ['overview', 'overview', 'Cases'],
        ['documents', 'document', 'Documents'],
      ]
    : [
        ['overview', 'overview', 'Overview'],
        ['chat', 'chat', 'Assistant'],
        ['transfer', 'transfer', 'Transfers'],
        ['documents', 'document', 'Documents'],
      ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Banana Bank home">
          <span className="brand-symbol" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 32 32">
              <path d="M25 4c1 13-7 22-20 20 6 9 25 1 23-16Z" fill="currentColor" />
              <path d="m24 5 1-3 3 1" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
          banana<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">{operator ? 'CUSTOMER SUPPORT' : 'PERSONAL BANKING'}</div>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? 'active' : ''}`}
              onClick={() => (id === 'documents' ? openLibrary() : setTab(id))}
            >
              <Icon name={icon} />
              {label}
              {id === 'chat' && <span className="ai-badge">AI</span>}
            </button>
          ))}
        </nav>
        {!operator && (
          <>
            <div className="history-heading">
              CONVERSATIONS
              <button aria-label="New conversation" onClick={newConversation}>
                +
              </button>
            </div>
            <div className="conversation-list">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  className={conversationId === c.id ? 'selected' : ''}
                  onClick={() => openConversation(c.id)}
                >
                  <span className="conversation-dot" />
                  {c.title}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <span className="live-dot" />
          Demo environment<p>Simulated people and money</p>
          <span className="banana-mark">banana / LAB</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Banana Bank <span>/</span> {operator ? 'Customer support' : 'Personal banking'}
          </div>
          <div className="persona-control">
            <span className="demo-label">VIEW AS</span>
            <span className="avatar small" style={{ background: current?.color }}>
              {current?.initials || '·'}
            </span>
            <select
              aria-label="Switch person"
              value={current?.id || ''}
              disabled={!current}
              onChange={(e) => selectPerson(e.target.value)}
            >
              <option value="" disabled>
                Loading…
              </option>
              <optgroup label="Customers">
                {people
                  .filter((p) => p.role === 'customer')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Operators">
                {people
                  .filter((p) => p.role === 'operator')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · Operator
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert notice" role="status">
              {notice}
              <button onClick={() => setNotice('')} aria-label="Dismiss notice">
                ×
              </button>
            </div>
          )}
          {!current || !dashboard ? (
            <div className="loading">
              <span className="spinner" /> Getting things ready…
            </div>
          ) : (
            <>
              {tab === 'overview' && !operator && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">YOUR DAY, A LITTLE BRIGHTER</div>
                      <h1>
                        Hello, {current.name.split(' ')[0]}
                        <span className="hello-dot">.</span>
                      </h1>
                      <p>Your accounts at a glance. A helping hand when you need one.</p>
                    </div>
                    <span className="date-chip">24 September 2026</span>
                  </div>
                  <div className="account-grid">
                    {dashboard.accounts?.map((a: AnyRecord, i: number) => (
                      <section
                        className={`account-card ${i === 0 ? 'primary-account' : ''}`}
                        key={a.id}
                      >
                        <div className="account-top">
                          <span>{a.label}</span>
                          <span className="account-icon">↗</span>
                        </div>
                        <div className="balance-label">AVAILABLE BALANCE</div>
                        <div className="balance">{money(a.balanceCents)}</div>
                        <div className="account-bottom">
                          <span>
                            {a.iban.slice(0, 9)} ···· {a.iban.slice(-4)}
                          </span>
                          <span>EUR</span>
                        </div>
                      </section>
                    ))}
                    <section className="assistant-card">
                      <div className="sparkle">✧</div>
                      <h2>
                        Your bank speaks <br />
                        your language.
                      </h2>
                      <p>Check the details, move your money, or ask for help.</p>
                      <button
                        className="text-button"
                        onClick={() => {
                          setTab('chat');
                        }}
                      >
                        Talk to the assistant <Icon name="arrow" />
                      </button>
                    </section>
                  </div>
                  <div className="dashboard-bottom">
                    <section className="panel movements">
                      <div className="section-title">
                        <h2>Recent activity</h2>
                        <span>Latest transactions</span>
                      </div>
                      {dashboard.movements?.slice(0, 7).map((m: AnyRecord) => (
                        <div className="movement" key={m.id}>
                          <span className={`movement-icon ${m.amountCents > 0 ? 'positive' : ''}`}>
                            {m.amountCents > 0 ? '↙' : '↗'}
                          </span>
                          <div>
                            <strong>{m.description}</strong>
                            <small>{date(m.createdAt)}</small>
                          </div>
                          <b className={m.amountCents > 0 ? 'credit' : ''}>
                            {m.amountCents > 0 ? '+' : ''}
                            {money(m.amountCents)}
                          </b>
                        </div>
                      ))}
                    </section>
                    <div className="right-stack">
                      <section className="quick-action">
                        <span className="eyebrow">STRAIGHT TO IT</span>
                        <h2>
                          A transfer,
                          <br />
                          when you need one.
                        </h2>
                        <button className="primary-button" onClick={() => setTab('transfer')}>
                          Make a transfer <Icon name="arrow" />
                        </button>
                      </section>
                      <section className="support-card">
                        <Icon name="help" />
                        <h3>Here when you need us</h3>
                        <p>Pick up a conversation or ask a person for help.</p>
                        <button className="text-button" onClick={() => setTab('chat')}>
                          Open my conversations <span>↗</span>
                        </button>
                      </section>
                    </div>
                  </div>
                </>
              )}
              {tab === 'chat' && !operator && (
                <div className="chat-layout">
                  <div className="page-heading compact">
                    <div>
                      <div className="eyebrow">ONE CONVERSATION, PLENTY OF POSSIBILITIES</div>
                      <h1>Your assistant</h1>
                      <p>Ask, plan, and get things done here.</p>
                    </div>
                    <button className="secondary-button" onClick={newConversation}>
                      + New conversation
                    </button>
                  </div>
                  <label className="conversation-picker">
                    Conversation
                    <select
                      aria-label="Conversation"
                      value={conversationId || ''}
                      onChange={(e) => openConversation(e.target.value)}
                    >
                      <option value="">New conversation</option>
                      {conversations.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <section className="chat-panel">
                    <div className="chat-header">
                      <span className="assistant-avatar">✧</span>
                      <div>
                        <strong>Banana Bank assistant</strong>
                        <small>
                          <span className="live-dot" /> Here to help
                        </small>
                      </div>
                      <span className="subtle-tag">{current.name.split(' ')[0]}</span>
                    </div>
                    <div className="messages">
                      {!messages.length && (
                        <div className="chat-empty">
                          <span className="big-sparkle">✧</span>
                          <h2>What do you need today?</h2>
                          <p>Start with your accounts or a question.</p>
                          <div className="suggestions">
                            {[
                              'What are the balances of my accounts?',
                              'When is the Aurora account fee waived?',
                              'I want to speak to a person',
                            ].map((s) => (
                              <button key={s} disabled={busy} onClick={() => send(s)}>
                                {s}
                                <span>↗</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {messages.map((m, i) => (
                        <div className={`message ${m.role}`} key={m.id || i}>
                          {m.role === 'assistant' && <span className="message-avatar">✧</span>}
                          <div className="bubble">
                            <div>
                              {m.role === 'assistant'
                                ? String(m.content)
                                    .split(
                                      /(\*\*[^*]+\*\*|\[[A-Za-z0-9][A-Za-z0-9._-]* v\d+\])/g,
                                    )
                                    .map((part, j) => {
                                      if (part.startsWith('**') && part.endsWith('**'))
                                        return <strong key={j}>{part.slice(2, -2)}</strong>;
                                      const citation = part.match(
                                        /^\[([A-Za-z0-9][A-Za-z0-9._-]*) v(\d+)\]$/,
                                      );
                                      if (citation)
                                        return (
                                          <button
                                            key={j}
                                            className="subtle-tag"
                                            style={{
                                              display: 'inline-block',
                                              margin: '2px 3px',
                                            }}
                                            title={`${citation[1]} · v${citation[2]}`}
                                            aria-label={`Open source document ${citation[1]}, version ${citation[2]}`}
                                            onClick={() => openCitation(citation[1])}
                                          >
                                            {citation[1]} · v{citation[2]}
                                          </button>
                                        );
                                      return part;
                                    })
                                : String(m.content)
                                    .split(/(\*\*[^*]+\*\*)/g)
                                    .map((part, j) =>
                                      part.startsWith('**') && part.endsWith('**') ? (
                                        <strong key={j}>{part.slice(2, -2)}</strong>
                                      ) : (
                                        part
                                      ),
                                    )}
                            </div>
                            <small>{date(m.created_at)}</small>
                          </div>
                        </div>
                      ))}
                      {busy && (
                        <div className="message assistant">
                          <span className="message-avatar">✧</span>
                          <div className="thinking">
                            <i />
                            <i />
                            <i />
                            <span>Checking…</span>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEnd} />
                    </div>
                    <form
                      className="composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        send();
                      }}
                    >
                      <textarea
                        aria-label="Message the assistant"
                        placeholder="What can we help with?"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                        rows={2}
                      />
                      <button aria-label="Send message" disabled={busy || !text.trim()}>
                        <Icon name="arrow" />
                      </button>
                    </form>
                    <div className="chat-footnote">
                      AI assistant · Check important details before taking action.
                    </div>
                  </section>
                </div>
              )}
              {tab === 'transfer' && !operator && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">FROM ONE ACCOUNT TO ANOTHER</div>
                      <h1>Transfers</h1>
                      <p>Send money to another account in this environment.</p>
                    </div>
                  </div>
                  <div className="transfer-layout">
                    <form
                      className="panel transfer-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitTransfer();
                      }}
                    >
                      <h2>Your transfer details</h2>
                      <label>
                        From account
                        <select value={from} onChange={(e) => setFrom(e.target.value)} required>
                          {dashboard.accounts?.map((a: AnyRecord) => (
                            <option key={a.id} value={a.id}>
                              {a.label} · {a.id} · {money(a.balanceCents)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Recipient
                        <select value={to} onChange={(e) => setTo(e.target.value)} required>
                          <option value="">Select an account</option>
                          {dashboard.contacts?.map((a: AnyRecord) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.label} · {a.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Amount in euros
                        <div className="amount-input">
                          <input
                            aria-label="Amount in euros"
                            type="number"
                            step="0.01"
                            min="0.01"
                            max="100000"
                            required
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                          />
                          <span>EUR</span>
                        </div>
                      </label>
                      <label>
                        Description
                        <input
                          value={concept}
                          onChange={(e) => setConcept(e.target.value)}
                          placeholder="What is this transfer for?"
                          maxLength={200}
                          required
                        />
                      </label>
                      <button className="primary-button" disabled={busy}>
                        {busy ? 'Processing…' : 'Send transfer'}
                        <Icon name="arrow" />
                      </button>
                    </form>
                    <aside className="transfer-note">
                      <Icon name="transfer" />
                      <h2>
                        It is all in
                        <br />
                        your activity.
                      </h2>
                      <p>
                        Check your activity to see the status of your transfers. If you have any
                        questions, the assistant can help.
                      </p>
                      <button className="text-button" onClick={() => setTab('overview')}>
                        View my accounts ↗
                      </button>
                    </aside>
                  </div>
                  {pending &&
                    (() => {
                      const remaining = remainingMs(pending.expiresAt);
                      const cardExpired =
                        pending.expired || (Number.isFinite(remaining) && remaining <= 0);
                      return (
                        <section
                          className="panel"
                          ref={confirmCardRef}
                          aria-label="Confirm your transfer"
                          style={{ marginTop: 16 }}
                        >
                          <div className="section-title">
                            <h2>Confirm your transfer</h2>
                            <span className="subtle-tag">Nothing moved yet</span>
                          </div>
                          <p>
                            <strong>
                              {money(pending.proposal?.amountCents ?? 0)}
                            </strong>{' '}
                            · {accountLabel(pending.proposal?.fromAccountId || '')} →{' '}
                            {accountLabel(pending.proposal?.toAccountId || '')}
                          </p>
                          <p>{pending.proposal?.concept}</p>
                          {cardExpired ? (
                            <>
                              <p role="status" aria-live="polite">
                                This proposal expired. Request the transfer again.
                              </p>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="primary-button" onClick={requestAgain}>
                                  Request again
                                </button>
                                <button
                                  className="secondary-button"
                                  onClick={() => setPending(null)}
                                >
                                  Discard
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              {Number.isFinite(remaining) && (
                                <small role="status" aria-live="polite">
                                  <Icon name="clock" /> Expires in {countdown(remaining)}
                                </small>
                              )}
                              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                <button
                                  className="primary-button"
                                  onClick={() => confirm(pending.approvalId)}
                                >
                                  Confirm these details
                                </button>
                                <button
                                  className="secondary-button"
                                  onClick={() => setPending(null)}
                                >
                                  Discard
                                </button>
                              </div>
                            </>
                          )}
                        </section>
                      );
                    })()}
                </>
              )}
              {dashboard.approvals?.length > 0 && (
                <section className="panel approvals">
                  <h2>Proposals awaiting confirmation</h2>
                  {dashboard.approvals.map((a: AnyRecord) => {
                    const remaining = remainingMs(a.expires_at);
                    return (
                      <div key={a.id}>
                        <p>
                          <strong>{money(a.payload.amountCents)}</strong> ·{' '}
                          {accountLabel(a.payload.fromAccountId)} →{' '}
                          {accountLabel(a.payload.toAccountId)}
                        </p>
                        <p>{a.payload.concept}</p>
                        {Number.isFinite(remaining) && remaining > 0 && (
                          <p>
                            <small role="status" aria-live="polite">
                              Expires in {countdown(remaining)}
                            </small>
                          </p>
                        )}
                        <button className="primary-button" onClick={() => confirm(a.id)}>
                          Confirm these details
                        </button>
                      </div>
                    );
                  })}
                </section>
              )}
              {tab === 'overview' && operator && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">CUSTOMER SUPPORT</div>
                      <h1>Every case, a person.</h1>
                      <p>
                        Hello, {current.name.split(' ')[0]}. Here are your customer support cases.
                      </p>
                    </div>
                    <div className="case-count">
                      <strong>
                        {dashboard.incidents?.filter((c: AnyRecord) => c.status === 'open')
                          .length || 0}
                      </strong>
                      <span>open cases</span>
                    </div>
                  </div>
                  <div className="operator-grid">
                    <section className="panel case-list">
                      <div className="section-title">
                        <h2>Inbox</h2>
                        <span className="subtle-tag">All cases</span>
                      </div>
                      {dashboard.incidents?.map((c: AnyRecord) => (
                        <button
                          key={c.id}
                          className={`case-item ${selectedCase?.incident.id === c.id ? 'selected' : ''}`}
                          onClick={async () => {
                            const g = generation.current;
                            try {
                              const d = await api(`incidents/${c.id}`);
                              if (g === generation.current) setSelectedCase(d);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <span
                            className="avatar"
                            style={{ background: people.find((p) => p.id === c.user_id)?.color }}
                          >
                            {people.find((p) => p.id === c.user_id)?.initials}
                          </span>
                          <div>
                            <strong>{people.find((p) => p.id === c.user_id)?.name}</strong>
                            <p>{c.summary}</p>
                            <small>
                              {date(c.created_at)} · {c.status === 'closed' ? 'Resolved' : 'Open'}
                            </small>
                          </div>
                          <span>↗</span>
                        </button>
                      ))}
                    </section>
                    <section className="panel case-detail">
                      {selectedCase ? (
                        <>
                          <div className="eyebrow">
                            CASE {selectedCase.incident.id.slice(0, 12)}
                          </div>
                          <h2>{selectedCase.customer.name}</h2>
                          <span className="status-pill">
                            {selectedCase.incident.status === 'closed'
                              ? 'Resolved'
                              : 'Awaiting support'}
                          </span>
                          {selectedCase.incident.status !== 'closed' && (
                            <button className="primary-button" disabled={busy} onClick={resolveCase}>
                              Resolve case
                            </button>
                          )}
                          <h3>Latest message</h3>
                          <blockquote>{selectedCase.lastMessage?.content}</blockquote>
                          <p className="muted">Received {date(selectedCase.incident.created_at)}</p>
                          {selectedCase.history?.length > 0 && (
                            <>
                              <h3>Conversation</h3>
                              {selectedCase.history.map((m: AnyRecord) => (
                                <p key={m.id}>
                                  <b>{m.role === 'user' ? 'Customer' : 'Assistant'}:</b> {m.content}
                                </p>
                              ))}
                            </>
                          )}
                          {selectedCase.events?.length > 0 && (
                            <>
                              <h3>Agent activity</h3>
                              {selectedCase.events.map((e: AnyRecord) => (
                                <details key={e.id}>
                                  <summary>
                                    {e.kind} · {date(e.created_at)}
                                  </summary>
                                  <pre>{JSON.stringify(e.data, null, 2)}</pre>
                                </details>
                              ))}
                            </>
                          )}
                          {selectedCase.bank && (
                            <>
                              <h3>Bank operations</h3>
                              {selectedCase.bank.operations.map((o: AnyRecord) => (
                                <div className="evidence-row" key={o.id}>
                                  {money(o.amountCents)} · {o.status}
                                  <small>{o.reference}</small>
                                </div>
                              ))}
                            </>
                          )}
                          {selectedCase.gaps && <p className="muted">{selectedCase.gaps}</p>}
                        </>
                      ) : (
                        <div className="case-empty">
                          <Icon name="chat" />
                          <h2>Open a case</h2>
                          <p>Select a case to see the available information.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
              {tab === 'documents' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">SOURCES AND POLICIES</div>
                      <h1>The details, at hand.</h1>
                      <p>Read original sources and the excerpts retrieved by the assistant.</p>
                    </div>
                    {operator && (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={async () => {
                          const g = generation.current;
                          setBusy(true);
                          try {
                            const r = await api('ingestion', {});
                            if (g !== generation.current) return;
                            setNotice(
                              `Index updated: ${r.documents} documents, ${r.chunks} excerpts.`,
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? 'Updating…' : 'Update index'}
                      </button>
                    )}
                  </div>
                  <form
                    className="search-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const g = generation.current;
                      setBusy(true);
                      try {
                        const result = await api('search', { query });
                        if (g === generation.current) setSources(result.sources);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Icon name="document" />
                    <input
                      aria-label="Search documents"
                      placeholder="Ask about a policy or search for a product…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button className="primary-button" disabled={busy || !query.trim()}>
                      Search
                    </button>
                  </form>
                  {sources && (
                    <section className="search-results">
                      <div className="section-title">
                        <h2>Retrieved excerpts</h2>
                        <button className="text-button" onClick={() => setSources(null)}>
                          Close results ×
                        </button>
                      </div>
                      {sources.map((s) => (
                        <article key={s.id}>
                          <span className="subtle-tag">Similarity {s.score.toFixed(3)}</span>
                          <h3>{s.title || 'No title in the index'}</h3>
                          <small>
                            {s.documentId} · Version {s.version ?? '—'}
                          </small>
                          <p>{s.text}</p>
                        </article>
                      ))}
                    </section>
                  )}
                  <div className="documents-layout">
                    <section className="panel document-list">
                      <div className="section-title">
                        <h2>Documents</h2>
                        <span>{docs.length} sources</span>
                      </div>
                      {docs.map((d) => (
                        <button
                          key={d.id}
                          className={document?.id === d.id ? 'selected' : ''}
                          onClick={async () => {
                            const g = generation.current;
                            try {
                              const result = await api(`documents/${d.id}`);
                              if (g === generation.current) setDocument(result);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <Icon name="document" />
                          <span>
                            <strong>{d.title}</strong>
                            <small>
                              v{d.version} ·{' '}
                              {d.validTo
                                ? 'Archive'
                                : d.audience === 'internal'
                                  ? 'Internal'
                                  : 'Current'}
                            </small>
                          </span>
                          <span>↗</span>
                        </button>
                      ))}
                    </section>
                    <section className="panel document-reader">
                      {document ? (
                        <>
                          <div className="eyebrow">ORIGINAL SOURCE · V{document.version}</div>
                          <h2>{document.title}</h2>
                          <p className="muted">
                            Effective: {document.validFrom}
                            {document.validTo ? ` — ${document.validTo}` : ''}
                          </p>
                          <pre>{document.text}</pre>
                        </>
                      ) : (
                        <div className="case-empty">
                          <Icon name="document" />
                          <h2>Open a source</h2>
                          <p>Check policies, exceptions, and dates in the original document.</p>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </main>
        <footer>
          banana<span>A simulated environment for building better experiences.</span>
          <span>banana · 2026</span>
        </footer>
      </div>
    </div>
  );
}
