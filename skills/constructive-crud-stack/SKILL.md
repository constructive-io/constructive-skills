---
name: constructive-crud-stack
description: Build CRUD forms as Stack cards (iOS-style slide-in panel from the right) for any Constructive DB table. Includes using the _meta GraphQL query to dynamically discover table fields, types, and FK relationships, then render forms without static configuration. Use when building create/edit/delete UI for any Constructive-provisioned table.
compatibility: Next.js 14+ (App Router), Constructive SDK, @constructive/stack, @tanstack/react-query
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive CRUD Stack Cards

Build fully dynamic create/edit/delete forms as slide-in Stack cards — no hardcoded field lists required. The `_meta` GraphQL query tells you everything about the schema at runtime.

---

## 1. The Stack Card Pattern for CRUD

Every create/edit action triggers a card that slides in from the right with a dimmed backdrop. Cancel/Save/Delete CTAs live in a sticky footer.

### Trigger (any page or button)

```tsx
'use client';
import { useCardStack } from '@/components/ui/stack';
import { EditContactCard } from './edit-contact-card';

function EditContactButton({ contactId }: { contactId: string }) {
  const stack = useCardStack();

  return (
    <Button
      onClick={() =>
        stack.push({
          id: `edit-contact-${contactId}`,
          title: 'Edit Contact',
          description: 'Update contact details.',
          Component: EditContactCard,
          props: { contactId },
          width: 480,
        })
      }
    >
      Edit
    </Button>
  );
}
```

### Card Component Structure

```tsx
'use client';
import type { CardComponent } from '@/components/ui/stack';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';

export type EditContactCardProps = {
  contactId: string;
  onSuccess?: () => void;
};

export const EditContactCard: CardComponent<EditContactCardProps> = ({
  contactId,
  onSuccess,
  card,       // ← injected by CardStackProvider: card.close(), card.push(), card.setTitle()
}) => {
  // Hooks, state, mutations here

  return (
    <div className='flex h-full flex-col'>
      {/* ── Scrollable Form Body ── */}
      <div className='flex-1 space-y-4 overflow-y-auto p-4'>
        <Field label='Name'>
          <InputGroup>
            <InputGroupInput value={name} onChange={(e) => setName(e.target.value)} />
          </InputGroup>
        </Field>
        {/* more fields... */}
      </div>

      {/* ── Sticky Footer ── */}
      <div className='flex items-center justify-between border-t px-4 py-3'>
        <Button variant='destructive' onClick={handleDelete}>Delete</Button>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => card.close()}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>Save</Button>
        </div>
      </div>
    </div>
  );
};
```

### Card API (`card` prop — injected by CardStackProvider)

| Method | Description |
|---|---|
| `card.close()` | Dismiss this card with animation |
| `card.push({ id, title, Component, props })` | Push a new card on top (e.g., confirm delete) |
| `card.setTitle(title)` | Update card header title dynamically |
| `card.setDescription(desc)` | Update subtitle |
| `card.updateProps(patch)` | Patch card props from inside the card |

### Layout: Deferred Data Loading

Use `useCardReady()` to delay data fetching until the enter animation completes (avoids janky mid-animation fetches):

```tsx
import { useCardReady } from '@/components/ui/stack';

export const EditContactCard: CardComponent<Props> = ({ contactId }) => {
  const { isReady } = useCardReady();

  const { data } = useContactQuery({
    variables: { id: contactId },
    enabled: isReady,  // ← only fetches after animation
  });
};
```

### Stacked Confirm Delete

Push a confirm card instead of using a dialog:

```tsx
const handleDeleteClick = () => {
  card.push({
    id: `confirm-delete-${contactId}`,
    title: 'Delete Contact?',
    description: 'This cannot be undone.',
    Component: ConfirmDeleteCard,
    props: {
      message: 'Are you sure you want to delete this contact?',
      onConfirm: async () => {
        await deleteContact({ id: contactId });
        card.close();  // closes confirm card
        card.close();  // closes edit card
      },
    },
    width: 400,
  });
};
```

---

## 2. The `_meta` Query — Dynamic Schema Discovery

Every Constructive app-public endpoint exposes `_meta { tables { ... } }` — a complete schema map including fields, types, FKs, mutation names, and inflection types.

### Full Query

