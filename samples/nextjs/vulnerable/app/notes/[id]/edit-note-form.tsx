'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { deleteNote, updateNote } from '@/app/actions/notes'

type Props = { note: { id: number; title: string; body: string } }

export function EditNoteForm({ note }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateNote(note.id, { title, body })
      if (result.error !== undefined) {
        setError(result.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  function onDelete() {
    if (!window.confirm('Delete this note?')) return
    startTransition(async () => {
      const result = await deleteNote(note.id)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="submit" disabled={pending}>Save</button>
      <button type="button" onClick={onDelete} disabled={pending}>Delete</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
