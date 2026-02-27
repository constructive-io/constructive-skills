---
name: constructive-meta-forms
description: Use the _meta GraphQL endpoint on any Constructive app-public DB to introspect table schema at runtime and render fully dynamic CRUD forms with zero static field configuration. Use when building create/edit/delete UI for any Constructive-provisioned table.
compatibility: Next.js 14+ (App Router), Constructive SDK, @tanstack/react-query, graphql-request
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive _meta Dynamic Forms

Build fully dynamic CRUD forms for **any** Constructive-provisioned table — zero static field configuration required. The `_meta` query built into every Constructive `app-public` GraphQL endpoint tells you everything: field names, types, required status, FK relationships, mutation names, and GraphQL type names — all at runtime.

---

## 1. What is `_meta`?

Every Constructive `app-public` endpoint exposes a built-in `_meta { tables { ... } }` query. It returns a complete, Constructive-specific schema map that's far more actionable than GraphQL introspection for form building:

- Field names, pgTypes, gqlTypes, nullability, defaults
- Mutation names: `createContact`, `updateContact`, `deleteContact`
- GraphQL input type names: `CreateContactInput`, `ContactPatch`
- FK relationships and referenced tables
- Primary key and unique constraints

**Key rule:** Query `_meta` once at startup with `staleTime: Infinity` — it never changes at runtime.

---

## 2. Full `_meta` GQL Query

```graphql
query GetMeta {
  _meta {
    tables {
      name
      fields { name isNotNull hasDefault type { pgType gqlType isArray } }
      inflection { tableType createInputType patchType filterType orderByType }
      query { all one create update delete }
      primaryKeyConstraints { name fields { name } }
      foreignKeyConstraints { name fields { name } referencedTable referencedFields }
      uniqueConstraints { name fields { name } }
    }
  }
}
```

---

## 3. TypeScript Types

```ts
// src/types/meta.ts

export type MetaField = {
  name: string;
  isNotNull: boolean;
  hasDefault: boolean;
  type: { pgType: string; gqlType: string; isArray: boolean };
};

export type MetaTable = {
  name: string;
  fields: MetaField[];
  inflection: {
    tableType: string;
    createInputType: string;
    patchType: string | null;
    filterType: string | null;
    orderByType: string;
  };
  query: {
    all: string;
    one: string | null;
    create: string | null;
    update: string | null;
    delete: string | null;
  };
  primaryKeyConstraints: Array<{ name: string; fields: { name: string }[] }>;
  foreignKeyConstraints: Array<{
    name: string;
    fields: { name: string }[];
    referencedTable: string;
    referencedFields: string[];
  }>;
  uniqueConstraints: Array<{ name: string; fields: { name: string }[] }>;
};
```

---

## 4. `useMeta` / `useTableMeta` Hooks

```ts
// src/lib/meta/use-meta.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { CRM_ENDPOINT } from '@/components/crm/crm-provider';
import { TokenManager } from '@/lib/auth/token-manager';
import type { MetaTable } from '@/types/meta';

const META_QUERY = `
  query GetMeta {
    _meta {
      tables {
        name
        fields { name isNotNull hasDefault type { pgType gqlType isArray } }
        inflection { tableType createInputType patchType filterType orderByType }
        query { all one create update delete }
        primaryKeyConstraints { name fields { name } }
        foreignKeyConstraints { name fields { name } referencedTable referencedFields }
        uniqueConstraints { name fields { name } }
      }
    }
  }
