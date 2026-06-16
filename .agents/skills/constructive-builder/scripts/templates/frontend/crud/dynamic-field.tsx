/**
 * dynamic-field.tsx — Schema-driven form field (one input per pgType).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: lifted VERBATIM from constructive-frontend/references/meta-forms.md §6.
 * scripts/scaffold-frontend.mjs stamps this to <app>/src/components/crud/dynamic-field.tsx.
 * Imports point at the boilerplate's shadcn UI primitives (@/components/ui/*) and the
 * meta helpers (@/lib/meta/field-renderer, @/types/meta) — all present in the
 * constructive-app template; the generator leaves them as-is. No placeholders.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getInputType, SYSTEM_FIELDS, toLabel } from '@/lib/meta/field-renderer';
import type { MetaField } from '@/types/meta';
import { Lock } from 'lucide-react';

type DynamicFieldProps = {
  field: MetaField;
  value: unknown;
  onChange: (value: unknown) => void;
  isForeignKey?: boolean;
  /** Pre-set from context — visible but not editable */
  locked?: boolean;
  /** Human-readable label for locked field (e.g. "Kristopher Floyd" instead of a UUID) */
  lockedLabel?: string;
  error?: string;
};

export function DynamicField({
  field, value, onChange,
  isForeignKey = false, locked = false, lockedLabel, error,
}: DynamicFieldProps) {
  if (SYSTEM_FIELDS.has(field.name)) return null;

  const inputType = getInputType(field, isForeignKey);
  const label = toLabel(field.name);
  const required = field.isNotNull && !field.hasDefault;

  // ── Locked: visible, disabled, not editable ──
  if (locked) {
    const displayValue = lockedLabel ?? (typeof value === 'string' ? value : String(value ?? ''));
    return (
      <Field label={label} required={false}>
        <div className="relative">
          <Input
            value={displayValue}
            readOnly disabled
            className="bg-muted/40 pr-8 text-muted-foreground cursor-default"
          />
          <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
        {lockedLabel && (
          <p className="mt-1 text-xs text-muted-foreground font-mono">{String(value)}</p>
        )}
      </Field>
    );
  }

  if (inputType === 'hidden') return null;

  if (inputType === 'boolean') {
    return (
      <div className="flex items-center gap-3 py-1">
        <Switch id={field.name} checked={(value as boolean) ?? false} onCheckedChange={onChange} />
        <Label htmlFor={field.name} className="cursor-pointer">{label}</Label>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    );
  }

  if (inputType === 'textarea') {
    return (
      <Field label={label} required={required} error={error}>
        <Textarea value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} rows={4} />
      </Field>
    );
  }

  if (inputType === 'json') {
    return (
      <Field label={label} required={required} error={error} description="JSON value">
        <Textarea
          value={typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}
          onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); } }}
          rows={6} className="font-mono text-xs"
        />
      </Field>
    );
  }

  if (inputType === 'number') {
    return (
      <Field label={label} required={required} error={error}>
        <Input type="number" value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      </Field>
    );
  }

  if (inputType === 'date') {
    return (
      <Field label={label} required={required} error={error}>
        <Input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }

  if (inputType === 'datetime') {
    return (
      <Field label={label} required={required} error={error}>
        <Input type="datetime-local" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }

  if (inputType === 'uuid') {
    return (
      <Field label={label} required={required} error={error}>
        <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="font-mono" />
      </Field>
    );
  }

  if (inputType === 'select') {
    // FK field — raw UUID input until EntitySearch is built
    return (
      <Field label={label} required={required} error={error} description="Foreign key — paste UUID">
        <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}
          placeholder={`${label} ID…`} className="font-mono text-sm" />
      </Field>
    );
  }

  return (
    <Field label={label} required={required} error={error}>
      <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
