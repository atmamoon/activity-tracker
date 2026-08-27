import { useState } from 'react';
import type { Book, BookStatus, BookUnit } from '../../shared/types';
import { useStore } from '../state/store';
import Modal from './Modal';

export default function BookEditModal() {
  const editing = useStore((s) => s.editingBook)!;
  const saveBook = useStore((s) => s.saveBook);
  const deleteBook = useStore((s) => s.deleteBook);
  const setEditingBook = useStore((s) => s.setEditingBook);

  const isNew = editing === 'new';
  const book: Book | null = isNew ? null : editing;

  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [unit, setUnit] = useState<BookUnit>(book?.unit ?? 'page');
  const [total, setTotal] = useState<string>(book?.total != null ? String(book.total) : '');
  const [current, setCurrent] = useState<string>(book ? String(book.current) : '0');
  const [status, setStatus] = useState<BookStatus>(book?.status ?? 'reading');
  const [notes, setNotes] = useState(book?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const close = () => setEditingBook(null);

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await saveBook(book?.id ?? null, {
        title: title.trim(),
        author: author.trim(),
        unit,
        total: total.trim() === '' ? null : Number(total),
        ...(isNew ? {} : { current: Number(current) || 0 }),
        status,
        notes,
      });
      close();
    } catch {
      // toast already shown by the store
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Add book' : 'Edit book'} onClose={close}>
      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Author</span>
        <input value={author} onChange={(e) => setAuthor(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Track by</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as BookUnit)}>
            <option value="page">Pages</option>
            <option value="chapter">Chapters</option>
            <option value="percent">Percent</option>
          </select>
        </label>
        {!isNew && (
          <label className="field">
            <span>Current</span>
            <input type="number" min={0} value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>Total {unit === 'percent' ? '(100)' : `(${unit}s)`}</span>
          <input
            type="number"
            min={1}
            placeholder="optional"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as BookStatus)}>
          <option value="reading">Reading now</option>
          <option value="queued">Queued</option>
          <option value="finished">Finished</option>
        </select>
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="modal-actions space-between">
        {!isNew ? (
          confirmDelete ? (
            <button
              className="pill-btn danger"
              onClick={async () => {
                await deleteBook(book!.id);
                close();
              }}
            >
              Really delete?
            </button>
          ) : (
            <button className="pill-btn subtle danger-text" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )
        ) : (
          <span />
        )}
        <div className="modal-actions">
          <button className="pill-btn subtle" onClick={close}>
            Cancel
          </button>
          <button className="pill-btn accent" onClick={save} disabled={!title.trim() || saving}>
            {saving ? 'Saving…' : isNew ? 'Add book' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