`;

async function fetchMeta(): Promise<{ _meta: { tables: MetaTable[] } }> {
  const { token } = TokenManager.getToken('schema-builder');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token.accessToken}`;

  const res = await fetch(CRM_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: META_QUERY }),
  });

  if (!res.ok) throw new Error(`_meta fetch failed: ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message ?? '_meta error');
  return json.data;
}

/** Fetches all tables. staleTime: Infinity — schema is stable at runtime. */
export function useMeta() {
  return useQuery({
    queryKey: ['_meta'],
    queryFn: fetchMeta,
    staleTime: Infinity,
  });
}

/** Returns a single table's MetaTable, or null if not found yet. */
export function useTableMeta(tableName: string): MetaTable | null {
  const { data } = useMeta();
  return data?._meta.tables.find((t) => t.name === tableName) ?? null;
}
```

---

## 5. Field Renderer (`field-renderer.ts`)

```ts
// src/lib/meta/field-renderer.ts
import type { MetaField } from '@/types/meta';

/** System fields — always skip in forms (auto-managed by Constructive) */
export const SYSTEM_FIELDS = new Set([
  'id', 'entityId', 'createdAt', 'updatedAt',
  'created_at', 'updated_at', 'entity_id',
]);

export type FieldInputType =
  | 'text' | 'textarea' | 'number' | 'boolean'
  | 'date' | 'datetime' | 'uuid' | 'json' | 'select' | 'hidden';

const TEXTAREA_NAME_HINTS = ['bio', 'description', 'notes', 'body', 'content', 'summary', 'details'];

export function getInputType(field: MetaField, isForeignKey: boolean): FieldInputType {
  if (SYSTEM_FIELDS.has(field.name)) return 'hidden';
  if (isForeignKey) return 'select';

  const pgType = field.type.pgType.toLowerCase();
  switch (pgType) {
    case 'text': case 'varchar': case 'citext': {
      const lower = field.name.toLowerCase();
      if (TEXTAREA_NAME_HINTS.some((h) => lower.includes(h))) return 'textarea';
      return 'text';
    }
    case 'int2': case 'int4': case 'int8':
    case 'float4': case 'float8': case 'numeric':
      return 'number';
    case 'bool': case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'timestamp': case 'timestamptz':
      return 'datetime';
    case 'uuid':
      return 'uuid';
    case 'json': case 'jsonb':
      return 'json';
    default:
      return 'text';
  }
}

/**
 * A field is required if it's NOT NULL AND has no default value.
 * `hasDefault=true` means Constructive auto-generates the value — never require it in forms.
 */
export function isRequiredField(field: MetaField): boolean {
  return field.isNotNull && !field.hasDefault;
}

/** camelCase → "Title Case" label */
export function toLabel(fieldName: string): string {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
```

---

## 6. Critical Rule: `hasDefault` vs `isNotNull`

| `isNotNull` | `hasDefault` | Meaning | In Form |
|---|---|---|---|
| `true` | `false` | Required, no default | Required input |
| `true` | `true` | NOT NULL but has default (e.g., `uuid_generate_v4()`, timestamps) | Skip in create, optional in edit |
| `false` | `false` | Optional, no default | Optional input |
| `false` | `true` | Optional with default | Optional input |

**`id`, `entityId`, `createdAt`, `updatedAt` all have `hasDefault=true`** — always skip them. The `SYSTEM_FIELDS` set handles this, but the `hasDefault` check is the underlying rule.

---

## 7. `DynamicField` Component

```tsx
// src/components/crm/dynamic-field.tsx
'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getInputType, SYSTEM_FIELDS, toLabel } from '@/lib/meta/field-renderer';
import type { MetaField } from '@/types/meta';

type DynamicFieldProps = {
  field: MetaField;
  value: unknown;
  onChange: (value: unknown) => void;
  isForeignKey?: boolean;
  error?: string;
};

export function DynamicField({ field, value, onChange, isForeignKey = false, error }: DynamicFieldProps) {
  if (SYSTEM_FIELDS.has(field.name)) return null;

  const inputType = getInputType(field, isForeignKey);
  const label = toLabel(field.name);
  const required = field.isNotNull && !field.hasDefault;

  if (inputType === 'hidden') return null;

  if (inputType === 'boolean') {
    return (
      <div className="flex items-center gap-3 py-1">
        <Switch
          id={field.name}
          checked={(value as boolean) ?? false}
          onCheckedChange={(checked) => onChange(checked)}
        />
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
          rows={6}
          className="font-mono text-xs"
        />
      </Field>
    );
  }

  if (inputType === 'number') {
    return (
      <Field label={label} required={required} error={error}>
        <Input
          type="number"
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
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
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className="font-mono"
        />
      </Field>
    );
  }

  if (inputType === 'select') {
    // FK field — plain UUID input for now (EntitySearch is future work)
    return (
      <Field label={label} required={required} error={error} description="Foreign key — paste UUID">
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${label} ID (UUID)…`}
          className="font-mono text-sm"
        />
      </Field>
    );
  }

  // Default: text
  return (
    <Field label={label} required={required} error={error}>
      <Input value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
```

---

## 8. `DynamicFormCard` — Full Implementation

```tsx
// src/components/crm/dynamic-form-card.tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardComponent } from '@/components/ui/stack';
import { useCardReady } from '@/components/ui/stack';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { showSuccessToast, showErrorToast } from '@/components/ui/toast';
import { SYSTEM_FIELDS, isRequiredField } from '@/lib/meta/field-renderer';
import { useTableMeta } from '@/lib/meta/use-meta';
import { DynamicField } from './dynamic-field';
import { Loader2 } from 'lucide-react';
import { CRM_ENDPOINT } from '@/components/crm/crm-provider';
import { TokenManager } from '@/lib/auth/token-manager';
import type { MetaTable } from '@/types/meta';

export type DynamicFormCardProps = {
  tableName: string;   // e.g. 'Contact'
  recordId?: string;   // undefined = create mode
  onSuccess?: () => void;
};

async function crmRequest(query: string, variables?: Record<string, unknown>) {
  const { token } = TokenManager.getToken('schema-builder');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token.accessToken}`;
  const res = await fetch(CRM_ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`GraphQL error: ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

function buildFetchQuery(table: MetaTable): string {
  const fields = table.fields.map((f) => f.name).join('\n    ');
  return `query DynamicFetch($id: UUID!) { ${table.query.one}(id: $id) { ${fields} } }`;
}

export const DynamicFormCard: CardComponent<DynamicFormCardProps> = ({
  tableName, recordId, onSuccess, card,
}) => {
  const isEditMode = !!recordId;
  const { isReady } = useCardReady();
  const tableMeta = useTableMeta(tableName);
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [initialized, setInitialized] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const fkFields = useMemo(
    () => new Set(tableMeta?.foreignKeyConstraints.flatMap((fk) => fk.fields.map((f) => f.name)) ?? []),
    [tableMeta],
  );

  const editableFields = useMemo(
    () => tableMeta?.fields.filter((f) => !SYSTEM_FIELDS.has(f.name)) ?? [],
    [tableMeta],
  );

  const fetchQuery = useMemo(
    () => (tableMeta?.query.one ? buildFetchQuery(tableMeta) : null),
    [tableMeta],
  );

  const { data: existingRecord, isLoading: isLoadingRecord } = useQuery({
    queryKey: ['dynamic-record', tableName, recordId],
    queryFn: async () => {
      const data = await crmRequest(fetchQuery!, { id: recordId });
      return data[tableMeta!.query.one!] as Record<string, unknown> | null;
    },
    enabled: isReady && isEditMode && !!tableMeta && !!fetchQuery,
    staleTime: 0,
  });

  // Initialize form from existing record once loaded
  if (existingRecord && !initialized) {
    const initial: Record<string, unknown> = {};
    for (const field of editableFields) {
      if (existingRecord[field.name] !== undefined) initial[field.name] = existingRecord[field.name];
    }
    setFormValues(initial);
    setInitialized(true);
  }

  const setFieldValue = (name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => { const next = { ...prev }; delete next[name]; return next; });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    for (const field of editableFields) {
      if (isRequiredField(field)) {
        const val = formValues[field.name];
        if (val === undefined || val === null || val === '') errors[field.name] = `${field.name} is required`;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!tableMeta || !validate()) return;
    setIsSaving(true);
    try {
      const input: Record<string, unknown> = {};
      for (const field of editableFields) {
        const val = formValues[field.name];
        if (val !== undefined && val !== '') input[field.name] = val;
      }

      if (isEditMode) {
        const mutation = `
          mutation DynamicUpdate($id: UUID!, $patch: ${tableMeta.inflection.patchType}!) {
            ${tableMeta.query.update}(input: { id: $id, patch: $patch }) { clientMutationId }
          }
        `;
        await crmRequest(mutation, { id: recordId, patch: input });
      } else {
        const mutation = `
          mutation DynamicCreate($input: ${tableMeta.inflection.createInputType}!) {
            ${tableMeta.query.create}(input: { input: $input }) { clientMutationId }
          }
        `;
        await crmRequest(mutation, { input });
      }

      await queryClient.invalidateQueries({ queryKey: [tableMeta.query.all] });
      if (isEditMode && recordId) {
        await queryClient.invalidateQueries({ queryKey: ['dynamic-record', tableName, recordId] });
      }
      showSuccessToast({ message: isEditMode ? `${tableName} updated` : `${tableName} created` });
      onSuccess?.();
      card.close();
    } catch (err) {
      showErrorToast({
        message: `Failed to ${isEditMode ? 'update' : 'create'} ${tableName}`,
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!tableMeta || !recordId) return;
    card.push({
      id: `confirm-delete-${recordId}`,
      title: `Delete ${tableName}?`,
      description: 'This action cannot be undone.',
      Component: ConfirmDeleteCard,
      props: {
        tableName, recordId,
        deleteMutation: tableMeta.query.delete!,
        tableType: tableMeta.inflection.tableType,
        listQueryKey: tableMeta.query.all,
        onSuccess: () => { onSuccess?.(); card.close(); },
      },
      width: 400,
    });
  };

  if (!tableMeta || (isEditMode && isLoadingRecord && !initialized)) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-4 p-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {editableFields.map((field) => (
          <DynamicField
            key={field.name}
            field={field}
            value={formValues[field.name]}
            onChange={(val) => setFieldValue(field.name, val)}
            isForeignKey={fkFields.has(field.name)}
            error={fieldErrors[field.name]}
          />
        ))}
        {editableFields.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No editable fields — all fields are system-managed.
          </p>
        )}
      </div>

      {/* Sticky footer */}
      <div className="flex items-center justify-between border-t px-4 py-3">
        {isEditMode && tableMeta.query.delete ? (
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isSaving}>Delete</Button>
        ) : <div />}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => card.close()} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>) : isEditMode ? 'Save Changes' : `Create ${tableName}`}
          </Button>
        </div>
      </div>
    </div>
  );
};
```

### ConfirmDeleteCard (include in same file)

```tsx
type ConfirmDeleteCardProps = {
  tableName: string; recordId: string; deleteMutation: string;
  tableType: string; listQueryKey: string; onSuccess?: () => void;
};

