'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/modal'
import { Input, Select } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createAsset, updateAsset } from '@/lib/actions/assets'
import type { Asset } from '@/lib/types'

const categoryOptions = [
  { value: 'stock', label: 'Stock' },
  { value: 'crypto', label: 'Cryptocurrency' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'cash', label: 'Cash / Savings' },
  { value: 'bond', label: 'Bond' },
  { value: 'other', label: 'Other' },
]

interface AssetFormProps {
  open: boolean
  onClose: () => void
  asset?: Asset | null
}

export function AssetForm({ open, onClose, asset }: AssetFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const isEdit = !!asset

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = isEdit
        ? await updateAsset(asset.id, formData)
        : await createAsset(formData)

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
      title={isEdit ? 'Edit Asset' : 'Add Asset'}
      description={isEdit ? `Editing ${asset?.name}` : 'Track a new investment or asset'}
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
              label="Asset Name"
              name="name"
              required
              defaultValue={asset?.name}
              placeholder="Apple Inc."
            />
          </div>
          <Select
            label="Category"
            name="category"
            options={categoryOptions}
            defaultValue={asset?.category ?? 'stock'}
          />
          <Input
            label="Ticker Symbol (optional)"
            name="symbol"
            defaultValue={asset?.symbol ?? ''}
            placeholder="AAPL"
          />
          <Input
            label="Current Value ($)"
            name="current_value"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={asset?.current_value}
            placeholder="10000"
          />
          <Input
            label="Quantity (optional)"
            name="quantity"
            type="number"
            min="0"
            step="any"
            defaultValue={asset?.quantity ?? ''}
            placeholder="50"
          />
          <Input
            label="Purchase Price per Unit ($)"
            name="purchase_price"
            type="number"
            min="0"
            step="0.01"
            defaultValue={asset?.purchase_price ?? ''}
            placeholder="150.00"
          />
          <Input
            label="Purchase Date"
            name="purchase_date"
            type="date"
            defaultValue={asset?.purchase_date ?? ''}
          />
          <div className="col-span-2">
            <Input
              label="Notes (optional)"
              name="notes"
              defaultValue={asset?.notes ?? ''}
              placeholder="Any notes about this asset"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Asset'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
