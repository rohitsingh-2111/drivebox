import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight,
  Cloud, File, FileCode2, FileImage, FileMusic, FileText, FileVideo, Folder, FolderInput,
  FolderPlus, HardDrive, History, Info, LayoutGrid, List, LoaderCircle, LogOut, Menu,
  MoreHorizontal, Pencil, Plus, RotateCcw, Search, ShieldCheck, Trash2, Upload, Users,
  X, AlertCircle, LockKeyhole, Mail, UserRound, Eye, EyeOff,
} from 'lucide-react';
import { api, downloadFile, formatBytes, formatDate } from './api.js';

const VIEW_LABELS = { drive: 'My files', shared: 'Shared with me', trash: 'Trash' };
const PAGE_SIZE = 20;

function Brand({ light = false }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-symbol"><Cloud size={25} strokeWidth={2.6} /></span><span>drivebox<span className="brand-dot">.</span></span></div>;
}

function Spinner({ label = 'Loading…' }) {
  return <span className="spinner"><LoaderCircle size={18} className="spin" /><span>{label}</span></span>;
}

function ErrorNote({ children }) {
  return children ? <div className="error-note" role="alert"><AlertCircle size={17} /><span>{children}</span></div> : null;
}

function FileBadge({ item, large = false }) {
  const ext = item.name?.split('.').pop()?.toLowerCase();
  const mime = item.mimeType || '';
  let Icon = File, color = 'slate';
  if (item.kind === 'folder') { Icon = Folder; color = 'amber'; }
  else if (mime.startsWith('image/')) { Icon = FileImage; color = 'purple'; }
  else if (mime.startsWith('video/')) { Icon = FileVideo; color = 'pink'; }
  else if (mime.startsWith('audio/')) { Icon = FileMusic; color = 'pink'; }
  else if (['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'py', 'sh'].includes(ext)) { Icon = FileCode2; color = 'green'; }
  else if (mime.includes('pdf') || ext === 'pdf') { Icon = FileText; color = 'red'; }
  else if (mime.startsWith('text/') || ['doc', 'docx', 'txt', 'md'].includes(ext)) { Icon = FileText; color = 'blue'; }
  return <span className={`file-badge ${color} ${large ? 'file-badge-large' : ''}`}><Icon size={large ? 33 : 23} strokeWidth={1.7} /></span>;
}

function Modal({ title, subtitle, children, onClose, wide = false, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const timer = setTimeout(() => (ref.current?.querySelector('input:not([type="file"]), select, textarea') || ref.current?.querySelector('button'))?.focus(), 20);
    const key = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key === 'Tab') {
        const elements = [...(ref.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href], [tabindex="0"]') || [])];
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(timer); document.removeEventListener('keydown', key); document.body.style.overflow = ''; previous?.focus(); };
  }, [onClose, busy]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`modal ${wide ? 'modal-wide' : ''}`}>
      <header className="modal-header"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={21} /></button></header>
      {children}
    </section>
  </div>;
}

function Auth({ onAuthenticated, expired }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { const result = await api(`/auth/${mode}`, { method: 'POST', body: mode === 'register' ? form : { email: form.email, password: form.password } }); onAuthenticated(result.user); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-story">
      <Brand light />
      <div className="auth-story-copy"><span className="eyebrow light-eyebrow">SPACE FOR YOUR NEXT BIG THING</span><h1>All your files.<br />A little more<br /><span>possibility.</span></h1><p>A thoughtful home for your work. Keep things organized, share with your people, and never lose a version.</p></div>
      <div className="auth-art" aria-hidden="true"><div className="art-orbit" /><div className="art-file art-file-one"><FileImage size={31} /><span>Creative ideas</span><div className="art-line" /></div><div className="art-folder"><Folder size={85} fill="currentColor" strokeWidth={1} /><span>Your next chapter</span></div><div className="art-file art-file-two"><FileText size={30} /><span>Great work.pdf</span><div className="art-line" /></div><span className="art-check"><Check size={23} /></span></div>
      <div className="auth-foot"><ShieldCheck size={17} /><span>Private by default. Built for collaboration.</span></div>
    </section>
    <section className="auth-form-section"><div className="auth-mobile-brand"><Brand /></div><div className="auth-form-wrap">
      <span className="small-overline">YOUR PERSONAL WORKSPACE</span><h2>{mode === 'login' ? 'Welcome back.' : 'Make room for more.'}</h2><p className="auth-subtitle">{mode === 'login' ? 'Sign in and pick up where you left off.' : 'Create your account and bring your files together.'}</p>
      {expired && <div className="notice">Your session expired. Sign in to continue.</div>}
      <form onSubmit={submit} className="auth-form">
        {mode === 'register' && <label>Full name<div className="input-icon"><UserRound size={18} /><input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name" /></div></label>}
        <label>Email address<div className="input-icon"><Mail size={18} /><input required type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></div></label>
        <label>Password<div className="input-icon"><LockKeyhole size={18} /><input required minLength={mode === 'register' ? 10 : 1} maxLength={128} type={visible ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={mode === 'register' ? 'At least 10 characters' : 'Enter your password'} /><button type="button" className="password-toggle" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <ErrorNote>{error}</ErrorNote><button type="submit" className="button primary auth-submit" disabled={busy}>{busy ? <Spinner label="Please wait…" /> : <>{mode === 'register' ? 'Create account' : 'Sign in'}<ArrowRight size={18} /></>}</button>
      </form>
      <p className="auth-switch">{mode === 'login' ? 'New to Drivebox?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
      <div className="auth-form-foot"><span className="tiny-status" />Your files. Your space.</div>
    </div></section>
  </main>;
}

function Pagination({ page, total, limit = PAGE_SIZE, onChange, label = 'items' }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (!total) return null;
  return <div className="pagination"><span>{Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total} {label}</span><div><button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronRight className="rotate-180" size={18} /></button><span>Page {page} of {pages}</span><button className="icon-button" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={18} /></button></div></div>;
}

function NameDialog({ mode, item, parentId, onClose, onDone }) {
  const [name, setName] = useState(item?.name || '');
  const [revision, setRevision] = useState(item?.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isRename = mode === 'rename';
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(isRename ? `/items/${item.id}` : '/folders', { method: isRename ? 'PATCH' : 'POST', body: isRename ? { name: name.trim(), revision } : { name: name.trim(), ...(parentId ? { parentId } : {}) } });
      onDone(isRename ? 'Name updated.' : 'Folder created.');
    } catch (err) {
      if (err.status === 409 && isRename) {
        const latest = await api(`/items/${item.id}`).catch(() => null);
        if (latest && latest.item.revision !== revision) { setRevision(latest.item.revision); setError(`This item changed elsewhere. Its current name is “${latest.item.name}”. Review your name and try again.`); }
        else setError(err.message);
      } else setError(err.message);
    } finally { setBusy(false); }
  }
  return <Modal title={isRename ? 'Rename item' : 'A new place for your files'} subtitle={isRename ? 'Give it a name that’s easy to find.' : 'Create a folder in your current location.'} onClose={onClose} busy={busy}>
    <form onSubmit={submit}><div className="modal-body"><label className="field-label">{isRename ? 'Name' : 'Folder name'}<input autoFocus required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Brand assets" /></label><ErrorNote>{error}</ErrorNote></div><footer className="modal-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? <Spinner label="Saving…" /> : isRename ? 'Save name' : 'Create folder'}</button></footer></form>
  </Modal>;
}

function UploadDialog({ parentId, item, initialFiles = [], onClose, onDone }) {
  const [files, setFiles] = useState(initialFiles);
  const [revision, setRevision] = useState(item?.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const input = useRef(null);
  async function submit(event) {
    event.preventDefault(); if (!files.length) return;
    setBusy(true); setError(''); setProgress(0);
    let completed = 0;
    try {
      for (const file of files) {
        const body = new FormData(); body.append('file', file);
        if (item) body.append('revision', String(revision)); else if (parentId) body.append('parentId', parentId);
        await api(item ? `/files/${item.id}/versions` : '/files', { method: 'POST', body });
        completed += 1; setProgress(completed);
      }
      onDone(item ? 'New version uploaded.' : `${files.length} ${files.length === 1 ? 'file' : 'files'} uploaded.`);
    } catch (err) {
      setFiles(files.slice(completed));
      if (completed > 0) onDone(null, false);
      if (err.status === 409 && item) {
        const latest = await api(`/items/${item.id}`).catch(() => null);
        if (latest && latest.item.revision !== revision) { setRevision(latest.item.revision); setError('This file changed elsewhere. Review the version history before retrying your upload.'); }
        else setError(err.message);
      } else setError(`${completed ? `${completed} file(s) uploaded. ` : ''}${err.message}`);
    } finally { setBusy(false); }
  }
  return <Modal title={item ? 'Upload a new version' : 'Make yourself at home'} subtitle={item ? `Update “${item.name}” while keeping previous versions.` : 'Add files to your current folder.'} onClose={onClose} busy={busy}>
    <form onSubmit={submit}><div className="modal-body">
      <input ref={input} type="file" className="visually-hidden" aria-label={item ? 'Select new version' : 'Select files to upload'} multiple={!item} onChange={event => setFiles([...event.target.files])} />
      <button type="button" className="upload-zone" disabled={busy} onClick={() => input.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) setFiles([...event.dataTransfer.files].slice(0, item ? 1 : undefined)); }}><span className="upload-icon"><Upload size={27} /></span><strong>Choose {item ? 'a file' : 'files'} or drop {item ? 'it' : 'them'} here</strong><span>All file types are welcome</span></button>
      {files.length > 0 && <ul className="upload-files">{files.map((file, index) => <li key={`${file.name}-${index}`}><File size={17} /><span>{file.name}</span><small>{formatBytes(file.size)}</small>{!busy && <button className="icon-button" type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X size={15} /></button>}</li>)}</ul>}
      {busy && <div className="upload-progress" role="status"><Spinner label={`Uploading ${Math.min(progress + 1, files.length)} of ${files.length}…`} /><div className="progress-track"><span style={{ width: `${progress / files.length * 100}%` }} /></div></div>}
      <p className="helper-text">Previous versions and items in Trash count toward storage.</p><ErrorNote>{error}</ErrorNote>
    </div><footer className="modal-footer"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !files.length}>{busy ? <Spinner label="Uploading…" /> : <><Upload size={17} />Upload{files.length > 1 ? ` ${files.length} files` : ''}</>}</button></footer></form>
  </Modal>;
}

function MoveDialog({ item, restore = false, onClose, onDone }) {
  const [parent, setParent] = useState(null);
  const [data, setData] = useState({ items: [], breadcrumbs: [] });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(item.revision);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    (async () => {
      const params = new URLSearchParams({ view: 'drive', limit: '100', page: '1' });
      if (parent) params.set('parentId', parent);
      let first = await api(`/items?${params}`), all = [...first.items];
      const limit = first.limit || 100;
      for (let page = 2; page <= Math.ceil(first.total / limit); page++) { params.set('page', String(page)); all.push(...(await api(`/items?${params}`)).items); }
      if (alive) setData({ ...first, items: all.filter(entry => entry.kind === 'folder' && entry.id !== item.id && entry.permission === 'owner') });
    })().catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [parent, item.id]);
  async function move() {
    setBusy(true); setError('');
    try {
      await api(restore ? `/items/${item.id}/restore` : `/items/${item.id}`, { method: restore ? 'POST' : 'PATCH', body: { parentId: parent, ...(!restore ? { revision } : {}) } });
      onDone(restore ? 'Item restored.' : 'Item moved.');
    } catch (err) {
      if (err.status === 409 && !restore) {
        const latest = await api(`/items/${item.id}`).catch(() => null);
        if (latest && latest.item.revision !== revision) { setRevision(latest.item.revision); setError('This item changed elsewhere. Review the destination and try again.'); }
        else setError(err.message);
      } else setError(err.message);
    } finally { setBusy(false); }
  }
  return <Modal title={restore ? 'Restore to a folder' : 'Move to a folder'} subtitle={`Choose a home for “${item.name}”.`} onClose={onClose} busy={busy}>
    <div className="modal-body"><div className="picker-breadcrumbs"><button onClick={() => { setParent(null); setQuery(''); }}><HardDrive size={15} />My files</button>{data.breadcrumbs.map(crumb => <React.Fragment key={crumb.id}><ChevronRight size={14} /><button onClick={() => { setParent(crumb.id); setQuery(''); }}>{crumb.name}</button></React.Fragment>)}</div>
      <div className="input-icon picker-search"><Search size={17} /><input aria-label="Find a destination folder" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a folder here" /></div>
      <div className="folder-picker">{loading ? <div className="center-state"><Spinner /></div> : data.items.filter(folder => folder.name.toLowerCase().includes(query.toLowerCase())).map(folder => <button key={folder.id} onClick={() => { setParent(folder.id); setQuery(''); }}><FileBadge item={folder} /><span>{folder.name}</span><ChevronRight size={18} /></button>)}{!loading && !data.items.some(folder => folder.name.toLowerCase().includes(query.toLowerCase())) && <p className="picker-empty">No subfolders here. You can choose this location.</p>}</div>
      <p className="helper-text">Destination: {data.folder?.name || 'My files'}</p><ErrorNote>{error}</ErrorNote>
    </div><footer className="modal-footer"><button className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || loading || (!restore && (item.parentId || null) === parent)} onClick={move}>{busy ? <Spinner label="Saving…" /> : restore ? 'Restore here' : 'Move here'}</button></footer>
  </Modal>;
}