const ConfirmDeleteCard: CardComponent<ConfirmDeleteCardProps> = ({
  tableName, recordId, deleteMutation, tableType, listQueryKey, onSuccess, card,
}) => {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      const mutation = `
        mutation DynamicDelete($id: UUID!) {
          ${deleteMutation}(input: { id: $id }) { deleted${tableType}Id }
        }
      `;
      await crmRequest(mutation, { id: recordId });
      await queryClient.invalidateQueries({ queryKey: [listQueryKey] });
      showSuccessToast({ message: `${tableName} deleted` });
      onSuccess?.(); card.close();
    } catch (err) {
      showErrorToast({ message: `Failed to delete ${tableName}`, description: err instanceof Error ? err.message : 'Unknown error' });
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 p-4">
        <p className="text-muted-foreground text-sm">
          Are you sure you want to delete this {tableName.toLowerCase()}? This cannot be undone.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="outline" onClick={() => card.close()} disabled={isDeleting}>Cancel</Button>
        <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
          {isDeleting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting…</> : `Delete ${tableName}`}
        </Button>
      </div>
    </div>
  );
};
```

---

## 9. Universal Usage — One Component, Any Table

```tsx
import { DynamicFormCard } from '@/components/crm/dynamic-form-card';
import { useCardStack } from '@/components/ui/stack';

