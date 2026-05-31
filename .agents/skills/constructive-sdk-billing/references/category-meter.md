# Category Meter (Three-Tier Credit Waterfall)

The `category_meter` column on the `meters` table (type: `citext`, optional FK) groups meters into categories. This enables a three-tier credit waterfall: **meter → category → universal**.

## Waterfall Order

When a meter's own quota is exceeded:

1. **Meter quota** — check the meter's own `balances` row
2. **Category pool** — if `category_meter` is set, try the category pool meter
3. **Universal pool** — if `credit_cost > 0`, try the `universal` meter

If `category_meter` is NULL, step 2 is skipped and it falls through directly to universal.

## Configuring via ORM

```typescript
// 1. Create a category pool meter
await db.meter.create({
  data: {
    slug: 'ai_credits',
    displayName: 'AI Credits Pool',
    meterType: 'credit_pool',
    periodInterval: '1 month',
  },
});

// 2. Assign meters to the category
await db.meter.update({
  where: { slug: 'llm_input_tokens' },
  data: { categoryMeter: 'ai_credits' },
});

await db.meter.update({
  where: { slug: 'embedding_tokens' },
  data: { categoryMeter: 'ai_credits' },
});

// 3. Grant credits to the category pool
await db.meterCredit.create({
  data: {
    meterId: aiCreditsMeterId,
    entityId: orgId,
    amount: 10000,
    creditType: 'period',
    reason: 'plan:pro_monthly_ai',
  },
});
```

## Waterfall Example

```
record_usage('llm_input_tokens', entity, 100)
  │
  ▼
┌──────────────────────────┐
│ llm_input_tokens balance │
│ usage: 950 / limit: 1000 │
│ 950 + 100 = 1050 > 1000  │
│ → OVER LIMIT             │
└──────────┬───────────────┘
           │ category_meter = 'ai_credits'
           ▼
┌──────────────────────────┐
│ ai_credits balance       │
│ usage: 5000 / limit: 10000│
│ 5000 + 100 = 5100 ≤ 10000│
│ → ALLOW (category pool)  │
└──────────────────────────┘

If ai_credits also exhausted:
           │ credit_cost > 0
           ▼
┌──────────────────────────┐
│ universal balance        │
│ Check capacity           │
└──────────────────────────┘
```

## Use Cases

- **AI meters**: Group `llm_input_tokens`, `llm_output_tokens`, `embedding_tokens` under an `ai_credits` category. One shared AI budget.
- **Storage meters**: Group `storage_gb`, `bandwidth_gb` under a `storage_credits` category.
- **Tiered pricing**: Different credit costs per meter within the same category allow weighted consumption.
