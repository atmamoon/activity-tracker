import { useMemo, useState } from 'react';
import { useStore } from '../state/store';

export default function QuickAdd() {
  const categories = useStore((s) => s.categories);
  const books = useStore((s) => s.books);
  const addTask = useStore((s) => s.addTask);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);

  const activeCategories = useMemo(() => categories.filter((c) => !c.archived), [categories]);
  const selectedCategory = activeCategories.find((c) => c.id === categoryId);
  const isReading = selectedCategory?.name.toLowerCase().includes('read') ?? false;
  const openBooks = useMemo(() => books.filter((b) => b.status !== 'finished'), [books]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle('');
    await addTask({
      title: trimmed,
      category_id: categoryId,
      book_id: isReading ? bookId : null,
    });
  };

  return (
    <div className="quick-add">
      <form
        className="quick-add-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="quick-add-plus">＋</span>
        <input
          id="quick-add-input"
          className="quick-add-input"
          placeholder="Add a task for this day…  (n)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        {title.trim() && (
          <button type="submit" className="pill-btn accent">
            Add
          </button>
        )}
      </form>
      <div className="quick-add-cats">
        {activeCategories.map((c) => (
          <button
            key={c.id}
            className={`cat-pick ${categoryId === c.id ? 'active' : ''}`}
            style={{ ['--cat-color' as any]: c.color }}
            onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
            title={c.name}
          >
            <span>{c.emoji}</span> {c.name}
          </button>
        ))}
      </div>
      {isReading && openBooks.length > 0 && (
        <div className="quick-add-books">
          <span className="quick-add-books-label">Book:</span>
          {openBooks.map((b) => (
            <button
              key={b.id}
              className={`book-pick ${bookId === b.id ? 'active' : ''}`}
              onClick={() => setBookId(bookId === b.id ? null : b.id)}
            >
              📕 {b.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
