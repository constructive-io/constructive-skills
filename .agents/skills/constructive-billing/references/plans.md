# Plans and the Plan Cascade

A **plan** bundles the configuration an entity gets when it subscribes: its limits, its billing quotas and its feature flags (caps). Subscribing an entity to a plan cascades that configuration into all three in one step, so a plan change is one write, not three.

## Tables (generated per scope by `plans_module` and `billing_module`)

| Table | Module | What it holds |
|-------|--------|---------------|
| `plans` | `plans_module` | The plan catalog |
| `plan_caps` | `plans_module` | Feature flags a plan grants (`cap_name` → `cap_value`) |
| `plan_meter_limits` | `plans_module` | Billing quotas a plan grants per meter (`meter_slug`) |
| `plan_pricing` | `plans_module` | Price per plan (`price`, `currency`, `billing_interval`, `discount_percent`) |
| `plan_subscriptions` | `billing_module` | Which plan an entity is on |
| `meter_defaults` | `billing_module` | Default quotas when an entity has no plan |
| `credit_packs` | `billing_module` | Purchasable credit packs |

Each table is generated with the scope's prefix, so the ORM models are named per scope (e.g. `db.appPlan`, `db.appPlanCap`, `db.appPlanSubscription` for the app scope). Confirm the exact model names for your scope with introspection.

There is no per-entity plan-override table: an entity's effective configuration is its plan, then the per-entity rows in the limit and cap tables (`limit_caps`, see [limits.md](./limits.md)).

## The cascade

`plans_module` owns `apply_plan` / `apply_plan_caps`; `billing_module` owns `plan_subscriptions`. A trigger on `plan_subscriptions` applies the subscribed plan's limits, meter quotas and caps to the entity. Because the cascade needs both modules, it is wired after both are installed — provision `plans_module` together with `billing_module` (the billing presets do).

## Workflow

1. Create the plans (`db.<scope>Plan.create`).
2. Attach their caps, meter limits and pricing (`<scope>PlanCap`, `<scope>PlanMeterLimit`, `<scope>PlanPricing`).
3. Subscribe an entity (`<scope>PlanSubscription.create`); change plans by updating the subscription — the cascade re-applies.
4. Read the effective feature flags and limits from the cap and limit tables, never from the plan rows.
