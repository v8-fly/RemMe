import React, { useMemo, useState, useEffect } from 'react';
import { addLink, deleteLink, getAllLinks, putLinks, updateLink } from './db';

const emptyForm = {
  url: '',
  title: '',
  note: '',
  tags: ''
};

function normalizeUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const trimmed = rawUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  } catch {
    return rawUrl;
  }
}

function parseTags(input) {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.toLowerCase());
}

function formatDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function fetchTitle(url) {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return '';
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('title')?.textContent?.trim();
    return title || '';
  } catch {
    return '';
  }
}

function useTheme() {
  const getInitialTheme = () => {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return [theme, setTheme];
}

export default function App() {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const [theme, setTheme] = useTheme();
  const [copiedId, setCopiedId] = useState(null);
  const [importMessage, setImportMessage] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAllLinks()
      .then((data) => {
        if (!active) return;
        const sorted = [...data].sort((a, b) => b.createdAt - a.createdAt);
        setLinks(sorted);
      })
      .catch(() => setError('Could not load your saved links.'))
      .finally(() => setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  const allTags = useMemo(() => {
    const tagSet = new Set();
    links.forEach((link) => link.tags?.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [links]);

  const filteredLinks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return links.filter((link) => {
      if (tagFilter !== 'all' && !link.tags?.includes(tagFilter)) return false;
      if (!query) return true;
      const haystack = `${link.title} ${link.url} ${link.note} ${(link.tags || []).join(' ')}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [links, search, tagFilter]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleUrlBlur = async () => {
    if (!form.url.trim() || form.title.trim()) return;
    setFetchingTitle(true);
    const normalized = normalizeUrl(form.url);
    const title = await fetchTitle(normalized);
    if (title) {
      setForm((prev) => ({ ...prev, title }));
    }
    setFetchingTitle(false);
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.url.trim()) {
      setError('Please enter a URL.');
      return;
    }

    const normalized = normalizeUrl(form.url);
    const now = Date.now();
    const newLink = {
      id: crypto.randomUUID(),
      url: normalized,
      title: form.title.trim() || normalized,
      note: form.note.trim(),
      tags: parseTags(form.tags),
      createdAt: now,
      updatedAt: now
    };

    setSaving(true);
    try {
      await addLink(newLink);
      setLinks((prev) => [newLink, ...prev]);
      setForm(emptyForm);
      setTagFilter('all');
    } catch {
      setError('Could not save that link.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (link) => {
    setEditingId(link.id);
    setEditForm({
      url: link.url,
      title: link.title,
      note: link.note,
      tags: (link.tags || []).join(', ')
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
  };

  const handleEditChange = (event) => {
    const { name, value } = event.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const saveEdit = async (link) => {
    const updated = {
      ...link,
      url: normalizeUrl(editForm.url),
      title: editForm.title.trim() || normalizeUrl(editForm.url),
      note: editForm.note.trim(),
      tags: parseTags(editForm.tags),
      updatedAt: Date.now()
    };

    try {
      await updateLink(updated);
      setLinks((prev) => prev.map((item) => (item.id === link.id ? updated : item)));
      cancelEdit();
    } catch {
      setError('Could not update that link.');
    }
  };

  const removeLink = async (link) => {
    try {
      await deleteLink(link.id);
      setLinks((prev) => prev.filter((item) => item.id !== link.id));
    } catch {
      setError('Could not delete that link.');
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const exportLinks = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      links
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remme-links-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const normalizeImportedLinks = (data) => {
    const list = Array.isArray(data) ? data : data?.links;
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && typeof item.url === 'string')
      .map((item) => {
        const now = Date.now();
        const normalizedUrl = normalizeUrl(item.url);
        return {
          id: item.id || crypto.randomUUID(),
          url: normalizedUrl,
          title: (item.title || normalizedUrl).toString().trim(),
          note: (item.note || '').toString().trim(),
          tags: Array.isArray(item.tags) ? item.tags.map((tag) => tag.toString().toLowerCase().trim()).filter(Boolean) : [],
          createdAt: Number.isFinite(item.createdAt) ? item.createdAt : now,
          updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : now
        };
      });
  };

  const importLinks = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportMessage('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = normalizeImportedLinks(parsed);
      if (!incoming.length) {
        setImportMessage('No valid links found in that file.');
        return;
      }
      const existingByUrl = new Set(links.map((link) => link.url));
      const merged = incoming.filter((link) => !existingByUrl.has(link.url));
      if (!merged.length) {
        setImportMessage('All links already exist.');
        return;
      }
      await putLinks(merged);
      const nextLinks = [...merged, ...links].sort((a, b) => b.createdAt - a.createdAt);
      setLinks(nextLinks);
      setImportMessage(`Imported ${merged.length} link${merged.length === 1 ? '' : 's'}.`);
    } catch {
      setImportMessage('Could not import that file.');
    }
  };

  const copyLink = async (link) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link.url);
      } else {
        const temp = document.createElement('textarea');
        temp.value = link.url;
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 1500);
    } catch {
      setError('Could not copy that link.');
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Save first. Read later.</p>
          <h1>RemMe</h1>
          <p className="subhead">A pocket-sized inbox for every link you want to remember.</p>
        </div>
        <div className="hero-actions">
          <button className="ghost" type="button" onClick={exportLinks}>
            Export
          </button>
          <label className="ghost upload">
            Import
            <input type="file" accept="application/json" onChange={importLinks} />
          </label>
          <button className="theme-toggle" onClick={toggleTheme} type="button">
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>
      {importMessage ? <p className="import-message">{importMessage}</p> : null}

      <section className="panel">
        <form className="card form" onSubmit={handleAdd}>
          <div className="form-row">
            <label htmlFor="url">URL</label>
            <input
              id="url"
              name="url"
              type="url"
              placeholder="https://example.com"
              value={form.url}
              onChange={handleInputChange}
              onBlur={handleUrlBlur}
              required
            />
          </div>
          <div className="form-row">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              name="title"
              type="text"
              placeholder={fetchingTitle ? 'Fetching title...' : 'Optional'}
              value={form.title}
              onChange={handleInputChange}
            />
          </div>
          <div className="form-row">
            <label htmlFor="note">Note</label>
            <textarea
              id="note"
              name="note"
              rows="2"
              placeholder="Why did you save this?"
              value={form.note}
              onChange={handleInputChange}
            />
          </div>
          <div className="form-row">
            <label htmlFor="tags">Tags</label>
            <input
              id="tags"
              name="tags"
              type="text"
              placeholder="design, marketing, youtube"
              value={form.tags}
              onChange={handleInputChange}
            />
          </div>
          <div className="form-actions">
            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save link'}
            </button>
            <button className="ghost" type="button" onClick={() => setForm(emptyForm)}>
              Clear
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </form>

        <div className="card filters">
          <div className="search-row">
            <input
              type="search"
              placeholder="Search titles, notes, tags"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="tag-row">
            <button
              className={tagFilter === 'all' ? 'tag active' : 'tag'}
              onClick={() => setTagFilter('all')}
              type="button"
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={tagFilter === tag ? 'tag active' : 'tag'}
                onClick={() => setTagFilter(tag)}
                type="button"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="list-header">
          <h2>Your saved links</h2>
          <span>{filteredLinks.length} items</span>
        </div>

        {loading ? <p className="muted">Loading...</p> : null}

        {!loading && filteredLinks.length === 0 ? (
          <div className="empty card">
            <p>No links yet. Save your first one above.</p>
          </div>
        ) : null}

        <div className="list">
          {filteredLinks.map((link) => (
            <article key={link.id} className="card link-card">
              {editingId === link.id ? (
                <div className="edit-form">
                  <input
                    name="title"
                    type="text"
                    value={editForm.title}
                    onChange={handleEditChange}
                    placeholder="Title"
                  />
                  <input
                    name="url"
                    type="url"
                    value={editForm.url}
                    onChange={handleEditChange}
                    placeholder="URL"
                  />
                  <textarea
                    name="note"
                    rows="2"
                    value={editForm.note}
                    onChange={handleEditChange}
                    placeholder="Note"
                  />
                  <input
                    name="tags"
                    type="text"
                    value={editForm.tags}
                    onChange={handleEditChange}
                    placeholder="tag1, tag2"
                  />
                  <div className="form-actions">
                    <button className="primary" type="button" onClick={() => saveEdit(link)}>
                      Save changes
                    </button>
                    <button className="ghost" type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="link-meta">
                    <div>
                      <h3>{link.title}</h3>
                      <p className="domain">{formatDomain(link.url)}</p>
                    </div>
                    <div className="link-actions">
                      <button className="ghost" type="button" onClick={() => copyLink(link)}>
                        {copiedId === link.id ? 'Copied' : 'Copy'}
                      </button>
                      <a className="open-link" href={link.url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </div>
                  </div>
                  {link.note ? <p className="note">{link.note}</p> : null}
                  {link.tags?.length ? (
                    <div className="tag-row">
                      {link.tags.map((tag) => (
                        <span className="tag small" key={`${link.id}-${tag}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="link-footer">
                    <span className="muted">Saved {new Date(link.createdAt).toLocaleDateString()}</span>
                    <div className="button-row">
                      <button className="ghost" type="button" onClick={() => startEdit(link)}>
                        Edit
                      </button>
                      <button className="ghost danger" type="button" onClick={() => removeLink(link)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