```graphql
query GetMeta {
  _meta {
    tables {
      name                  # GraphQL type: "Contact"
      fields {
        name                # camelCase field name
        isNotNull           # required?
        hasDefault          # skip in create form if true (auto-generated)
        type {
          pgType            # "text", "uuid", "timestamptz", "bool", "int4", etc.
          gqlType           # "String", "UUID", "Datetime", "Boolean", "Int"
          isArray           # array field?
        }
      }
      inflection {
        tableType           # "Contact" — GraphQL object type
        createInputType     # "CreateContactInput"
        patchType           # "ContactPatch"
        filterType          # "ContactFilter"
        orderByType         # "ContactOrderBy"
      }
      query {
        all                 # "contacts" — list query name
        one                 # "contact" — single record query
        create              # "createContact" — mutation name
        update              # "updateContact" — mutation name
        delete              # "deleteContact" — mutation name
      }
      primaryKeyConstraints {
        name
        fields { name }
      }
      foreignKeyConstraints {
        name
        fields { name }        # local FK field (e.g., "contactId")
        referencedTable        # "contacts"
        referencedFields       # ["id"]
      }
      uniqueConstraints {
        name
        fields { name }
      }
    }
  }
}
```

### TypeScript Types

```ts
export type MetaField = {
  name: string;
  isNotNull: boolean;
  hasDefault: boolean;
  type: {
    pgType: string;   // postgres type: text, uuid, timestamptz, bool, int4, jsonb, etc.
    gqlType: string;  // graphql scalar: String, UUID, Datetime, Boolean, Int, JSON
    isArray: boolean;
  };
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

### Fetching `_meta` in React

```tsx
// hooks/use-meta.ts
import { useQuery } from '@tanstack/react-query';
import { gql, request } from 'graphql-request';
import type { MetaTable } from '@/types/meta';

const META_QUERY = gql`
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

export function useMeta() {
  return useQuery({
    queryKey: ['_meta'],
    queryFn: () => request<{ _meta: { tables: MetaTable[] } }>(endpoint, META_QUERY),
    staleTime: Infinity,  // schema doesn't change at runtime
  });
}

export function useTableMeta(tableName: string) {
  const { data } = useMeta();
  return data?._meta.tables.find((t) => t.name === tableName) ?? null;
}
```

---

## 3. Dynamic Form Rendering

Use `_meta` to render forms without any static field configuration. The system maps `pgType`/`gqlType` → input component automatically.

### Field Type → Input Component Map

```ts
// lib/field-renderer.ts

export const SYSTEM_FIELDS = new Set([
  'id', 'entityId', 'createdAt', 'updatedAt',
  'created_at', 'updated_at', 'entity_id',
]);

export type FieldInputType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'uuid'
  | 'json'
  | 'select'     // FK field → renders as search/select
  | 'hidden';

export function getInputType(field: MetaField, isForeignKey: boolean): FieldInputType {
  if (SYSTEM_FIELDS.has(field.name)) return 'hidden';
  if (isForeignKey) return 'select';

  switch (field.type.pgType) {
    case 'text':
    case 'varchar':
    case 'citext':
      return field.name.includes('bio') || field.name.includes('description') || field.name.includes('notes')
        ? 'textarea'
        : 'text';
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
      return 'number';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'timestamp':
    case 'timestamptz':
      return 'datetime';
    case 'uuid':
      return 'uuid';
    case 'json':
    case 'jsonb':
      return 'json';
    default:
      return 'text';
  }
}

export function toLabel(fieldName: string): string {
  // camelCase → "Camel Case"
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}
```

### `<DynamicField />` Component

