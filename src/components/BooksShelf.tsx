import { useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Book } from '../../shared/types';
import { useStore } from '../state/store';
import { bookProgress } from '../utils';

function BookCard({ book, readNext }: { book: Book; readNext: boolean }) {
  const setEditingBook = useStore((s) => s.setEditingBook);
  const bumpBookProgress = useStore((s) => s.bumpBookProgress);
  const addTask = useStore((s) => s.addTask);
  const categories = useStore((s) => s.categories);
  const toast = useStore((s) => s.toast);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: book.id,
  });

  const progress = bookProgress(book.current, book.total);
  const readingCat = categories.find((c) => c.name.toLowerCase().includes('read'));

  const unitLabel =
    book.unit === 'percent'
      ? `${Math.round(book.current)}%`
      : `${book.unit === 'chapter' ? 'ch.' : 'p.'} ${book.current}${book.total ? ` / ${book.total}` : ''}`;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`book-card ${isDragging ? 'dragging' : ''} ${book.status === 'finished' ? 'finished' : ''}`}
    >
      <div className="book-card-top">
        <button className="drag-handle book-drag" {...attributes} {...listeners} aria-label={`Reorder ${book.title}`}>
          ⠿
        </button>
        {readNext && <span className="read-next-tag">READ NEXT</span>}
        {book.status === 'queued' && !readNext && <span className="queued-tag">queued</span>}
        {book.status === 'finished' && <span className="finished-tag">✓ finished</span>}
      </div>
      <button className="book-main" onClick={() => setEditingBook(book)} title="Edit book">
        <div className="book-title">{book.title}</div>
        {book.author && <div className="book-author">{book.author}</div>}
        <div className="book-progress-row">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: progress != null ? `${Math.round(progress * 100)}%` : '0%' }}
            />
          </div>
          <span className="book-progress-label">{unitLabel}</span>
        </div>
      </button>
      {book.status !== 'finished' && (
        <div className="book-actions">
          <button
            className="mini-btn"
            onClick={() => bumpBookProgress(book, 1)}
            title={`+1 ${book.unit === 'percent' ? '%' : book.unit}`}
          >
            +1
          </button>
          <button
            className="mini-btn"
            onClick={() => bumpBookProgress(book, book.unit === 'page' ? 10 : 5)}
            title={`+${book.unit === 'page' ? 10 : 5}`}
          >
            +{book.unit === 'page' ? 10 : 5}
          </button>
          <button
            className="mini-btn plan"
            onClick={async () => {
              await addTask({
                title: `Read: ${book.title}`,
                category_id: readingCat?.id ?? null,
                book_id: book.id,
              });
              toast('success', `Added a reading task for “${book.title}”`);
            }}
            title="Add a reading task for this book to the current day"
          >
            + plan
          </button>
        </div>
      )}
    </div>
  );
}

export default function BooksShelf() {
  const books = useStore((s) => s.books);
  const reorderBooks = useStore((s) => s.reorderBooks);
  const setEditingBook = useStore((s) => s.setEditingBook);

  const open = useMemo(() => books.filter((b) => b.status !== 'finished'), [books]);
  const finishedCount = books.length - open.length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = open.map((b) => b.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = arrayMove(ids, from, to);
    reorderBooks([...next, ...books.filter((b) => b.status === 'finished').map((b) => b.id)]);
  };

  return (
    <div className="books-shelf">
      <div className="books-head">
        <span className="panel-title">📚 Reading</span>
        <span className="books-sub">
          drag to set what to read next
          {finishedCount > 0 ? ` · ${finishedCount} finished` : ''}
        </span>
        <button className="pill-btn subtle" onClick={() => setEditingBook('new')}>
          ＋ Add book
        </button>
      </div>
      {open.length === 0 ? (
        <div className="books-empty">
          No books in progress. Add the books you're reading in parallel and order them by priority.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={open.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
            <div className="books-row">
              {open.map((b, i) => (
                <BookCard key={b.id} book={b} readNext={i === 0} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
