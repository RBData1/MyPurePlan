import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import DashboardApp from './DashboardApp';
import { supabase } from './supabase';

type Workspace = { id: string; name: string };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setWorkspaceError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (!nextSession) setWorkspace(null);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setWorkspace(null);
      setWorkspaceLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceLoading(true);
    setWorkspaceError('');
    (async () => {
      const { data: membership, error: membershipError } = await supabase!
        .from('business_members').select('business_id').eq('user_id', session.user.id).limit(1).maybeSingle();
      if (cancelled) return;
      if (membershipError) {
        setWorkspaceError(membershipError.message);
        setWorkspaceLoading(false);
        return;
      }
      if (!membership) {
        setWorkspace(null);
        setWorkspaceLoading(false);
        return;
      }
      const { data: business, error: businessError } = await supabase!
        .from('businesses').select('id,name').eq('id', membership.business_id).maybeSingle();
      if (cancelled) return;
      if (businessError) {
        setWorkspaceError(businessError.message);
      } else if (business) {
        setWorkspace({ id: business.id as string, name: business.name as string });
      } else {
        setWorkspaceError('Your workspace membership was found, but the business record could not be loaded.');
      }
      setWorkspaceLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session?.user.id]);

  if (!supabase) {
    return <DashboardApp businessId={null} businessName="ClearView Windows" userEmail="Business owner" />;
  }

  const signOut = async () => { await supabase?.auth.signOut(); setWorkspace(null); };
  if (authLoading) return <FullPage title="Connecting to Supabase" text="Checking your secure sign-in session…" />;
  if (!session) return <AuthPage />;
  if (workspaceLoading) return <FullPage title="Loading your workspace" text="Checking your business account…" />;
  if (workspaceError) return <FullPage title="Could not load your workspace" text={workspaceError} actionLabel="Try again" onAction={() => window.location.reload()} onSignOut={signOut} />;
  if (!workspace) return <CreateWorkspace onCreated={setWorkspace} onSignOut={signOut} />;

  return <DashboardApp businessId={workspace.id} businessName={workspace.name} userEmail={session.user.email ?? 'Business owner'} onSignOut={signOut} />;
}

function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setMessage(''); setError('');
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (signUpError) throw signUpError;
        if (!data.session) setMessage('Account created. Check your email for a verification link, then return here to sign in.');
        else setMessage('Account created successfully.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) throw signInError;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed. Please try again.');
    } finally { setBusy(false); }
  }

  return <div className="auth-shell"><div className="auth-card">
    <div className="auth-logo"><div className="brand-mark auth-brand-mark"><Sparkles size={21} /></div><div><strong>MyPurePlan</strong><span>WINDOW CARE PRO</span></div></div>
    <div className="auth-heading"><div className="auth-eyebrow">YOUR BUSINESS, ORGANISED</div><h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1><p>{mode === 'signin' ? 'Sign in to manage your customers and cleaning schedule.' : 'Set up a secure account for your window cleaning business.'}</p></div>
    <form className="auth-form" onSubmit={submit}>
      <label>Email address<div className="auth-input-wrap"><Mail size={17}/><input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@yourbusiness.co.uk" required /></div></label>
      <label>Password<div className="auth-input-wrap"><LockKeyhole size={17}/><input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={6} placeholder="At least 6 characters" required /></div></label>
      {error && <div className="auth-alert auth-alert-error">{error}</div>}
      {message && <div className="auth-alert auth-alert-success"><CheckCircle2 size={17}/><span>{message}</span></div>}
      <button className="button primary auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in securely' : 'Create account'} <ArrowRight size={16}/></button>
    </form>
    <p className="auth-switch">{mode === 'signin' ? 'New to MyPurePlan?' : 'Already have an account?'} <button onClick={()=>{setMode(mode==='signin'?'signup':'signin');setError('');setMessage('')}}>{mode === 'signin' ? 'Create an account' : 'Sign in'}</button></p>
    <p className="auth-privacy">Your business data is stored in your own protected Supabase workspace.</p>
  </div></div>;
}

function CreateWorkspace({ onCreated, onSignOut }: { onCreated: (workspace: Workspace) => void; onSignOut: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError('');
    const { data, error: createError } = await supabase.rpc('create_business_for_current_user', { business_name: name.trim() });
    setBusy(false);
    if (createError) { setError(createError.message); return; }
    if (typeof data !== 'string') { setError('The workspace was not created. Please try again.'); return; }
    onCreated({ id: data, name: name.trim() });
  }
  return <div className="auth-shell"><div className="auth-card">
    <div className="auth-logo"><div className="brand-mark auth-brand-mark"><Sparkles size={21}/></div><div><strong>MyPurePlan</strong><span>WINDOW CARE PRO</span></div></div>
    <div className="auth-heading"><div className="auth-eyebrow">ONE LAST STEP</div><h1>Set up your workspace</h1><p>Enter your business name. Your first workspace and default services will be created in Supabase.</p></div>
    <form className="auth-form" onSubmit={submit}><label>Business name<input className="auth-plain-input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. ClearView Window Cleaning" minLength={2} maxLength={100} required /></label>
      {error && <div className="auth-alert auth-alert-error">{error}<p className="auth-help">If this mentions a missing function, run the SQL setup script in Supabase first.</p></div>}
      <button className="button primary auth-submit" disabled={busy}>{busy ? 'Creating workspace…' : 'Create my workspace'} <ArrowRight size={16}/></button>
    </form>
    <p className="auth-switch"><button onClick={onSignOut}>Sign out</button></p>
  </div></div>;
}

function FullPage({ title, text, actionLabel, onAction, onSignOut }: { title: string; text: string; actionLabel?: string; onAction?: () => void; onSignOut?: () => void }) {
  return <div className="auth-shell"><div className="auth-card auth-message-card"><div className="brand-mark auth-brand-mark"><Sparkles size={21}/></div><h1>{title}</h1><p>{text}</p>{actionLabel && <button className="button primary auth-submit" onClick={onAction}>{actionLabel}</button>}{onSignOut && <button className="auth-text-button" onClick={onSignOut}>Sign out</button>}</div></div>;
}
