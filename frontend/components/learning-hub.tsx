'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n';

type Message = { role: 'user' | 'assistant'; content: string; sources?: { title: string; url: string }[] };

export function LearningHub({ locale = 'bn' }: { locale?: Locale }) {
  const en = locale === 'en';
  const l = (bn: string, english: string) => en ? english : bn;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const pending = useRef(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, busy, open]);

  async function send() {
    const question = input.trim();
    if (question.length < 2 || question.length > 1200 || pending.current) return;
    pending.current = true;
    setMessages(old => [...old, { role: 'user', content: question }]);
    setInput('');
    setBusy(true);
    const add = (content: string, sources?: Message['sources']) => setMessages(old => [...old, { role: 'assistant', content, sources }]);
    const unavailable = l('সহকারী সাময়িকভাবে অনুপলব্ধ।', 'The assistant is temporarily unavailable.');
    try {
      const res = await fetch('/api/learning-hub', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(46_000),
        body: JSON.stringify({ question, locale, history: messages.slice(-6).map(m => ({ role: m.role, content: m.content.slice(0, 600) })) }),
      });
      const data = await res.json();
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      setNeedsLogin(res.status === 401);
      if (res.status === 401) add(l('প্রশ্ন পাঠাতে লগইন করুন।', 'Sign in to send a question.'));
      else if (res.status === 429) add(l('আজকের ১০টি প্রশ্ন শেষ। ঢাকা সময় রাত ১২টার পর আবার চেষ্টা করুন।', 'Daily limit reached. Try again after midnight in Dhaka.'));
      else if (!res.ok) add(unavailable);
      else add(data.answer || l('প্রকাশিত সংবাদে এই প্রশ্নের যথেষ্ট তথ্য পাওয়া যায়নি।', 'The published archive did not contain enough information.'), data.sources);
    } catch {
      add(unavailable);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const label = l('এআই সংবাদ সহকারী', 'AI News Assistant');
  return <>
    <button type="button" ref={launcher} aria-expanded={open} aria-label={label} onClick={() => setOpen(v => !v)}
      className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary font-bold text-white shadow-xl">
      {open ? 'X' : '?'}
    </button>
    {open && <section role="dialog" aria-label={label} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); launcher.current?.focus(); } }}
      className="fixed bottom-24 right-4 z-50 flex h-[min(520px,calc(100dvh-7rem))] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-paper text-ink shadow-2xl dark:border-white/15 dark:bg-ink dark:text-white">
      <header className="bg-[#12251f] p-4 text-white">
        <h2 className="font-serifbn text-lg font-bold">{label}</h2>
        <p className="text-xs text-emerald-100">{l('প্রকাশিত সংবাদ · দিনে ১০টি প্রশ্ন', 'Published news · 10 questions per day')}</p>
      </header>
      <div ref={log} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {!messages.length && <p>{l('বাংলার ভয়েসের প্রকাশিত কোনো সংবাদ বা বিষয় নিয়ে প্রশ্ন লিখুন।', 'Ask about a topic covered by Banglar Voice.')}</p>}
        {messages.map((m, i) => <div key={i} className={`max-w-[92%] whitespace-pre-wrap break-words rounded-xl p-3 ${m.role === 'user' ? 'ml-auto bg-primary text-white' : 'bg-muted dark:bg-white/10'}`}>
          {m.content}
          {m.sources?.slice(0, 5).map((s, index) => <a key={`${s.url}-${index}`} href={s.url} className="block underline">[{index + 1}] {s.title}</a>)}
        </div>)}
        {busy && <p>{l('উত্তর প্রস্তুত হচ্ছে…', 'Preparing an answer…')}</p>}
      </div>
      {(needsLogin || remaining !== null) && <p className="px-4 pb-1 text-xs" aria-live="polite">
        {needsLogin ? <Link href="/login" className="font-bold underline">{l('লগইন', 'Sign in')}</Link> : l(`আজ বাকি: ${remaining?.toLocaleString('bn-BD')}`, `Remaining today: ${remaining}`)}
      </p>}
      <form onSubmit={event => { event.preventDefault(); void send(); }} className="flex gap-2 border-t border-border p-3 dark:border-white/15">
        <input ref={inputRef} maxLength={1200} value={input} onChange={event => setInput(event.target.value)} aria-label={l('প্রশ্ন', 'Question')}
          placeholder={l('প্রশ্ন লিখুন…', 'Type your question…')} className="min-w-0 flex-1 rounded-xl bg-muted p-2.5 text-sm dark:bg-white/10" />
        <button type="submit" disabled={busy || input.trim().length < 2} className="rounded-xl bg-primary px-3 text-sm font-bold text-white disabled:opacity-50">{l('পাঠান', 'Send')}</button>
      </form>
    </section>}
  </>;
}
