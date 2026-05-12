---
name: constructive-sdk-site
description: Create and manage sites in Constructive using the type-safe SDK. Use when asked to "create a site", "configure site metadata", "manage site themes", "set up site modules", or when working with services_public.sites operations.
compatibility: Node.js 22+, @constructive-io/sdk
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Site Management

Create and manage sites in Constructive using the type-safe SDK generated from GraphQL codegen.

## When to Apply

Use this skill when:
- Creating a new site for a database
- Configuring site metadata (title, description, images)
- Managing site themes and styling
- Setting up site modules (legal terms, etc.)
- Working with the `services_public.sites` table

## Prerequisites

Install the SDK:

```bash
pnpm add @constructive-io/sdk
```

## Site Schema

The `services_public.sites` table stores site configuration:

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `databaseId` | uuid | Parent database ID |
| `title` | text | Site title (max 120 chars) |
| `description` | text | Site description (max 120 chars) |
| `ogImage` | image | Open Graph image |
| `favicon` | attachment | Favicon URL |
| `appleTouchIcon` | image | Apple touch icon |
| `logo` | image | Site logo |
| `dbname` | text | PostgreSQL database name |

## SDK Client Setup

```typescript
import { createClient } from '@constructive-io/sdk';

const db = createClient({
  endpoint: process.env.GRAPHQL_ENDPOINT || 'https://api.constructive.io/graphql',
  headers: {
    Authorization: `Bearer ${process.env.API_TOKEN}`,
  },
});
```

## Creating a Site

### Basic Site Creation

```typescript
const result = await db.site.create({
  data: {
    databaseId: databaseId,
    title: 'My Application',
    description: 'A great app built with Constructive',
  },
  select: {
    id: true,
    title: true,
    description: true,
  },
}).execute();

if (result.ok) {
  const site = result.data.createSite.site;
  console.log('Created site:', site.id);
  console.log('Title:', site.title);
} else {
  console.error('Failed to create site:', result.errors);
}
```

### Site with Full Branding

```typescript
const result = await db.site.create({
  data: {
    databaseId: databaseId,
    title: 'My Application',
    description: 'A great app built with Constructive',
    logo: {
      url: 'https://example.com/logo.png',
      mime: 'image/png',
    },
    favicon: 'https://example.com/favicon.ico',
    appleTouchIcon: {
      url: 'https://example.com/apple-touch-icon.png',
      mime: 'image/png',
    },
    ogImage: {
      url: 'https://example.com/og-image.jpg',
      mime: 'image/jpeg',
    },
  },
  select: {
    id: true,
    title: true,
    logo: true,
    favicon: true,
  },
}).execute();
```

## Site Themes

Site themes control the visual appearance:

```typescript
const result = await db.siteTheme.create({
  data: {
    databaseId: databaseId,
    siteId: siteId,
    theme: {
      background: '#f2fafd',
      primary: '#01A1FF',
      colors: ['#66d9ff', '#91d5ee', '#ffffff', '#33CCFF'],
    },
  },
  select: {
    id: true,
    theme: true,
  },
}).execute();

if (result.ok) {
  console.log('Created theme:', result.data.createSiteTheme.siteTheme.theme);
}
```

### Update Site Theme

```typescript
const result = await db.siteTheme.update({
  where: { id: themeId },
  data: {
    theme: {
      background: '#1a1a2e',
      primary: '#e94560',
      colors: ['#16213e', '#0f3460', '#e94560', '#ffffff'],
    },
  },
  select: {
    id: true,
    theme: true,
  },
}).execute();
```

## Site Modules

Site modules add functionality to sites:

### Legal Terms Module

```typescript
const result = await db.siteModule.create({
  data: {
    databaseId: databaseId,
    siteId: siteId,
    name: 'legal_terms_module',
    data: {
      company: {
        nick: 'My App',
        name: 'My Company, Inc.',
        website: 'https://mycompany.com/',
        addr: ['123 Main St', 'Suite 100', 'San Francisco CA 94102'],
        legalCounty: 'San Francisco',
        legalState: 'California',
      },
      site: {
        siteUrl: 'https://app.mycompany.com',
        www: 'mycompany.com',
        host: 'app.mycompany.com',
      },
      emails: {
        hello: 'hello@mycompany.com',
        support: 'support@mycompany.com',
        abuse: 'abuse@mycompany.com',
        privacy: 'privacy@mycompany.com',
        legal: 'legal@mycompany.com',
        copyright: 'copyright@mycompany.com',
        arbitrationOptOut: 'arbitration-opt-out@mycompany.com',
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

### Query Site Modules

```typescript
const result = await db.siteModule.findMany({
  select: {
    id: true,
    name: true,
    data: true,
  },
  where: {
    siteId: { equalTo: siteId },
  },
}).execute();

