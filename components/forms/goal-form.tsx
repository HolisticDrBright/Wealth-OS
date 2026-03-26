'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createGoal, updateGoal } from '@/lib/actions/goals'
import type { Goal } from '@/lib/types'

const categoryOptions = [
  { value: 'retirement', label: 'Retirement' },
  { value: 'home', label: 'Home Purchase' },
  { value: 'education', label: 'Education' },
  { value: 'emergency', label: 'Emergency Fund' },
  { value: 'vacation', label: 'Vacation' },
  { value: 'other', label: 'Other' },
]

interface GoalFormProps {
  open: boolean
  onClose: () => void
  goal?: Goal | null
}

export function GoalForm({ open, onClose, goal }: GoalFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const isEdit = !!goal

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = isEdit
        ? await updateGoal(goal.id, formData)
        : await createGoal(formData)

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
      title={isEdit ? 'Edit Goal' : 'Add Goal'}
      description="Set a financial milestone to work toward"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Input
              label="Goal Name"
              name="name"
              required
              defaultValue={goal?.name}
              placeholder="Retirement Fund"
            />
          </div>
          <Select
            label="Category"
            name="category"
            options={categoryOptions}
            defaultValue={goal?.category ?? 'other'}
          />
          <Input
            label="Target Date"
            name="target_date"
            type="date"
            defaultValue={goal?.target_date?.slice(0, 10) ?? ''}
          />
          <Input
            label="Target Amount ($)"
            name="target_amount"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={goal?.target_amount}
            placeholder="100000"
          />
          <Input
            label="Current Amount ($)"
            name="current_amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={goal?.current_amount ?? 0}
            placeholder="0"
          />
          <div className="col-span-2">
            <Input
              label="Notes (optional)"
              name="notes"
              defaultValue={goal?.notes ?? ''}
              placeholder="Max out 401k and IRA annually"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Goal'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
