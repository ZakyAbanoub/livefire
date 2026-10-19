'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createNote } from '@/app/actions/notes'

export function NewNoteForm({ orgId }: { orgId: number }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createNote(orgId, { title, body })
      if (result.error !== undefined) {
        setError(result.error)
        return
      }
      router.push(`/notes/${result.id}`)
    })
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write something…" />
      <button type="submit" disabled={pending}>Add note</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