function TrashDialog({ item, onClose, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try { await api(`/items/${item.id}`, { method: 'DELETE' }); onDone('Moved to Trash.'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Move to Trash?" onClose={onClose} busy={busy}><div className="modal-body"><div className="selected-item"><FileBadge item={item} /><strong>{item.name}</strong></div><p className="dialog-copy">{item.kind === 'folder' ? 'This folder and everything inside it will move to Trash. ' : 'This file will move to Trash. '}Shared access will stop until you restore it.</p><p className="helper-text">You can restore it later. Trashed files still use storage.</p><ErrorNote>{error}</ErrorNote></div><footer className="modal-footer"><button className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button danger" onClick={submit} disabled={busy}>{busy ? <Spinner label="Moving…" /> : 'Move to Trash'}</button></footer></Modal>;
}

function ShareDialog({ item, onClose, onDone }) {
  const [shares, setShares] = useState([]), [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(''), [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { let alive = true; api(`/items/${item.id}/shares`).then(result => { if (alive) setShares(result.shares); }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [item.id]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const result = await api(`/items/${item.id}/shares`, { method: 'PUT', body: { email: email.trim(), role } }); setShares(result.shares); setEmail(''); setMessage('Access updated. They can now find this in Shared with me.'); onDone(null, false); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function revoke(share) {
    setBusy(true); setError(''); setMessage('');
    try { await api(`/items/${item.id}/shares/${share.userId}`, { method: 'DELETE' }); setShares(shares.filter(entry => entry.userId !== share.userId)); setMessage('Direct access removed. Access from a shared parent folder may still apply.'); onDone(null, false); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Modal title="Good work is better together" subtitle={`Share “${item.name}”`} onClose={onClose} busy={busy}><div className="modal-body">
    <form onSubmit={save} className="share-form"><label className="field-label">Add someone by email<input autoFocus type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="teammate@example.com" /></label><div className="share-controls"><select aria-label="Sharing permission" value={role} onChange={event => setRole(event.target.value)}><option value="viewer">Viewer · read and download</option><option value="editor">Editor · also edit and upload</option></select><button className="button primary" disabled={busy || !email.trim()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}Share</button></div></form>
    <p className="helper-text">They need a Drivebox account. Sharing a folder includes everything inside it. Enter an existing member’s email to change their role.</p><ErrorNote>{error}</ErrorNote>{message && <div className="success-note" role="status"><Check size={17} />{message}</div>}
    <h3 className="section-label">DIRECT ACCESS <span>{shares.length}</span></h3><div className="share-list">{loading ? <Spinner /> : shares.length ? shares.map(share => <div className="share-person" key={share.userId}><span className="avatar avatar-small">{share.name?.[0]?.toUpperCase() || 'U'}</span><div><strong>{share.name}</strong><span>{share.email}</span></div><span className="role-label">{share.role}</span><button className="icon-button" aria-label={`Remove access for ${share.email}`} title="Remove direct access" disabled={busy} onClick={() => revoke(share)}><X size={17} /></button></div>) : <div className="private-note"><LockKeyhole size={20} /><span>Only you have direct access.</span></div>}</div>
  </div><footer className="modal-footer"><span className="footer-note"><ShieldCheck size={15} />Access stays in your control</span><button className="button secondary" onClick={onClose} disabled={busy}>Done</button></footer></Modal>;
}

function VersionsDialog({ item, onClose, onDone, notify }) {
  const [currentItem, setCurrentItem] = useState(item);
  const [data, setData] = useState({ versions: [], total: 0 });
  const [page, setPage] = useState(1), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const editable = item.permission !== 'viewer';
  useEffect(() => { let alive = true; setLoading(true); setError(''); api(`/files/${item.id}/versions?page=${page}&limit=10`).then(result => { if (alive) setData(result); }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [item.id, page, refresh]);
  async function restore(version) {
    setBusy(true); setError('');
    try { const result = await api(`/files/${item.id}/versions/${version.id}/restore`, { method: 'POST', body: { revision: currentItem.revision } }); setCurrentItem(result.item); setPage(1); setRefresh(value => value + 1); onDone(`Version ${version.number} restored as a new version.`, false); }
    catch (err) {
      if (err.status === 409) {
        const latest = await api(`/items/${item.id}`).catch(() => null);
        if (latest) setCurrentItem(latest.item);
        setError('This file changed elsewhere. Close and reopen version history to review the latest version before restoring.');
      } else setError(err.message);
    } finally { setBusy(false); }
  }
  return <Modal title="Every version, right here" subtitle={item.name} onClose={onClose} wide busy={busy}><div className="modal-body"><div className="version-intro"><History size={20} /><p>Previous versions are kept so you can always go back. Restoring creates a new version.</p></div><ErrorNote>{error}</ErrorNote>
    {loading ? <div className="center-state"><Spinner label="Loading version history…" /></div> : <div className="version-list">{data.versions.map(version => <div className="version-row" key={version.id}><span className={`version-marker ${version.current ? 'current' : ''}`}>{version.current ? <Check size={17} /> : <History size={16} />}</span><div className="version-description"><strong>Version {version.number} {version.current && <span className="pill">Current</span>}</strong><span>{formatDate(version.createdAt)} · {formatBytes(version.size)}</span><small>{typeof version.createdBy === 'object' ? version.createdBy?.name || version.createdBy?.email : version.createdBy || ''}</small></div><div className="version-actions"><button className="icon-button" title="Download this version" aria-label={`Download version ${version.number}`} onClick={() => downloadFile(item, version.id).catch(err => notify(err.message, 'error'))}><ArrowDownToLine size={18} /></button>{editable && !version.current && <button className="button small secondary" disabled={busy} onClick={() => restore(version)}>Restore</button>}</div></div>)}{!data.versions.length && <p className="helper-text">No versions found.</p>}</div>}
    <Pagination page={page} total={data.total} limit={10} onChange={setPage} label="versions" />
  </div><footer className="modal-footer"><button className="button secondary" onClick={onClose} disabled={busy}>Done</button></footer></Modal>;
}

function DetailsDialog({ item, onClose, onAction, notify }) {
  return <Modal title="File details" onClose={onClose}><div className="modal-body"><div className="details-hero"><FileBadge item={item} large /><h3>{item.name}</h3><span className="role-label">{item.permission}</span></div><dl className="details-list"><div><dt>Type</dt><dd>{item.kind === 'folder' ? 'Folder' : item.mimeType || 'File'}</dd></div><div><dt>Size</dt><dd>{item.kind === 'folder' ? '—' : formatBytes(item.size)}</dd></div><div><dt>Owner</dt><dd>{item.ownerName || 'You'}</dd></div><div><dt>Created</dt><dd>{formatDate(item.createdAt)}</dd></div><div><dt>Modified</dt><dd>{formatDate(item.updatedAt)}</dd></div><div><dt>Revision</dt><dd>{item.revision}</dd></div></dl></div><footer className="modal-footer">{item.kind === 'file' && <><button className="button secondary" onClick={() => onAction('versions', item)}><History size={17} />History</button><button className="button primary" onClick={() => downloadFile(item).catch(err => notify(err.message, 'error'))}><ArrowDownToLine size={17} />Download</button></>}{item.kind === 'folder' && <button className="button secondary" onClick={onClose}>Done</button>}</footer></Modal>;
}

function ActionMenu({ menu, onClose, onAction, view }) {
  const ref = useRef(null);
  useEffect(() => {
    const outside = event => { if (!ref.current?.contains(event.target)) onClose(); };
    const escape = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape); window.addEventListener('scroll', onClose, true);
    ref.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', onClose, true); };
  }, [onClose]);
  const item = menu.item, owner = item.permission === 'owner', writable = item.permission !== 'viewer';
  const options = view === 'trash' ? [ ['restore', RotateCcw, 'Restore'], ['restore-to', FolderInput, 'Restore to folder…'] ] : [
    ...(item.kind === 'file' ? [['download', ArrowDownToLine, 'Download'], ['versions', History, 'Version history']] : [['open', Folder, 'Open folder']]),
    ...(writable ? [['rename', Pencil, 'Rename'], ...(item.kind === 'file' ? [['upload-version', Upload, 'Upload new version']] : [])] : []),
    ...(owner ? [['move', FolderInput, 'Move to…'], ['share', Users, 'Manage sharing']] : []),
    ['details', Info, 'Details'], ...(owner ? [['trash', Trash2, 'Move to Trash']] : []),
  ];
  const height = options.length * 38 + 12;
  return <div ref={ref} className="action-menu" role="menu" aria-label={`Actions for ${item.name}`} style={{ top: Math.max(8, Math.min(menu.top, window.innerHeight - height - 12)), left: Math.max(8, Math.min(menu.left, window.innerWidth - 230)) }}>{options.map(([action, Icon, label]) => <button key={action} role="menuitem" className={action === 'trash' ? 'text-danger menu-danger' : ''} onClick={() => { onClose(); onAction(action, item); }}><Icon size={16} />{label}</button>)}</div>;
}

export default function App() {
  const [user, setUser] = useState(null), [booting, setBooting] = useState(true), [expired, setExpired] = useState(false);
  const [view, setView] = useState('drive'), [parentId, setParentId] = useState(null), [query, setQuery] = useState(''), [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1), [layout, setLayout] = useState('list');
  const [data, setData] = useState({ items: [], total: 0, breadcrumbs: [] }), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [modal, setModal] = useState(null), [menu, setMenu] = useState(null), [mobileOpen, setMobileOpen] = useState(false);
  const [refresh, setRefresh] = useState(0), [toast, setToast] = useState(null), [dragging, setDragging] = useState(false), [loggingOut, setLoggingOut] = useState(false);
  const toastTimer = useRef(null), dragDepth = useRef(0);
  const notify = useCallback((message, type = 'success') => { setToast({ message, type }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 5000); }, []);
  const closeModal = useCallback(() => setModal(null), []), closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => { api('/auth/me').then(result => setUser(result.user)).catch(err => { if (err.status !== 401) setError(err.message); }).finally(() => setBooting(false)); const expiredSession = () => { setUser(null); setExpired(true); setModal(null); }; window.addEventListener('drivebox:session-expired', expiredSession); return () => { window.removeEventListener('drivebox:session-expired', expiredSession); clearTimeout(toastTimer.current); }; }, []);
  useEffect(() => { const timer = setTimeout(() => { setDebouncedQuery(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController(); setLoading(true); setError(''); setMenu(null);
    const params = new URLSearchParams({ view, page: String(page), limit: String(PAGE_SIZE) });
    if (parentId) params.set('parentId', parentId); if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
    api(`/items?${params}`, { signal: controller.signal }).then(result => {
      if (result.total > 0 && page > Math.ceil(result.total / PAGE_SIZE)) { setPage(Math.max(1, Math.ceil(result.total / PAGE_SIZE))); return; }
      if (result.total === 0 && page > 1) { setPage(1); return; }
      setData({ ...result, breadcrumbs: result.breadcrumbs || [] });
    }).catch(err => { if (err.name !== 'AbortError') setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.id, view, parentId, debouncedQuery, page, refresh]);

  function navigate(nextView, nextParent = null) { setView(nextView); setParentId(nextParent); setQuery(''); setDebouncedQuery(''); setPage(1); setMobileOpen(false); setMenu(null); setData({ items: [], total: 0, breadcrumbs: [] }); }
  async function refreshUser() { try { const result = await api('/auth/me'); setUser(result.user); } catch { /* Session is handled by the next authenticated request. */ } }
  function mutationDone(message, close = true) { if (close) setModal(null); if (message) notify(message); setRefresh(value => value + 1); refreshUser(); }
  async function action(type, item) {
    if (type === 'open') { navigate(view, item.id); return; }
    if (type === 'download') { try { await downloadFile(item); } catch (err) { notify(err.message, 'error'); } return; }
    if (type === 'restore') {
      try { await api(`/items/${item.id}/restore`, { method: 'POST', body: {} }); mutationDone('Item restored.'); }
      catch (err) { if (err.status === 409) { notify('Choose another location to restore this item.', 'error'); setModal({ type: 'restore-to', item }); } else notify(err.message, 'error'); }
      return;
    }
    setModal({ type, item });
  }
  async function logout() { setLoggingOut(true); try { await api('/auth/logout', { method: 'POST' }); setUser(null); setExpired(false); navigate('drive'); } catch (err) { notify(err.message, 'error'); } finally { setLoggingOut(false); } }
  const canCreate = view !== 'trash' && (view === 'drive' && !parentId || parentId && data.folder && data.folder.permission !== 'viewer');
  const storagePercent = user?.quotaBytes ? Math.min(100, user.usedBytes / user.quotaBytes * 100) : 0;
  const title = parentId ? data.folder?.name || 'Folder' : VIEW_LABELS[view];
  const subtitle = parentId ? `${VIEW_LABELS[view]} / ${title}` : view === 'drive' ? 'A little space for everything you’re working on.' : view === 'shared' ? 'The good things you’re working on together.' : 'A second chance for files you’ve set aside.';
  if (booting) return <main className="boot-screen"><Brand /><Spinner label="Opening your workspace…" /></main>;
  if (!user) return <Auth expired={expired} onAuthenticated={nextUser => { navigate('drive'); setUser(nextUser); setExpired(false); setError(''); setRefresh(value => value + 1); }} />;

  return <div className="app-shell">
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <Brand />
      <button className="button primary new-button" onClick={() => { navigate('drive'); setModal({ type: 'upload' }); }}><Plus size={20} /><span>Upload files</span><Upload size={16} /></button>
      <span className="nav-label">WORKSPACE</span><nav aria-label="Main navigation">{[['drive', HardDrive], ['shared', Users], ['trash', Trash2]].map(([key, Icon]) => <button key={key} className={`nav-link ${view === key ? 'active' : ''}`} onClick={() => navigate(key)}><Icon size={19} /><span>{VIEW_LABELS[key]}</span>{view === key && <span className="nav-active-dot" />}</button>)}</nav>
      <div className="sidebar-note"><span className="sidebar-note-icon"><Cloud size={22} /></span><strong>Everything in its place.</strong><p>A home for your work.<br />Room for your ideas.</p><span className="note-doodle" aria-hidden="true">✦</span></div>
      <div className="storage"><div className="storage-heading"><Cloud size={18} /><strong>Storage</strong><span>{storagePercent.toFixed(0)}%</span></div><div className="storage-track"><span className={storagePercent > 90 ? 'near-full' : ''} style={{ width: `${storagePercent}%` }} /></div><p><strong>{formatBytes(user.usedBytes)}</strong> of {formatBytes(user.quotaBytes)} used</p><span className="storage-footnote">Includes file versions and Trash</span></div>
      <div className="sidebar-user"><span className="avatar">{user.name?.[0]?.toUpperCase()}</span><div><strong>{user.name}</strong><span>Personal workspace</span></div><button className="icon-button" onClick={logout} disabled={loggingOut} aria-label="Sign out" title="Sign out">{loggingOut ? <LoaderCircle size={17} className="spin" /> : <LogOut size={17} />}</button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={22} /></button><span className="topbar-context">Workspace</span><ChevronRight size={14} /><strong>{VIEW_LABELS[view]}</strong></div><div className="topbar-right"><span className="connection-status"><span />All in one place</span><span className="topbar-divider" /><span className="avatar avatar-small" title={user.email}>{user.name?.[0]?.toUpperCase()}</span></div></header>
      <main className={`main-content ${dragging ? 'drag-active' : ''}`} onDragEnter={event => { event.preventDefault(); if (canCreate && event.dataTransfer.types.includes('Files')) { dragDepth.current += 1; setDragging(true); } }} onDragOver={event => { event.preventDefault(); }} onDragLeave={event => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (canCreate && event.dataTransfer.files.length) setModal({ type: 'upload', files: [...event.dataTransfer.files] }); }}>
        {dragging && <div className="drop-overlay"><Upload size={42} /><h2>Drop files into {title}</h2><p>We’ll take care of the rest.</p></div>}
        <div className="page-heading"><div><span className="small-overline">{view === 'drive' ? 'YOUR SPACE, ORGANIZED' : view === 'shared' ? 'BETTER TOGETHER' : 'NOT GONE FOR GOOD'}</span><h1>{title}{!parentId && view === 'drive' && <span className="heading-spark">✦</span>}</h1><p>{subtitle}</p></div>{canCreate && <button className="button primary heading-upload" onClick={() => setModal({ type: 'upload' })}><Upload size={17} />Upload files</button>}</div>
        {!parentId && view === 'drive' && <section className="welcome-banner"><div><span className="banner-eyebrow">A LITTLE LESS CLUTTER. A LOT MORE CLARITY.</span><h2>Your work, beautifully together.</h2><p>From the first idea to the final file. Keep it all here.</p><button onClick={() => setModal({ type: 'folder' })}>Create a folder <ArrowUpRight size={17} /></button></div><div className="banner-art" aria-hidden="true"><div className="banner-sheet back"><FileImage size={28} /></div><div className="banner-sheet front"><FileText size={32} /><span /><span /></div><div className="banner-folder"><Folder size={104} fill="currentColor" strokeWidth={0.8} /></div><span className="banner-star">✦</span><span className="banner-circle" /></div></section>}
        {view === 'trash' && <div className="notice trash-notice"><Info size={18} /><span>Files stay here until you restore them. Trash and previous versions still count toward your storage.</span></div>}
        <section className="file-section" aria-label="Files and folders">
          <div className="file-toolbar"><div className="file-section-title">{parentId ? <div className="breadcrumbs"><button onClick={() => navigate(view)}>{VIEW_LABELS[view]}</button>{data.breadcrumbs.map(crumb => <React.Fragment key={crumb.id}><ChevronRight size={15} /><button className={crumb.id === parentId ? 'crumb-current' : ''} onClick={() => navigate(view, crumb.id)}>{crumb.name}</button></React.Fragment>)}</div> : <><h2>{view === 'trash' ? 'Trashed items' : view === 'shared' ? 'Shared items' : 'All files'}</h2><span className="count-badge">{data.total}</span></>}</div><div className="toolbar-tools">{canCreate && <button className="button secondary new-folder" onClick={() => setModal({ type: 'folder' })}><FolderPlus size={16} />New folder</button>}<div className="view-switch" aria-label="File view"><button className={layout === 'list' ? 'selected' : ''} aria-label="List view" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={18} /></button><button className={layout === 'grid' ? 'selected' : ''} aria-label="Grid view" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={17} /></button></div></div></div>
          <div className="filter-bar"><div className="search-box"><Search size={18} /><input aria-label="Search files in this folder" placeholder="Search in this folder…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}</div><span className="folder-location"><Folder size={15} />{parentId ? data.folder?.permission === 'viewer' ? 'View-only folder' : 'Current folder' : 'All file types'}</span></div>
          {error ? <div className="error-state"><ErrorNote>{error}</ErrorNote><button className="button secondary" onClick={() => setRefresh(value => value + 1)}>Try again</button>{parentId && <button className="text-button" onClick={() => navigate(view)}>Back to {VIEW_LABELS[view]}</button>}</div> : loading ? <div className="file-loading"><Spinner label="Gathering your files…" />{[0, 1, 2, 3].map(index => <div className="skeleton-row" key={index}><span /><i /><b /></div>)}</div> : data.items.length === 0 ? <div className="empty-state"><div className="empty-icon">{debouncedQuery ? <Search size={35} /> : view === 'trash' ? <Trash2 size={35} /> : view === 'shared' ? <Users size={35} /> : <Folder size={39} />}</div><h3>{debouncedQuery ? 'No matching files' : view === 'trash' ? 'A clean slate.' : view === 'shared' ? 'Better things are shared.' : 'Room for something great.'}</h3><p>{debouncedQuery ? 'Try a different name, or clear your search.' : view === 'trash' ? 'Items you move to Trash will appear here.' : view === 'shared' ? 'Files and folders shared with you will appear here.' : 'Add your first file or create a folder to get started.'}</p>{debouncedQuery ? <button className="button secondary" onClick={() => setQuery('')}>Clear search</button> : canCreate && <button className="button primary" onClick={() => setModal({ type: 'upload' })}><Plus size={17} />Upload your first file</button>}</div> : layout === 'list' ? <div className="file-table-wrap"><table className="file-table"><thead><tr><th>Name <ChevronDown size={13} /></th><th>Owner</th><th>{view === 'trash' ? 'Trashed' : 'Last modified'}</th><th>File size</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><button className="file-name-button" onClick={() => view !== 'trash' && action(item.kind === 'folder' ? 'open' : 'details', item)} disabled={view === 'trash'}><FileBadge item={item} /><span><strong>{item.name}</strong>{view === 'shared' && <small>{item.permission === 'editor' ? 'Can edit' : 'Can view'}</small>}</span></button></td><td><span className={`owner-avatar ${item.permission === 'owner' ? '' : 'owner-other'}`}>{(item.permission === 'owner' ? user.name : item.ownerName)?.[0]?.toUpperCase() || 'U'}</span>{item.permission === 'owner' ? 'Me' : item.ownerName || 'Shared'}</td><td>{formatDate(view === 'trash' ? item.trashedAt : item.updatedAt)}</td><td>{item.kind === 'folder' ? '—' : formatBytes(item.size)}</td><td><button className="icon-button more-button" aria-label={`Actions for ${item.name}`} aria-haspopup="menu" onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setMenu({ item, top: bounds.bottom + 5, left: bounds.right - 218 }); }}><MoreHorizontal size={21} /></button></td></tr>)}</tbody></table></div> : <div className="file-grid">{data.items.map(item => <article key={item.id} className="file-card"><div className="file-card-top"><FileBadge item={item} large /><button className="icon-button" aria-label={`Actions for ${item.name}`} aria-haspopup="menu" onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setMenu({ item, top: bounds.bottom + 5, left: bounds.right - 218 }); }}><MoreHorizontal size={21} /></button></div><button className="card-title" disabled={view === 'trash'} onClick={() => action(item.kind === 'folder' ? 'open' : 'details', item)}>{item.name}</button><div className="card-meta"><span>{item.kind === 'folder' ? 'Folder' : formatBytes(item.size)}</span><span>{formatDate(item.updatedAt)}</span></div>{view === 'shared' && <span className="grid-permission">{item.permission === 'editor' ? 'Can edit' : 'Can view'} · {item.ownerName}</span>}</article>)}</div>}
          {!loading && !error && <Pagination page={page} total={data.total} onChange={setPage} />}
        </section>
        <footer className="workspace-footer"><span><ShieldCheck size={14} />A private place for your next big thing.</span><span>Made for your everyday.</span></footer>
      </main>
    </div>
    {menu && <ActionMenu menu={menu} onClose={closeMenu} onAction={action} view={view} />}
    {modal?.type === 'folder' && <NameDialog mode="folder" parentId={parentId} onClose={closeModal} onDone={mutationDone} />}
    {modal?.type === 'rename' && <NameDialog mode="rename" item={modal.item} onClose={closeModal} onDone={mutationDone} />}
    {(modal?.type === 'upload' || modal?.type === 'upload-version') && <UploadDialog parentId={parentId} item={modal.item} initialFiles={modal.files} onClose={closeModal} onDone={mutationDone} />}
    {(modal?.type === 'move' || modal?.type === 'restore-to') && <MoveDialog item={modal.item} restore={modal.type === 'restore-to'} onClose={closeModal} onDone={mutationDone} />}
    {modal?.type === 'trash' && <TrashDialog item={modal.item} onClose={closeModal} onDone={mutationDone} />}
    {modal?.type === 'share' && <ShareDialog item={modal.item} onClose={closeModal} onDone={mutationDone} />}
    {modal?.type === 'versions' && <VersionsDialog item={modal.item} onClose={closeModal} onDone={mutationDone} notify={notify} />}
    {modal?.type === 'details' && <DetailsDialog item={modal.item} onClose={closeModal} onAction={action} notify={notify} />}
    {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'error' ? <AlertCircle size={19} /> : <Check size={19} />}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={17} /></button></div>}
  </div>;
}
