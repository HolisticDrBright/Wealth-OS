'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createTransaction } from '@/lib/actions/transactions'

const expenseCategories = [
  'Housing', 'Groceries', 'Dining', 'Transportation', 'Healthcare',
  'Entertainment', 'Shopping', 'Utilities', 'Insurance', 'Education', 'Other',
]

const incomeCategories = ['Salary', 'Freelance', 'Investment', 'Rental', 'Other']

interface TransactionFormProps {
  open: boolean
  onClose: () => void
}

export function TransactionForm({ open, onClose }: TransactionFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [type, setType] = useState<'income' | 'expense'>('expense')

  const categories = type === 'income' ? incomeCategories : expenseCategories

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    formData.set('type', type)

    startTransition(async () => {
      const result = await createTransaction(formData)
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
      title="Add Transaction"
      description="Record an income or expense"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Type toggle */}
        <div className="flex gap-2">
          {(['expense', 'income'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors capitalize ${
                type === t
                  ? t === 'income' ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'
                  : 'border border-white/10 text-gray-400 hover:bg-white/5'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Input
              label="Description"
              name="description"
              required
              placeholder="Whole Foods Market"
            />
          </div>
          <Input
            label="Amount ($)"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="85.00"
          />
          <Input
            label="Date"
            name="date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
          <Select
            label="Category"
            name="category"
            options={categories.map(c => ({ value: c, label: c }))}
          />
          <Input
            label="Account (optional)"
            name="account"
            placeholder="Chase Checking"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : 'Add Transaction'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