if (result.ok) {
  const modules = result.data.siteModules.nodes;
  modules.forEach(m => console.log(`${m.name}:`, m.data));
}
```

## Site Metadata

Site metadata stores additional configuration:

```typescript
const result = await db.siteMetadatum.create({
  data: {
    databaseId: databaseId,
    siteId: siteId,
    key: 'analytics',
    value: {
      googleAnalyticsId: 'G-XXXXXXXXXX',
      mixpanelToken: 'your-mixpanel-token',
    },
  },
  select: {
    id: true,
    key: true,
    value: true,
  },
}).execute();
```

## Querying Sites

### Find All Sites for a Database

```typescript
const result = await db.site.findMany({
  select: {
    id: true,
    title: true,
    description: true,
    logo: true,
    favicon: true,
  },
  where: {
    databaseId: { equalTo: databaseId },
  },
}).execute();

if (result.ok) {
  const sites = result.data.sites.nodes;
  sites.forEach(site => {
    console.log(`${site.title}: ${site.id}`);
  });
}
```

### Find Site with Relations

```typescript
const result = await db.site.findFirst({
  select: {
    id: true,
    title: true,
    description: true,
    siteThemes: {
      nodes: {
        id: true,
        theme: true,
      },
    },
    siteModules: {
      nodes: {
        id: true,
        name: true,
        data: true,
      },
    },
    apps: {
      nodes: {
        id: true,
        name: true,
        appImage: true,
      },
    },
    domains: {
      nodes: {
        id: true,
        subdomain: true,
        domain: true,
      },
    },
  },
  where: {
    databaseId: { equalTo: databaseId },
  },
}).execute();
```

## Apps

Apps are mobile/web applications associated with a site:

```typescript
const result = await db.app.create({
  data: {
    databaseId: databaseId,
    siteId: siteId,
    name: 'My Mobile App',
    appImage: {
      url: 'https://example.com/app-icon.png',
      mime: 'image/png',
    },
    appStoreLink: 'https://apps.apple.com/app/my-app/id123456789',
    appStoreId: '123456789',
    appIdPrefix: 'com.mycompany',
    playStoreLink: 'https://play.google.com/store/apps/details?id=com.mycompany.myapp',
  },
  select: {
    id: true,
    name: true,
    appStoreLink: true,
    playStoreLink: true,
  },
}).execute();
```

## Updating a Site

```typescript
const result = await db.site.update({
  where: { id: siteId },
  data: {
    title: 'Updated Title',
    description: 'Updated description for my app',
  },
  select: {
    id: true,
    title: true,
    description: true,
  },
}).execute();

if (result.ok) {
  console.log('Updated site:', result.data.updateSite.site);
}
```

## Deleting a Site

```typescript
const result = await db.site.delete({
  where: { id: siteId },
}).execute();

if (result.ok) {
  console.log('Deleted site:', result.data.deleteSite.site.id);
}
```

## JSON Dialect (Select JSON)

For environments where TypeScript isn't available:

```json
{
  "operation": "mutation",
  "model": "site",
  "action": "create",
  "data": {
    "databaseId": "uuid-here",
    "title": "My Application",
    "description": "A great app"
  },
  "select": {
    "id": true,
    "title": true
  }
}
```

## Image Types

The SDK uses typed image objects:

```typescript
interface Image {
  url: string;
  mime: string;
  width?: number;
  height?: number;
  alt?: string;
}
```

Example:

```typescript
const logo: Image = {
  url: 'https://example.com/logo.png',
  mime: 'image/png',
  width: 200,
  height: 50,
  alt: 'Company Logo',
};
```

## Error Handling

```typescript
const result = await db.site.create({
  data: {
    databaseId: databaseId,
    title: 'A'.repeat(150), // Too long!
    description: 'My app',
  },
  select: { id: true },
}).execute();

if (!result.ok) {
  result.errors.forEach(error => {
    console.error(`Error: ${error.message}`);
    // "new row for relation "sites" violates check constraint "max_title""
  });
}
```

## Best Practices

1. **Keep titles concise** - Max 120 characters
2. **Use proper image formats** - PNG for logos, JPEG for photos
3. **Set up legal terms** - Required for production apps
4. **Configure themes early** - Consistent branding from the start
5. **Use site metadata** - Store analytics and config separately

## References

- Related skill: `constructive-sdk-database` for database management
- Related skill: `constructive-sdk-api` for API management
- Related skill: `constructive-sdk-services` for services schema overview
- [constructive-db SDK](https://github.com/constructive-io/constructive-db/tree/main/sdk/constructive-sdk)
