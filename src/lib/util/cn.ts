import { clsx, type ClassValue } from 'clsx'

/**
 * clsx only. tailwind-merge exists to resolve conflicts when overriding
 * generated component variants -- a problem we do not have, because the
 * primitives here are local and small.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
