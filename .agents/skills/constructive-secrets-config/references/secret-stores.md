# Where a secret or a config value lives — the four stores

Constructive stores durable values in four places, and the choice is made on two
questions only: **is the value secret?** and **does Kubernetes have to see it?**

| | secret (encrypted at rest) | config (plaintext by design) |
|---|---|---|
| **internal** — lives in the database, no namespace | `internal_secrets_module` | `internal_config_module` |
| **infra** — namespace-backed, projected into the cluster | `infra_secrets_module` | `infra_config_module` |

All four are scope-aware — `platform`, the database's own `app` scope, a specific
`database`, or an entity (e.g. an org) — and all four carry the nullable `realm`
lane described in [`realms.md`](./realms.md).

## Pick one

- **Internal is the default.** A value your code reads while it runs — a provider
  credential, a feature flag, a limit, an endpoint — belongs in an internal store.
  Nothing about it requires a Kubernetes namespace, and asking for one just to
  hold a credential is the mistake this split exists to remove.
- **Infra is a deliberate promotion.** Use it only when the value must be
  *mounted* by the cluster: an environment variable or file a container reads at
  boot, image-pull credentials, infrastructure connection material. Writing to an
  infra store attaches the value to a namespace and projects it into a Kubernetes
  Secret or ConfigMap.
- **Secret vs config is a safety category, not a convenience.** Never put a
  credential in a config store to make it easier to see, and never put a listable
  setting in a secret store — you will only make it unreadable.

Two more stores are neither of these, and are the right answer when they fit:
per-user credentials (`user_credentials_module`) hold one-way hashes for passwords
and API keys — something a caller *proves*, never retrieves — and session secrets
(`session_secrets_module`) hold short-lived challenges (WebAuthn, MFA, magic-link,
PKCE) that expire rather than rotate.

## Secret values do not come back out

Secret values are **encrypted at rest** and may only be decrypted through the
trusted runtime secret-resolution path; they are never part of a readable
row. Through the SDK/ORM you get the metadata surface — name, realm, description,
labels, annotations, provider, and the rotation/retirement timestamps — plus the
write surface: set, rotate, retire, delete. There is no read operation that
returns a secret's value, and there is no `getSecret` to look for.

```typescript
// Metadata is ordinary ORM territory — note that no value field exists.
await db.secret.findMany({
  where: { name: { equalTo: 'MAILGUN_API_KEY' } },
  select: { id: true, name: true, realm: true, rotatedAt: true },
}).execute();
```

The value is resolved only by trusted code running inside the platform: a
deployed function reads it at invocation time through its own runtime context,
for the tenant it is currently serving. It never travels in a job payload, an API
response, or a client bundle — which is precisely why one function image can serve
every tenant without any of them being able to read another's material.

Practical consequence for app builders:

- **Write, rotate and retire** secrets through the SDK; **display** their metadata.
- To *use* a secret, deploy code that declares it and let the runtime resolve it.
  Declaration is enforcement: a function may only resolve names it declared.
- If a flow seems to need the plaintext in the client, it is the wrong flow —
  move the work into a function.
- One-time reveal surfaces (API-key creation) are the deliberate exception, and
  they are step-up gated and show-once; see §3 of the parent skill.

Config values are the opposite by design: plaintext, readable, editable through
the ordinary ORM surface, because a setting is meant to be listed and changed.

## Namespaces

A namespace is a Kubernetes concept, and only the two infra stores carry one.
Internal stores have no namespace field at all — if a store you are writing to
asks for a namespace, you are on the infra lane and the value will be projected
into the cluster. Decide that on purpose.