```tsx
// components/crm/dynamic-field.tsx
'use client';

import { Field } from '@/components/ui/field';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { MetaField } from '@/types/meta';
import { getInputType, toLabel, SYSTEM_FIELDS } from '@/lib/field-renderer';

type DynamicFieldProps = {
  field: MetaField;
  value: unknown;
  onChange: (value: unknown) => void;
  isForeignKey?: boolean;
  error?: string;
};

export function DynamicField({ field, value, onChange, isForeignKey, error }: DynamicFieldProps) {
  if (SYSTEM_FIELDS.has(field.name)) return null;

  const inputType = getInputType(field, !!isForeignKey);
  const label = toLabel(field.name);
  const required = field.isNotNull && !field.hasDefault;

  switch (inputType) {
    case 'textarea':
      return (
        <Field label={label} required={required} error={error}>
          <Textarea
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
          />
        </Field>
      );

    case 'boolean':
      return (
        <div className='flex items-center gap-3'>
          <Switch
            checked={(value as boolean) ?? false}
            onCheckedChange={onChange}
            id={field.name}
          />
          <Label htmlFor={field.name}>{label}</Label>
        </div>
      );

    case 'number':
      return (
        <Field label={label} required={required} error={error}>
          <InputGroup>
            <InputGroupInput
              type='number'
              value={(value as number) ?? ''}
              onChange={(e) => onChange(Number(e.target.value))}
            />
          </InputGroup>
        </Field>
      );

    case 'date':
    case 'datetime':
      return (
        <Field label={label} required={required} error={error}>
          <InputGroup>
            <InputGroupInput
              type={inputType === 'date' ? 'date' : 'datetime-local'}
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.target.value)}
            />
          </InputGroup>
        </Field>
      );

    case 'uuid':
      // UUID fields that aren't FK or system fields — render as text (rare)
      return (
        <Field label={label} required={required} error={error}>
          <InputGroup>
            <InputGroupInput
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
            />
          </InputGroup>
        </Field>
      );

    case 'select':
      // FK field — caller should provide a search/select component
      // This is a fallback — see DynamicForm for FK handling
      return (
        <Field label={label} required={required} error={error}>
          <InputGroup>
            <InputGroupInput
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={`Select ${label.toLowerCase()}...`}
            />
          </InputGroup>
        </Field>
      );

    case 'json':
      return (
        <Field label={label} required={required} error={error} description='JSON value'>
          <Textarea
            value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); }
              catch { onChange(e.target.value); }
            }}
            rows={6}
            className='font-mono text-xs'
          />
        </Field>
      );

    default: // text
      return (
        <Field label={label} required={required} error={error}>
          <InputGroup>
            <InputGroupInput
              value={(value as string) ?? ''}
              onChange={(e) => onChange(e.target.value)}
            />
          </InputGroup>
        </Field>
      );
  }
}
```

### `<DynamicForm />` — Full Dynamic CRUD Card

