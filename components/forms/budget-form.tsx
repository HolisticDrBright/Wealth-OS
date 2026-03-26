'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { upsertBudget } from '@/lib/actions/budgets'

const categoryOptions = [
  'Housing', 'Groceries', 'Dining', 'Transportation', 'Healthcare',
  'Entertainment', 'Shopping', 'Utilities', 'Insurance', 'Education',
  'Health & Fitness', 'Subscriptions', 'Other',
].map(c => ({ value: c, label: c }))

interface BudgetFormProps {
  open: boolean
  onClose: () => void
  month: string
  existingCategory?: string
  existingLimit?: number
}

export function BudgetForm({ open, onClose, month, existingCategory, existingLimit }: BudgetFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    formData.set('month', month)

    startTransition(async () => {
      const result = await upsertBudget(formData)
      if (result.error) {
        setError(result.error)
      } else {
        onClose()
      }
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existingCategory ? 'Edit Budget' : 'Set Budget'}
      description={`Budget limit for ${month}`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <Select
          label="Category"
          name="category"
          options={categoryOptions}
          defaultValue={existingCategory ?? 'Groceries'}
        />
        <Input
          label="Monthly Limit ($)"
          name="monthly_limit"
          type="number"
          min="0"
          step="0.01"
          required
          defaultValue={existingLimit}
          placeholder="500"
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save Budget'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
