'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    })
    if (response.ok) {
      router.push('/orgs')
      router.refresh()
      return
    }
    const data = await response.json().catch(() => ({}))
    setError(data.error ?? 'Sign-in failed')
    setPending(false)
  }

  return (
    <form onSubmit={onSubmit}>
      <input name="email" type="email" placeholder="Email" autoComplete="username" required />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
      <button type="submit" disabled={pending}>Sign in</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