```tsx
// components/crm/dynamic-form-card.tsx
'use client';

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CardComponent } from '@/components/ui/stack';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { showSuccessToast, showErrorToast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';
import { useTableMeta } from '@/hooks/use-meta';
import { DynamicField } from './dynamic-field';
import { SYSTEM_FIELDS } from '@/lib/field-renderer';
import { gqlClient } from '@/lib/gql-client';
import { gql } from 'graphql-request';

export type DynamicFormCardProps = {
  /** The GraphQL type name — matches _meta.tables[].name (e.g., "Contact") */
  tableName: string;
  /** Existing record ID for edit mode (omit for create) */
  recordId?: string;
  /** Initial field values for edit mode */
  initialValues?: Record<string, unknown>;
  /** Called after successful save */
  onSuccess?: () => void;
};

export const DynamicFormCard: CardComponent<DynamicFormCardProps> = ({
  tableName,
  recordId,
  initialValues = {},
  onSuccess,
  card,
}) => {
  const isEditMode = !!recordId;
  const tableMeta = useTableMeta(tableName);
  const queryClient = useQueryClient();

  // Derive FK field names
  const fkFields = useMemo(
    () => new Set(tableMeta?.foreignKeyConstraints.flatMap((fk) => fk.fields.map((f) => f.name)) ?? []),
    [tableMeta],
  );

  // Form state — initialize from initialValues
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const setValue = (name: string, value: unknown) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  // Fields to render — exclude system fields
  const editableFields = useMemo(
    () => tableMeta?.fields.filter((f) => !SYSTEM_FIELDS.has(f.name)) ?? [],
    [tableMeta],
  );

  // Validate required fields
  const validate = () => {
    const newErrors: Record<string, string> = {};
    for (const field of editableFields) {
      if (field.isNotNull && !field.hasDefault && !values[field.name]) {
        newErrors[field.name] = `${field.name} is required`;
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!tableMeta || !validate()) return;
    setIsSaving(true);

    try {
      // Build input object — only editable fields
      const input: Record<string, unknown> = {};
      for (const field of editableFields) {
        if (values[field.name] !== undefined) {
          input[field.name] = values[field.name];
        }
      }

      if (isEditMode) {
        // Dynamic UPDATE mutation using patchType + updateMutation name
        const mutation = gql`
          mutation DynamicUpdate($id: UUID!, $patch: ${tableMeta.inflection.patchType}!) {
            ${tableMeta.query.update}(input: { id: $id, patch: $patch }) {
              ${tableMeta.inflection.tableType.toLowerCase()} { id }
            }
          }
        `;
        await gqlClient.request(mutation, { id: recordId, patch: input });
      } else {
        // Dynamic CREATE mutation using createInputType
        const mutation = gql`
          mutation DynamicCreate($input: ${tableMeta.inflection.createInputType}!) {
            ${tableMeta.query.create}(input: $input) {
              ${tableMeta.inflection.tableType.toLowerCase()} { id }
            }
          }
        `;
        await gqlClient.request(mutation, { input });
      }

      showSuccessToast({
        message: isEditMode ? `${tableName} updated` : `${tableName} created`,
      });

      // Invalidate list query
      await queryClient.invalidateQueries({ queryKey: [tableMeta.query.all] });

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

  const handleDelete = async () => {
    if (!tableMeta || !recordId) return;

    // Push confirm card
    card.push({
      id: `confirm-delete-${recordId}`,
      title: `Delete ${tableName}?`,
      description: 'This action cannot be undone.',
      Component: ConfirmDeleteCard,
      props: {
        tableName,
        recordId,
        deleteMutation: tableMeta.query.delete!,
        tableType: tableMeta.inflection.tableType,
        listQueryKey: tableMeta.query.all,
        onSuccess: () => {
          onSuccess?.();
          card.close();
        },
      },
    });
  };

  if (!tableMeta) {
    return (
      <div className='flex h-full flex-col'>
        <div className='flex-1 space-y-4 p-4'>
          {[1, 2, 3].map((i) => (
            <div key={i} className='space-y-2'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-9 w-full' />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const canSave = !isSaving && editableFields.every(
    (f) => !f.isNotNull || f.hasDefault || values[f.name] !== undefined,
  );

  return (
    <div className='flex h-full flex-col'>
      {/* Form Body */}
      <div className='flex-1 space-y-4 overflow-y-auto p-4'>
        {editableFields.map((field) => (
          <DynamicField
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(val) => setValue(field.name, val)}
            isForeignKey={fkFields.has(field.name)}
            error={errors[field.name]}
          />
        ))}

        {editableFields.length === 0 && (
          <p className='text-muted-foreground py-8 text-center text-sm'>
            No editable fields — all fields are system-managed.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className='flex items-center justify-between border-t px-4 py-3'>
        {isEditMode && tableMeta.query.delete ? (
          <Button variant='destructive' size='sm' onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
            Delete
          </Button>
        ) : (
          <div />
        )}
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => card.close()}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isSaving ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Saving...
              </>
            ) : isEditMode ? (
              'Save Changes'
            ) : (
              `Create ${tableName}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ── Confirm Delete Card ──

type ConfirmDeleteCardProps = {
  tableName: string;
  recordId: string;
  deleteMutation: string;
  tableType: string;
  listQueryKey: string;
  onSuccess?: () => void;
};

const ConfirmDeleteCard: CardComponent<ConfirmDeleteCardProps> = ({
  tableName,
  recordId,
  deleteMutation,
  tableType,
  listQueryKey,
  onSuccess,
  card,
}) => {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      const mutation = gql`
        mutation DynamicDelete($id: UUID!) {
          ${deleteMutation}(input: { id: $id }) {
            deleted${tableType}Id
          }
        }
      `;
      const client = gqlClient;
      await client.request(mutation, { id: recordId });
      await queryClient.invalidateQueries({ queryKey: [listQueryKey] });
      showSuccessToast({ message: `${tableName} deleted` });
      onSuccess?.();
      card.close();
    } catch (err) {
      showErrorToast({
        message: `Failed to delete ${tableName}`,
        description: err instanceof Error ? err.message : 'Unknown error',
      });
      setIsDeleting(false);
    }
  };

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 p-4'>
        <p className='text-muted-foreground text-sm'>
          Are you sure you want to delete this {tableName.toLowerCase()}? This cannot be undone.
        </p>
      </div>
      <div className='flex justify-end gap-2 border-t px-4 py-3'>
        <Button variant='outline' onClick={() => card.close()}>Cancel</Button>
        <Button variant='destructive' onClick={handleConfirm} disabled={isDeleting}>
          {isDeleting ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          Delete {tableName}
        </Button>
      </div>
    </div>
  );
};
```

---

## 4. Universal Usage — One Component, Any Table

With `DynamicFormCard`, a single component handles CRUD for every table in the schema:

```tsx
// Create a new Contact
stack.push({
  id: 'create-contact',
  title: 'New Contact',
  Component: DynamicFormCard,
  props: { tableName: 'Contact' },
  width: 480,
});

