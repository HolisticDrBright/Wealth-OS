import { cn } from '@/lib/utils'

type CardProps = React.HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line-strong bg-white/5 backdrop-blur-sm p-6',
        className
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: CardProps) {
  return <div className={cn('mb-4', className)} {...props} />
}

export function CardTitle({ className, ...props }: CardProps) {
  return (
    <h3 className={cn('text-lg font-semibold text-white', className)} {...props} />
  )
}

export function CardDescription({ className, ...props }: CardProps) {
  return (
    <p className={cn('text-sm text-text-1 mt-1', className)} {...props} />
  )
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={cn('', className)} {...props} />
}