// Create a new Contact
stack.push({ id: 'create-contact', title: 'New Contact', Component: DynamicFormCard, props: { tableName: 'Contact' }, width: 480 });

// Edit an existing Contact
stack.push({ id: `edit-contact-${id}`, title: 'Edit Contact', Component: DynamicFormCard, props: { tableName: 'Contact', recordId: id }, width: 480 });

// Create a Note (with FK pre-fill — set initialValues via DynamicFormCard initialValues prop if extended)
stack.push({ id: 'create-note', title: 'Add Note', Component: DynamicFormCard, props: { tableName: 'Note' }, width: 480 });

// Any table
stack.push({ id: 'create-deal', title: 'New Deal', Component: DynamicFormCard, props: { tableName: 'Deal' }, width: 480 });
```

---

## 10. FK Fields — Current Behavior and Future Extension

When a field appears in `foreignKeyConstraints`, `DynamicField` currently renders a plain UUID text input (labeled as a foreign key). This is safe but not ideal UX.

**To extend with EntitySearch:**

```tsx
if (inputType === 'select') {
  const fk = tableMeta.foreignKeyConstraints.find(
    (c) => c.fields[0]?.name === field.name,
  );
  return (
    <Field label={toLabel(field.name)} required={required}>
      <EntitySearch
        tableName={fk?.referencedTable ?? ''}
        value={value as string}
        onChange={onChange}
      />
    </Field>
  );
}
```

---

## 11. pgType → Form Input Reference

| pgType | Input | Notes |
|---|---|---|
| `text`, `varchar`, `citext` | `<Input>` | `<Textarea>` if name contains bio/description/notes |
| `int2/4/8`, `float4/8`, `numeric` | `<Input type="number">` | |
| `bool`, `boolean` | `<Switch>` | |
| `date` | `<Input type="date">` | |
| `timestamp`, `timestamptz` | `<Input type="datetime-local">` | |
| `uuid` (FK) | `<Input>` (UUID) | Future: `<EntitySearch>` |
| `uuid` (non-FK) | `<Input>` (UUID) | Rare — show UUID input |
| `json`, `jsonb` | `<Textarea className="font-mono">` | JSON.parse/stringify |
| `_text` (text[]) | `<TagInput>` | Future work |
| enum | `<Select>` | Use `__schema` for enum values |

---

## 12. Troubleshooting

| Issue | Solution |
|---|---|
| `_meta` returns empty tables | Check auth headers — `_meta` may require an authenticated request |
| Dynamic mutation fails with type error | Verify `inflection.patchType` / `createInputType` match schema |
| Form shows no editable fields | All fields may be in SYSTEM_FIELDS — check table schema |
| FK field renders as plain UUID input | Expected (EntitySearch is future work). Plain UUID works. |
| Required validation triggers on system fields | Verify `SYSTEM_FIELDS` set covers all auto-managed fields |
| Edit form empty on open | Check `useCardReady()` gate — data fetches after animation |
| `hasDefault=true` field required in form | Bug — fix `isRequiredField` to check `!hasDefault` |