// Edit an existing Company
stack.push({
  id: `edit-company-${id}`,
  title: 'Edit Company',
  Component: DynamicFormCard,
  props: {
    tableName: 'Company',
    recordId: id,
    initialValues: { name: company.name, website: company.website },
  },
  width: 480,
});

// Create a Note linked to a Contact
stack.push({
  id: 'create-note',
  title: 'Add Note',
  Component: DynamicFormCard,
  props: {
    tableName: 'Note',
    initialValues: { contactId: contactId },  // pre-fill FK
  },
  width: 480,
});
```

---

## 5. FK Fields — Smart Select Rendering

When a field appears in `foreignKeyConstraints`, render a search select instead of a plain input. Extend `DynamicField` with a custom FK renderer:

```tsx
// In DynamicForm — FK fields get a special component
if (fkFields.has(field.name)) {
  const fk = tableMeta.foreignKeyConstraints.find(
    (c) => c.fields[0]?.name === field.name,
  );

  return (
    <Field key={field.name} label={toLabel(field.name)} required={required}>
      <EntitySearch
        tableName={fk?.referencedTable ?? ''}   // e.g., "contacts"
        value={values[field.name] as string}
        onChange={(val) => setValue(field.name, val)}
      />
    </Field>
  );
}
```

---

## 6. Field Filtering — Skip System and Internal Fields

Always filter these before rendering:

```ts
export const SYSTEM_FIELDS = new Set([
  'id',         // auto-generated UUID
  'entityId',   // org scoping — set server-side
  'createdAt',  // auto-managed
  'updatedAt',  // auto-managed
]);

// In form:
const editableFields = tableMeta.fields.filter(
  (f) => !SYSTEM_FIELDS.has(f.name) && !fkFields.has(f.name) // handle FKs separately
);
```

---

## 7. _meta vs GraphQL Introspection — When to Use Which

| Need | Use |
|---|---|
| Field names + types for form rendering | `_meta` — cleaner, Constructive-specific |
| FK relationships and references | `_meta foreignKeyConstraints` |
| Mutation/query names | `_meta query { all one create update delete }` |
| GraphQL type names for dynamic mutations | `_meta inflection` |
| Full type system (scalars, enums, unions) | `__schema` introspection |
| Check if a field is nullable | `_meta fields.isNotNull` |
| List all available queries | `__schema queryType fields` |

### Key `_meta` Values

```ts
// From _meta, you get everything to build a mutation dynamically:
table.inflection.patchType       // "ContactPatch" → use in update mutation type
table.inflection.createInputType // "CreateContactInput" → use in create mutation type
table.query.create               // "createContact" → mutation name
table.query.update               // "updateContact" → mutation name
table.query.delete               // "deleteContact" → mutation name
table.query.all                  // "contacts" → invalidate after mutation
```

---

## 8. pgType → Form Input Reference

| pgType | Input | Notes |
|---|---|---|
| `text`, `varchar`, `citext` | `<Input>` | Use `<Textarea>` for bio/description/notes |
| `int2/4/8`, `float4/8`, `numeric` | `<Input type="number">` | |
| `bool`, `boolean` | `<Switch>` | |
| `date` | `<Input type="date">` | |
| `timestamp`, `timestamptz` | `<Input type="datetime-local">` | |
| `uuid` (FK) | `<EntitySearch>` | Render as relationship picker |
| `uuid` (non-FK) | `<Input>` | Rare — show UUID input |
| `json`, `jsonb` | `<Textarea className="font-mono">` | Validate as JSON |
| `_text` (text[]) | `<TagInput>` | Arrays → multi-value input |
| enum | `<Select>` | Use `__schema` to get enum values |

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `useCardStack must be used within a CardStackProvider` | Ensure `CardStackProvider` is in root `layout.tsx` |
| Card doesn't slide in | Check `ClientOnlyStackViewport` is mounted (prevents hydration mismatch) |
| `_meta` returns empty tables | Check auth headers — `_meta` may require authenticated request |
| Dynamic mutation fails with type error | Verify `inflection.patchType` / `createInputType` match schema |
| FK field renders as plain input | Check `foreignKeyConstraints` — field name must match `fk.fields[0].name` |
| Form shows system fields | Verify `SYSTEM_FIELDS` includes all auto-managed fields |
