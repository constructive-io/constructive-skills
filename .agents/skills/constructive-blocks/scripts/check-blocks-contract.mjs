#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, '..');
const snapshotPath = path.join(
  skillDirectory,
  'references',
  'install-roots.v1.json'
);

const PINNED = Object.freeze({
  repository: 'https://github.com/constructive-io/blocks',
  branch: 'feat/feature-packs-console-kit',
  commit: '4f2a789fde9a90c0c6ed5977896493bb4818fa77',
  publicationStatus: 'branch-only',
  registryNamespace: '@constructive',
  registryUrl: 'https://constructive-io.github.io/blocks/r/{name}.json',
  registryHomepage: 'https://constructive-io.github.io/blocks',
  registrySchema: 'https://ui.shadcn.com/schema/registry.json',
  shadcnVersion: '4.13.1',
  packageManager: 'pnpm@10.28.0',
  nodeEngine: '>=24.0.0',
  metaContractVersion: '2026-07',
  metaCoordinate: 'Query._meta',
  registryItemCount: 102
});

const ENDPOINT_KINDS = [
  'data',
  'auth',
  'admin',
  'billing',
  'storage',
  'notifications'
];

const CONSTRUCTIVE_API_NAMES = {
  data: 'api',
  auth: 'auth',
  admin: 'admin',
  billing: 'usage',
  storage: 'objects',
  notifications: 'notifications'
};

const PACK_IDS = [
  'data',
  'auth',
  'users',
  'organizations',
  'storage',
  'billing',
  'notifications'
];

const META_CONTRACT_REQUIREMENTS = {
  queryType: { typeName: 'Query', fields: ['_meta'] },
  metaSchema: { typeName: 'MetaSchema', fields: ['tables'] },
  metaTable: {
    typeName: 'MetaTable',
    fields: [
      'name', 'schemaName', 'query', 'fields', 'inflection', 'indexes',
      'constraints', 'foreignKeyConstraints', 'primaryKeyConstraints',
      'uniqueConstraints', 'relations', 'storage', 'search', 'i18n',
      'realtime', 'scope'
    ]
  },
  metaTableQuery: {
    typeName: 'MetaQuery',
    fields: ['all', 'one', 'create', 'update', 'delete']
  },
  metaField: {
    typeName: 'MetaField',
    fields: [
      'name', 'type', 'isNotNull', 'hasDefault', 'isPrimaryKey',
      'isForeignKey', 'description', 'enumValues'
    ]
  },
  metaEnum: { typeName: 'MetaEnum', fields: ['name', 'values'] },
  metaType: {
    typeName: 'MetaType',
    fields: [
      'pgType', 'gqlType', 'isArray', 'isNotNull', 'hasDefault', 'subtype',
      'encoding'
    ]
  },
  metaEncoding: {
    typeName: 'MetaScalarEncoding',
    fields: [
      'kind', 'elementType', 'dimensions', 'geometrySubtype', 'srid', 'dotPath'
    ]
  },
  metaIndex: {
    typeName: 'MetaIndex',
    fields: ['name', 'isUnique', 'isPrimary', 'columns', 'fields']
  },
  metaPrimaryKey: {
    typeName: 'MetaPrimaryKeyConstraint',
    fields: ['name', 'fields']
  },
  metaUnique: {
    typeName: 'MetaUniqueConstraint',
    fields: ['name', 'fields']
  },
  metaForeignKey: {
    typeName: 'MetaForeignKeyConstraint',
    fields: [
      'name', 'fields', 'referencedTable', 'referencedFields', 'refFields',
      'refTable'
    ]
  },
  metaRefTable: { typeName: 'MetaRefTable', fields: ['name'] },
  metaConstraints: {
    typeName: 'MetaConstraints',
    fields: ['primaryKey', 'unique', 'foreignKey']
  },
  metaInflection: {
    typeName: 'MetaInflection',
    fields: [
      'tableType', 'allRows', 'connection', 'edge', 'filterType',
      'orderByType', 'conditionType', 'patchType', 'createInputType',
      'createPayloadType', 'updatePayloadType', 'deletePayloadType'
    ]
  },
  metaRelations: {
    typeName: 'MetaRelations',
    fields: ['belongsTo', 'has', 'hasOne', 'hasMany', 'manyToMany']
  },
  metaBelongsTo: {
    typeName: 'MetaBelongsToRelation',
    fields: ['fieldName', 'isUnique', 'type', 'keys', 'references']
  },
  metaHas: {
    typeName: 'MetaHasRelation',
    fields: ['fieldName', 'isUnique', 'type', 'keys', 'referencedBy']
  },
  metaManyToMany: {
    typeName: 'MetaManyToManyRelation',
    fields: [
      'fieldName', 'type', 'junctionTable', 'junctionLeftConstraint',
      'junctionLeftKeyAttributes', 'junctionRightConstraint',
      'junctionRightKeyAttributes', 'leftKeyAttributes', 'rightKeyAttributes',
      'rightTable'
    ]
  },
  metaStorage: {
    typeName: 'MetaStorage',
    fields: ['isFilesTable', 'isBucketsTable']
  },
  metaSearch: {
    typeName: 'MetaSearch',
    fields: ['algorithms', 'columns', 'hasUnifiedSearch', 'config']
  },
  metaSearchColumn: {
    typeName: 'MetaSearchColumn',
    fields: ['name', 'algorithm']
  },
  metaSearchConfig: {
    typeName: 'MetaSearchConfig',
    fields: ['weights', 'boostRecent', 'boostRecencyField', 'boostRecencyDecay']
  },
  metaI18n: {
    typeName: 'MetaI18n',
    fields: ['translationTable', 'translatableFields']
  },
  metaI18nField: {
    typeName: 'MetaI18nField',
    fields: ['name', 'type']
  },
  metaRealtime: {
    typeName: 'MetaRealtime',
    fields: ['subscriptionFieldName']
  },
  metaScope: {
    typeName: 'MetaScope',
    fields: ['scope', 'tier', 'keyColumn', 'entityTable', 'source']
  }
};

const META_DOCUMENT_ATTESTATIONS = {
  metaQuery: {
    sourceConstant: 'META_QUERY_SOURCE',
    operationName: 'ConstructiveMeta',
    byteLength: 2885,
    sha256: '8b5b46f141f8303ffafac5fbb4f34103a363d8a0755d1fba16199bbf3b78f7ee'
  },
  contractIntrospection: {
    sourceConstant: 'META_CONTRACT_INTROSPECTION_SOURCE',
    operationName: 'ConstructiveMetaContract',
    byteLength: 1949,
    sha256: '5a0aaeec9659cb0e6b43154f0db3fea6459a313f80feb67e87f3d1680985496a'
  }
};

const PROFILE_IDS = [
  'auth-hardened',
  'b2b-storage',
  'full'
];

const BACKEND_PRESET_ROUTES = [
  {
    presetSlug: 'blank',
    backendProvisioning: 'empty',
    frontendPresetRoot: null,
    featurePacks: [],
    customComposition: {
      coreRoot: 'console-kit-core',
      moduleSelection: 'explicit-console-module-roots'
    }
  },
  {
    presetSlug: 'auth:hardened',
    backendProvisioning: 'featureful',
    frontendPresetRoot: 'preset-auth-hardened',
    featurePacks: ['data', 'auth', 'users'],
    customComposition: null
  },
  {
    presetSlug: 'b2b:storage',
    backendProvisioning: 'featureful',
    frontendPresetRoot: 'preset-b2b-storage',
    featurePacks: ['data', 'auth', 'users', 'organizations', 'storage'],
    customComposition: null
  },
  {
    presetSlug: 'full',
    backendProvisioning: 'featureful',
    frontendPresetRoot: 'preset-full',
    featurePacks: PACK_IDS,
    customComposition: null
  }
];

const BACKEND_PRESET_SOURCE = {
  repository: 'https://github.com/constructive-io/constructive-db',
  commit: '0b30917f77284d61b5c997c3aa15195c6018ea87',
  verification: 'portable-attestation-no-live-repository-required',
  authoritativeSources: [
    {
      path: 'packages/node-type-registry/src/generate.ts',
      sha256: '1f4ab27a84ac82bec2efea0fdf2b70e69a7fcc77a261c1a3128cf16c1c590837'
    },
    {
      path: 'packages/node-type-registry/src/module-presets/index.ts',
      sha256: 'b18205178f8c8ffa444ac7e7c29c95de5c4fe4b67f1c329e01947e9570fdbf5b'
    },
    {
      path: 'packages/node-type-registry/src/module-presets/auth-hardened.ts',
      sha256: '510c6338f8b1b7203cea79c66ff1d5b095bc8e6048e4411d2015ebae20351784'
    },
    {
      path: 'packages/node-type-registry/src/module-presets/b2b-storage.ts',
      sha256: 'd549a4adc358bf88c134b0d235eba6374f4cc9ba89c078d236a8a433b4df98cd'
    },
    {
      path: 'packages/node-type-registry/src/module-presets/full.ts',
      sha256: '3b7dac7542479a73e34162374bd0191c653621f2fdb67d99954c45b8ea30584c'
    },
    {
      path: 'packages/metaschema-generators/deploy/schemas/metaschema_generators/procedures/db_preset_seed_data.sql',
      sha256: 'b49f8c8cdf0c20b7b1e67ce0e70943f8ab04137e7dacfc1fcd46a3d7076013f5'
    }
  ]
};

const INSTALL_ROOT_NAMES = [
  'console-kit-nextjs',
  'preset-auth-hardened',
  'preset-b2b-storage',
  'preset-full',
  'console-kit-core',
  'console-module-data',
  'console-module-auth',
  'console-module-users',
  'console-module-organizations',
  'console-module-storage',
  'console-module-billing',
  'console-module-notifications',
  'feature-pack-data',
  'feature-pack-auth',
  'feature-pack-users',
  'feature-pack-organizations',
  'feature-pack-storage',
  'feature-pack-billing',
  'feature-pack-notifications'
];

const CANONICAL_SOURCE_PATHS = [
  'package.json',
  'apps/registry/package.json',
  'apps/registry/scripts/build.ts',
  'packages/ui/registry.json',
  'apps/blocks/registry.json',
  'scripts/inspect-console-kit.ts',
  'apps/blocks/src/feature-packs/catalog.ts',
  'apps/blocks/src/feature-packs/capabilities.ts',
  'apps/blocks/src/blocks/console-runtime/endpoints.ts',
  'apps/blocks/src/blocks/console-runtime/standalone-session.ts',
  'apps/blocks/src/blocks/console-kit/feature-module.ts',
  'apps/blocks/src/blocks/console-kit/store/console-kit-store.tsx',
  'apps/blocks/src/blocks/console-kit/constructive/constructive-capabilities.ts',
  'apps/blocks/src/blocks/console-kit/constructive/constructive-console-kit.tsx',
  'packages/data/package.json',
  'packages/data/src/meta-query.ts',
  'packages/data/src/schema-introspection-compatibility.ts',
  'packages/sheets/package.json',
  'packages/sheets/src/context/sheets-context.ts',
  'packages/sheets/src/context/sheets-execute.ts',
  'packages/sheets/src/auth/auth-execute.ts',
  'packages/sheets/src/auth/utils/token-store.ts',
  'packages/sheets/src/auth/hooks/use-login.ts',
  'packages/sheets/src/auth/hooks/use-register.ts',
  'packages/sheets/src/adapter/postgraphile-adapter.ts',
  'packages/ui/package.json',
  'packages/ui/src/components/sidebar.tsx',
  'packages/ui/src/components/app-bar.tsx',
  'packages/ui/src/components/app-shell.tsx',
  'packages/ui/src/index.ts',
  'packages/schema-builder/package.json',
  'apps/blocks/src/blocks/feature-packs/data/data-feature-pack.tsx',
  'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/auth/auth-feature-pack.tsx',
  'apps/blocks/src/blocks/feature-packs/auth/auth-contracts.ts',
  'apps/blocks/src/blocks/feature-packs/auth/auth-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/users/users-feature-pack.tsx',
  'apps/blocks/src/blocks/feature-packs/users/users-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/organizations/organizations-feature-pack.tsx',
  'apps/blocks/src/blocks/feature-packs/organizations/organizations-contracts.ts',
  'apps/blocks/src/blocks/feature-packs/organizations/organizations-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/organizations/organizations-meta-contract.ts',
  'apps/blocks/src/blocks/feature-packs/storage/storage-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/storage/storage-feature-pack.tsx',
  'apps/blocks/src/blocks/feature-packs/storage/storage-meta-contract.ts',
  'apps/blocks/src/blocks/feature-packs/billing/billing-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/billing/billing-feature-pack.tsx',
  'apps/blocks/src/blocks/billing/billing-settings-page/billing-settings-page.tsx',
  'apps/blocks/src/blocks/feature-packs/notifications/notifications-console-module.tsx',
  'apps/blocks/src/blocks/feature-packs/notifications/notifications-feature-pack.tsx',
  'apps/blocks/src/blocks/console-kit/constructive/constructive-graphql.ts',
  'apps/blocks/src/blocks/console-kit/constructive/auth-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/users-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/storage-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/billing-adapter.ts',
  'apps/blocks/src/blocks/console-kit/constructive/notifications-adapter.ts',
  'packages/sheets/src/context/sheets-provider.tsx',
  'packages/sheets/src/store/sheets-store.ts',
  'packages/sheets/src/hooks/use-sheets-meta.ts'
];

const ADAPTER_SOURCE_PATHS = {
  data: [
    'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
    'packages/sheets/src/context/sheets-context.ts',
    'packages/sheets/src/context/sheets-provider.tsx',
    'packages/sheets/src/context/sheets-execute.ts',
    'packages/sheets/src/hooks/use-sheets-meta.ts',
    'packages/sheets/src/adapter/postgraphile-adapter.ts'
  ],
  auth: [
    'apps/blocks/src/blocks/console-kit/constructive/auth-adapter.ts'
  ],
  users: [
    'apps/blocks/src/blocks/console-kit/constructive/users-adapter.ts'
  ],
  organizations: [
    'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts'
  ],
  storage: [
    'apps/blocks/src/blocks/console-kit/constructive/storage-adapter.ts'
  ],
  billing: [
    'apps/blocks/src/blocks/console-kit/constructive/billing-adapter.ts'
  ],
  notifications: [
    'apps/blocks/src/blocks/console-kit/constructive/notifications-adapter.ts'
  ]
};

const PACKAGE_RELEASES = [
  {
    name: '@constructive-io/ui',
    version: '0.5.0',
    manifestPath: 'packages/ui/package.json'
  },
  {
    name: '@constructive-io/data',
    version: '0.2.0',
    manifestPath: 'packages/data/package.json'
  },
  {
    name: '@constructive-io/sheets',
    version: '0.5.0',
    manifestPath: 'packages/sheets/package.json'
  },
  {
    name: '@constructive-io/schema-builder',
    version: '0.1.0',
    manifestPath: 'packages/schema-builder/package.json'
  }
];

const REQUIRED_BINDING_ENDPOINTS = {
  data: {
    'data.meta': [['data']],
    'data.introspection': [['data']]
  },
  auth: {
    'auth.credentials': [['auth']],
    'auth.sessions': [['auth']],
    'auth.password': [['auth']]
  },
  users: {
    'users.directory': [['auth']],
    'users.memberships': [['admin']]
  },
  organizations: {
    'organizations.memberships': [['admin'], ENDPOINT_KINDS]
  },
  storage: {
    'storage.buckets': [
      ['storage', 'admin', 'data'],
      ['storage', 'admin', 'data']
    ],
    'storage.files': [
      ['storage', 'admin', 'data'],
      ['storage', 'admin', 'data']
    ]
  },
  billing: {
    'billing.plans': [['billing']],
    'billing.subscriptions': [['billing']]
  },
  notifications: {
    'notifications.inbox': [['notifications']]
  }
};

const OPTIONAL_BINDING_ENDPOINTS = {
  data: {},
  auth: {
    'auth.email': [['auth']],
    'auth.connected-accounts': [['auth']]
  },
  users: {
    'users.permissions': [['admin']],
    'users.profiles': [['admin']],
    'users.invites': [['admin']]
  },
  organizations: {
    'organizations.permissions': [['admin']],
    'organizations.limits': [['billing']],
    'organizations.profiles': [['admin']],
    'organizations.hierarchy': [['admin']],
    'organizations.invites': [['admin']]
  },
  storage: {},
  billing: {
    'billing.meters': [['billing']]
  },
  notifications: {}
};

const PREREQUISITE_BINDING_ENDPOINTS = {
  organizations: {
    'organizations.identity-directory': [['auth'], ENDPOINT_KINDS]
  }
};

const ALTERNATIVE_PATH_GROUPS = {
  'organizations.identity-directory': [
    'auth-identity-path',
    'meta-identity-path'
  ],
  'organizations.memberships': [
    'admin-membership-path',
    'meta-membership-path'
  ]
};

const ADAPTER_CONTRACT_PROFILES = {
  'minimal-nodes-connection': {
    requiredConnectionFields: ['nodes']
  },
  'relay-forward-connection': {
    requiredRootArguments: [
      {
        name: 'first',
        allowedTypes: ['Int', 'Int!']
      },
      {
        name: 'after',
        allowedTypes: ['Cursor'],
        requiredNullability: 'nullable'
      }
    ],
    requiredConnectionFields: ['nodes', 'pageInfo'],
    requiredPageInfoFields: ['hasNextPage', 'endCursor']
  }
};

const ADAPTER_REQUIREMENTS = {
  auth: [
    {
      endpointKind: 'auth',
      coordinate: 'Mutation.signIn',
      shape: 'mutation-input-and-payload',
      requiredArguments: ['input'],
      inputType: 'SignInInput',
      requiredInputFields: ['email', 'password', 'rememberMe', 'credentialKind'],
      conditionalInputFields: ['csrfToken'],
      requiredPayloadPath: 'result',
      requiredPayloadFields: ['userId', 'accessToken'],
      selectedPayloadFields: [
        'id',
        'userId',
        'accessToken',
        'accessTokenExpiresAt',
        'mfaRequired',
        'mfaChallengeToken'
      ]
    },
    {
      endpointKind: 'auth',
      coordinate: 'Mutation.signUp',
      shape: 'mutation-input-and-payload',
      requiredArguments: ['input'],
      inputType: 'SignUpInput',
      requiredInputFields: ['email', 'password', 'rememberMe', 'credentialKind'],
      conditionalInputFields: ['csrfToken'],
      requiredPayloadPath: 'result',
      requiredPayloadFields: ['userId', 'accessToken'],
      selectedPayloadFields: [
        'id',
        'userId',
        'accessToken',
        'accessTokenExpiresAt'
      ]
    },
    {
      endpointKind: 'auth',
      coordinate: 'Mutation.signOut',
      shape: 'mutation-input-and-payload',
      requiredArguments: ['input'],
      inputType: 'SignOutInput',
      requiredInputFields: [],
      requiredPayloadPath: null,
      requiredPayloadFields: ['clientMutationId'],
      selectedPayloadFields: ['clientMutationId']
    },
    {
      endpointKind: 'auth',
      coordinate: 'Mutation.forgotPassword',
      shape: 'mutation-input-and-payload',
      requiredArguments: ['input'],
      inputType: 'ForgotPasswordInput',
      requiredInputFields: ['email'],
      requiredPayloadPath: null,
      requiredPayloadFields: ['clientMutationId'],
      selectedPayloadFields: ['clientMutationId']
    },
    {
      endpointKind: 'auth',
      coordinate: 'Mutation.resetPassword',
      shape: 'mutation-input-and-payload',
      requiredArguments: ['input'],
      inputType: 'ResetPasswordInput',
      requiredInputFields: ['roleId', 'resetToken', 'newPassword'],
      requiredPayloadPath: null,
      requiredPayloadFields: ['result'],
      selectedPayloadFields: ['result']
    },
    {
      endpointKind: 'auth',
      coordinate: 'Query.currentUser',
      shape: 'object',
      nodeType: 'User',
      requiredFields: [
        'id',
        'displayName',
        'username',
        'profilePicture',
        'createdAt'
      ],
      selectedFields: [
        'id',
        'displayName',
        'username',
        'profilePicture',
        'createdAt'
      ]
    }
  ],
  users: [
    {
      endpointKind: 'auth',
      coordinate: 'Query.users',
      shape: 'connection-nodes',
      nodeType: 'User',
      connectionProfile: 'relay-forward-connection',
      requiredFields: ['id'],
      selectedFields: ['id', 'displayName', 'username', 'profilePicture']
    },
    {
      endpointKind: 'admin',
      coordinate: 'Query.appMemberships',
      shape: 'connection-nodes',
      nodeType: 'AppMembership',
      connectionProfile: 'relay-forward-connection',
      requiredFields: ['id', 'actorId'],
      selectedFields: [
        'id',
        'actorId',
        'createdAt',
        'isOwner',
        'isAdmin',
        'isActive',
        'isApproved',
        'isVerified',
        'isBanned',
        'isDisabled',
        'permissions',
        'granted',
        'profileId'
      ]
    }
  ],
  organizations: [
    {
      id: 'identity-auth-users',
      endpointKind: 'auth',
      coordinate: 'Query.users',
      shape: 'connection-nodes',
      nodeType: 'User',
      connectionProfile: 'relay-forward-connection',
      requiredFields: ['id', 'type'],
      selectedFields: [
        'id',
        'type',
        'displayName',
        'username',
        'profilePicture'
      ]
    },
    {
      id: 'memberships-admin',
      endpointKind: 'admin',
      coordinate: 'Query.orgMemberships',
      shape: 'connection-nodes',
      nodeType: 'OrgMembership',
      connectionProfile: 'relay-forward-connection',
      requiredFields: ['id', 'actorId', 'entityId'],
      selectedFields: [
        'id',
        'actorId',
        'entityId',
        'createdAt',
        'isOwner',
        'isAdmin',
        'isActive',
        'isApproved',
        'isBanned',
        'isDisabled',
        'isReadOnly',
        'permissions',
        'granted',
        'profileId'
      ]
    },
    {
      id: 'meta-organizations',
      endpointKind: 'meta-contract-source',
      coordinate: 'Query.<organizations-root>',
      shape: 'connection-nodes',
      nodeType: 'meta-contract-organizations-table',
      connectionProfile: 'relay-forward-connection',
      requiredSemanticFields: ['id', 'name'],
      selectedSemanticFields: ['id', 'name', 'slug', 'avatar']
    },
    {
      id: 'memberships-meta-members',
      endpointKind: 'meta-contract-source',
      coordinate: 'Query.<members-root>',
      shape: 'connection-nodes',
      nodeType: 'meta-contract-members-table',
      connectionProfile: 'relay-forward-connection',
      requiredSemanticFields: ['id', 'organizationId'],
      selectedSemanticFields: [
        'id',
        'organizationId',
        'userId',
        'role',
        'status',
        'joinedAt',
        'invitedAt'
      ]
    }
  ],
  storage: [
    {
      endpointKind: 'storage-or-admin-or-data',
      coordinate: 'Query.<bucket-root>',
      shape: 'connection-nodes',
      nodeType: 'selected-bucket-family',
      connectionProfile: 'relay-forward-connection',
      requiredSemanticFields: ['id', 'key'],
      selectedSemanticFields: [
        'id',
        'key',
        'description',
        'type',
        'isPublic'
      ]
    },
    {
      endpointKind: 'storage-or-admin-or-data',
      coordinate: 'Query.<file-root>',
      shape: 'connection-nodes',
      nodeType: 'selected-file-family',
      connectionProfile: 'relay-forward-connection',
      optionalRootArguments: [
        {
          name: 'condition',
          type: 'selected-file-family-condition-input'
        }
      ],
      requiredSemanticFields: ['id', 'key', 'bucketId'],
      selectedSemanticFields: [
        'id',
        'key',
        'bucketId',
        'filename',
        'mimeType',
        'size',
        'path',
        'status',
        'createdAt',
        'updatedAt'
      ]
    }
  ],
  billing: [
    {
      endpointKind: 'billing',
      coordinate: 'Query.plans',
      shape: 'connection-nodes',
      nodeType: 'Plan',
      connectionProfile: 'minimal-nodes-connection',
      requiredFields: ['id', 'name'],
      selectedFields: ['id', 'name', 'description', 'isActive']
    },
    {
      endpointKind: 'billing',
      coordinate: 'Query.planSubscriptions',
      shape: 'connection-nodes',
      nodeType: 'PlanSubscription',
      connectionProfile: 'minimal-nodes-connection',
      requiredFields: ['id', 'entityId', 'planId'],
      selectedFields: [
        'id',
        'entityId',
        'entityType',
        'organizationId',
        'planId',
        'isActive',
        'startsAt',
        'endsAt'
      ]
    }
  ],
  notifications: [
    {
      endpointKind: 'notifications',
      coordinate: 'Query.notifications',
      shape: 'connection-nodes',
      nodeType: 'Notification',
      connectionProfile: 'minimal-nodes-connection',
      requiredFields: ['id', 'title', 'createdAt'],
      selectedFields: [
        'id',
        'title',
        'body',
        'category',
        'kind',
        'createdAt',
        'actionUrl',
        'actions'
      ]
    }
  ]
};

const ADAPTER_REQUIREMENT_POLICIES = {
  organizations: {
    membershipPath: {
      mode: 'one-complete-alternative',
      alternatives: [
        {
          id: 'admin-membership-path',
          requirementIds: ['memberships-admin']
        },
        {
          id: 'meta-membership-path',
          requirementIds: [
            'meta-organizations',
            'memberships-meta-members'
          ]
        }
      ]
    },
    identityDirectory: {
      mode: 'one-complete-alternative',
      alternatives: [
        {
          id: 'auth-identity-path',
          requirementIds: ['identity-auth-users']
        },
        {
          id: 'meta-identity-path',
          requirementIds: ['meta-organizations']
        }
      ]
    },
    readyWhen: 'one membership path and one identity-directory path pass'
  }
};

const ADAPTER_ACTION_PROFILES = {
  'users-enabled-actions': {
    source: {
      path: 'apps/blocks/src/blocks/console-kit/constructive/users-adapter.ts',
      sha256: '22e45cbf37b59d815ec408fd91bf44087e54c61f7f30e32e603e61a5862dedc2'
    },
    appliesWhen: 'action-policy-would-be-enabled',
    readinessImpact: 'action-only',
    endpointPolicy: 'per-document',
    requiredArgument: 'input',
    inputValidation: 'adapter-declared-required-fields',
    documentTupleFields: [
      'endpointKind',
      'coordinate',
      'inputType',
      'payloadPath',
      'requiredPayloadFields'
    ],
    documents: [
      ['admin', 'Mutation.updateAppMembership', 'UpdateAppMembershipInput', 'appMembership', ['id']],
      ['admin', 'Mutation.createAppOwnerGrant', 'CreateAppOwnerGrantInput', 'appOwnerGrant', ['id']],
      ['admin', 'Mutation.createAppAdminGrant', 'CreateAppAdminGrantInput', 'appAdminGrant', ['id']],
      ['admin', 'Mutation.createAppGrant', 'CreateAppGrantInput', 'appGrant', ['id']],
      ['admin', 'Mutation.createAppProfileGrant', 'CreateAppProfileGrantInput', 'appProfileGrant', ['id']],
      ['admin', 'Mutation.createAppProfileDefinitionGrant', 'CreateAppProfileDefinitionGrantInput', 'appProfileDefinitionGrant', ['id']],
      ['admin', 'Mutation.createAppPermissionDefaultGrant', 'CreateAppPermissionDefaultGrantInput', 'appPermissionDefaultGrant', ['id']],
      ['admin', 'Mutation.createAppProfile', 'CreateAppProfileInput', 'appProfile', ['id']],
      ['admin', 'Mutation.updateAppProfile', 'UpdateAppProfileInput', 'appProfile', ['id']],
      ['admin', 'Mutation.deleteAppProfile', 'DeleteAppProfileInput', 'appProfile', ['id']],
      ['admin', 'Mutation.createAppInvite', 'CreateAppInviteInput', 'appInvite', ['id']],
      ['admin', 'Mutation.updateAppInvite', 'UpdateAppInviteInput', 'appInvite', ['id']],
      ['admin', 'Mutation.deleteAppInvite', 'DeleteAppInviteInput', 'appInvite', ['id']]
    ]
  },
  'organizations-enabled-actions': {
    source: {
      path: 'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts',
      sha256: 'b93e78d928f38e396bb529ac4b582c73b36dc219e01aeb3735e66bcc26fbb179'
    },
    appliesWhen: 'action-policy-would-be-enabled',
    readinessImpact: 'action-only',
    endpointPolicy: 'per-document',
    requiredArgument: 'input',
    inputValidation: 'adapter-declared-required-fields',
    documentTupleFields: [
      'endpointKind',
      'coordinate',
      'inputType',
      'payloadPath',
      'requiredPayloadFields'
    ],
    documents: [
      ['admin', 'Mutation.updateOrgMembership', 'UpdateOrgMembershipInput', 'orgMembership', ['id']],
      ['admin', 'Mutation.deleteOrgMembership', 'DeleteOrgMembershipInput', 'orgMembership', ['id']],
      ['admin', 'Mutation.createOrgAdminGrant', 'CreateOrgAdminGrantInput', 'orgAdminGrant', ['id']],
      ['admin', 'Mutation.createOrgOwnerGrant', 'CreateOrgOwnerGrantInput', 'orgOwnerGrant', ['id']],
      ['admin', 'Mutation.createOrgGrant', 'CreateOrgGrantInput', 'orgGrant', ['id']],
      ['admin', 'Mutation.createOrgProfileGrant', 'CreateOrgProfileGrantInput', 'orgProfileGrant', ['id']],
      ['admin', 'Mutation.createOrgProfileDefinitionGrant', 'CreateOrgProfileDefinitionGrantInput', 'orgProfileDefinitionGrant', ['id']],
      ['admin', 'Mutation.createOrgProfile', 'CreateOrgProfileInput', 'orgProfile', ['id']],
      ['admin', 'Mutation.updateOrgProfile', 'UpdateOrgProfileInput', 'orgProfile', ['id']],
      ['admin', 'Mutation.deleteOrgProfile', 'DeleteOrgProfileInput', 'orgProfile', ['id']],
      ['admin', 'Mutation.createOrgMemberProfile', 'CreateOrgMemberProfileInput', 'orgMemberProfile', ['id']],
      ['admin', 'Mutation.updateOrgMemberProfile', 'UpdateOrgMemberProfileInput', 'orgMemberProfile', ['id']],
      ['admin', 'Mutation.updateOrgMembershipSetting', 'UpdateOrgMembershipSettingInput', 'orgMembershipSetting', ['id']],
      ['admin', 'Mutation.updateOrgMembershipDefault', 'UpdateOrgMembershipDefaultInput', 'orgMembershipDefault', ['id']],
      ['admin', 'Mutation.createOrgChartEdgeGrant', 'CreateOrgChartEdgeGrantInput', 'orgChartEdgeGrant', ['id']],
      ['admin', 'Mutation.createOrgInvite', 'CreateOrgInviteInput', 'orgInvite', ['id']],
      ['admin', 'Mutation.deleteOrgInvite', 'DeleteOrgInviteInput', 'orgInvite', ['id']],
      ['auth', 'Mutation.deleteUser', 'DeleteUserInput', 'user', ['id']],
      ['auth', 'Mutation.updateUser', 'UpdateUserInput', 'user', ['id']],
      ['auth', 'Mutation.revokeOrgApiKey', 'RevokeOrgApiKeyInput', null, ['result']],
      ['auth', 'Mutation.deleteOrgPrincipal', 'DeleteOrgPrincipalInput', null, ['result']],
      ['auth', 'Mutation.createOrgPrincipal', 'CreateOrgPrincipalInput', null, ['result']],
      ['auth', 'Mutation.createUser', 'CreateUserInput', 'user', ['id', 'type', 'username']]
    ]
  }
};

const ADAPTER_ACTION_PROFILE_IDS = {
  users: ['users-enabled-actions'],
  organizations: ['organizations-enabled-actions']
};

const SOURCE_LIMITATION_SCOPES = {
  'data-console-nested-sheets-store': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-data',
      'preset-auth-hardened',
      'preset-b2b-storage',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['data'],
    runtimeModes: ['console']
  },
  'data-standalone-auth-endpoint-fallback': {
    surfaces: ['standalone-feature-pack'],
    installRoots: ['feature-pack-data'],
    featurePacks: ['data'],
    runtimeModes: ['standalone-auth']
  },
  'data-standalone-database-scope-fallback': {
    surfaces: ['standalone-feature-pack'],
    installRoots: ['feature-pack-data'],
    featurePacks: ['data'],
    runtimeModes: ['standalone-auth']
  },
  'data-standalone-persistent-token-storage': {
    surfaces: ['standalone-feature-pack'],
    installRoots: ['feature-pack-data'],
    featurePacks: ['data'],
    runtimeModes: ['standalone-auth']
  },
  'data-standalone-csrf-auth-unavailable': {
    surfaces: ['standalone-feature-pack'],
    installRoots: ['feature-pack-data'],
    featurePacks: ['data'],
    runtimeModes: ['standalone-auth-csrf-required']
  },
  'organizations-meta-membership-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-organizations',
      'preset-b2b-storage',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['organizations'],
    runtimeModes: ['console-meta-discovery']
  },
  'storage-cross-endpoint-capability-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-storage',
      'preset-b2b-storage',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['storage'],
    runtimeModes: ['console-discovery']
  },
  'organizations-adapter-shape-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-organizations',
      'preset-b2b-storage',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['organizations'],
    runtimeModes: ['console-discovery']
  },
  'storage-adapter-shape-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-storage',
      'preset-b2b-storage',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['storage'],
    runtimeModes: ['console-discovery']
  },
  'auth-adapter-shape-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-auth',
      'preset-auth-hardened',
      'preset-b2b-storage',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['auth'],
    runtimeModes: ['console-discovery']
  },
  'users-adapter-shape-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-users',
      'preset-auth-hardened',
      'preset-b2b-storage',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['users'],
    runtimeModes: ['console-discovery']
  },
  'billing-adapter-shape-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-billing',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['billing'],
    runtimeModes: ['console-discovery']
  },
  'notifications-adapter-shape-false-ready': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-notifications',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['notifications'],
    runtimeModes: ['console-discovery']
  },
  'notifications-settings-discovered-unimplemented': {
    surfaces: ['console-module', 'preset', 'full-console'],
    installRoots: [
      'console-module-notifications',
      'preset-full',
      'console-kit-nextjs'
    ],
    featurePacks: ['notifications'],
    runtimeModes: ['console']
  }
};

const SOURCE_LIMITATION_PATHS = {
  'data-console-nested-sheets-store': [
    'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
    'apps/blocks/src/blocks/feature-packs/data/data-feature-pack.tsx',
    'packages/sheets/src/context/sheets-provider.tsx',
    'packages/sheets/src/store/sheets-store.ts'
  ],
  'data-standalone-auth-endpoint-fallback': [
    'packages/sheets/src/context/sheets-context.ts',
    'packages/sheets/src/auth/auth-execute.ts'
  ],
  'data-standalone-database-scope-fallback': [
    'packages/sheets/src/context/sheets-context.ts',
    'packages/sheets/src/context/sheets-provider.tsx',
    'packages/sheets/src/auth/hooks/use-login.ts',
    'packages/sheets/src/auth/hooks/use-register.ts'
  ],
  'data-standalone-persistent-token-storage': [
    'packages/sheets/src/context/sheets-provider.tsx',
    'packages/sheets/src/auth/utils/token-store.ts',
    'packages/sheets/src/auth/hooks/use-login.ts',
    'packages/sheets/src/auth/hooks/use-register.ts'
  ],
  'data-standalone-csrf-auth-unavailable': [
    'packages/sheets/src/context/sheets-context.ts',
    'packages/sheets/src/auth/auth-execute.ts'
  ],
  'organizations-meta-membership-false-ready': [
    'apps/blocks/src/blocks/feature-packs/organizations/organizations-meta-contract.ts',
    'apps/blocks/src/blocks/feature-packs/organizations/organizations-console-module.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts'
  ],
  'storage-cross-endpoint-capability-false-ready': [
    'apps/blocks/src/blocks/feature-packs/storage/storage-console-module.tsx',
    'apps/blocks/src/blocks/feature-packs/storage/storage-meta-contract.ts',
    'apps/blocks/src/blocks/console-kit/constructive/storage-adapter.ts'
  ],
  'organizations-adapter-shape-false-ready': [
    'apps/blocks/src/blocks/feature-packs/organizations/organizations-console-module.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts',
    'apps/blocks/src/blocks/console-kit/constructive/constructive-graphql.ts'
  ],
  'storage-adapter-shape-false-ready': [
    'apps/blocks/src/blocks/feature-packs/storage/storage-console-module.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/storage-adapter.ts',
    'apps/blocks/src/blocks/console-kit/constructive/constructive-graphql.ts'
  ],
  'auth-adapter-shape-false-ready': [
    'apps/blocks/src/blocks/feature-packs/auth/auth-console-module.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/auth-adapter.ts',
    'apps/blocks/src/blocks/console-runtime/standalone-session.ts'
  ],
  'users-adapter-shape-false-ready': [
    'apps/blocks/src/blocks/feature-packs/users/users-console-module.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/users-adapter.ts'
  ],
  'billing-adapter-shape-false-ready': [
    'apps/blocks/src/blocks/feature-packs/billing/billing-console-module.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/billing-adapter.ts'
  ],
  'notifications-adapter-shape-false-ready': [
    'apps/blocks/src/blocks/feature-packs/notifications/notifications-console-module.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/notifications-adapter.ts'
  ],
  'notifications-settings-discovered-unimplemented': [
    'apps/blocks/src/blocks/feature-packs/notifications/notifications-console-module.tsx',
    'apps/blocks/src/blocks/feature-packs/notifications/notifications-feature-pack.tsx',
    'apps/blocks/src/blocks/console-kit/constructive/notifications-adapter.ts'
  ]
};

const SOURCE_LIMITATION_POLICIES = {
  'data-console-nested-sheets-store': {
    acceptance: 'blocking',
    mitigationRequirements: [
      {
        id: 'unify-data-console-store',
        requirement: 'Unify Data state into the Console Kit modular Zustand store in Blocks source.'
      },
      {
        id: 'contribute-data-store-slice',
        requirement: 'Make dataConsoleModule contribute the resulting storeSlice and remove the nested Sheets store.'
      }
    ]
  },
  'data-standalone-auth-endpoint-fallback': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'require-explicit-auth-endpoint',
        requirement: 'When auth.mode is standalone, resolve an explicit non-empty authEndpoint.'
      },
      {
        id: 'fail-closed-without-auth-endpoint',
        requirement: 'Fail closed before rendering DataFeaturePack when authEndpoint is absent.'
      }
    ]
  },
  'data-standalone-database-scope-fallback': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'require-explicit-database-id',
        requirement: 'Resolve an explicit non-empty databaseId for standalone auth.'
      },
      {
        id: 'match-active-tenant-database-id',
        requirement: 'Require databaseId to equal the active tenant descriptor before rendering DataFeaturePack.'
      }
    ]
  },
  'data-standalone-persistent-token-storage': {
    acceptance: 'blocking',
    mitigationRequirements: [
      {
        id: 'use-host-owned-embedded-auth',
        requirement: 'Use embedded auth with a host-owned session and injected transport instead of Sheets standalone auth.'
      },
      {
        id: 'block-until-token-persistence-is-selectable',
        requirement: 'Keep standalone auth blocked until Blocks honors remember-me and supports non-persistent session storage.'
      }
    ]
  },
  'data-standalone-csrf-auth-unavailable': {
    acceptance: 'blocking',
    mitigationRequirements: [
      {
        id: 'use-host-auth-for-csrf-tenants',
        requirement: 'For a tenant requiring CSRF for auth, use embedded host auth and session transport.'
      },
      {
        id: 'block-until-sheets-csrf-bootstrap-exists',
        requirement: 'Keep Sheets standalone auth blocked until Blocks exposes anonymous CSRF bootstrap and request-header injection.'
      }
    ]
  },
  'organizations-meta-membership-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'require-meta-membership-root',
        requirement: 'Require contract.members with a readable membership query root for the metadata membership alternative.'
      },
      {
        id: 'prove-meta-membership-root-executable',
        requirement: 'Confirm the membership root through same-endpoint introspection and prove the operation executable.'
      },
      {
        id: 'prove-organization-identity-directory',
        requirement: 'Satisfy organizations.identity-directory through auth Query.users with id and type or a readable application organization _meta root.'
      }
    ]
  },
  'storage-cross-endpoint-capability-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'restrict-storage-endpoint-kind',
        requirement: 'Use only the storage, admin, or data endpoint kinds supported by the adapter.'
      },
      {
        id: 'prove-storage-pair-on-one-endpoint',
        requirement: 'Prove buckets and files together on the same endpoint through a paired GraphQL root variant or one compatible _meta family.'
      },
      {
        id: 'fail-storage-without-paired-evidence',
        requirement: 'Report Storage unavailable when same-endpoint paired evidence is absent.'
      }
    ]
  },
  'organizations-adapter-shape-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'validate-organizations-connection-shapes',
        requirement: 'Validate pagination arguments, connection fields, pageInfo fields, and adapter-selected node fields for every required Organizations root.'
      },
      {
        id: 'validate-meta-derived-organizations-shapes',
        requirement: 'Apply the same validation to _meta-derived organization and membership roots before reporting Organizations ready.'
      },
      {
        id: 'validate-organization-action-payloads',
        requirement: 'Before enabling an Organizations action, validate its per-document endpoint kind, adapter-declared input, fixed payload path, and required payload fields in organizations-enabled-actions.'
      }
    ]
  },
  'storage-adapter-shape-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'validate-storage-connection-shapes',
        requirement: 'Validate pagination arguments, connection fields, pageInfo fields, and semantic node fields for the selected bucket and file roots.'
      },
      {
        id: 'fail-storage-on-adapter-shape-mismatch',
        requirement: 'Report Storage unavailable when either selected family cannot execute the adapter document shape.'
      }
    ]
  },
  'auth-adapter-shape-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'validate-auth-operation-shapes',
        requirement: 'Validate every required Auth mutation input and payload field through standard introspection.'
      },
      {
        id: 'fail-auth-on-adapter-shape-mismatch',
        requirement: 'Report Auth unavailable when an operation name exists but its adapter-required shape does not.'
      }
    ]
  },
  'users-adapter-shape-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'validate-users-read-shapes',
        requirement: 'Validate the users and appMemberships connection node types and required fields through standard introspection.'
      },
      {
        id: 'fail-users-on-adapter-shape-mismatch',
        requirement: 'Report Users unavailable when a query root exists but its adapter-required shape does not.'
      },
      {
        id: 'validate-users-action-payloads',
        requirement: 'Before enabling a Users action, validate its per-document endpoint kind, adapter-declared input, fixed payload path, and required payload fields in users-enabled-actions.'
      }
    ]
  },
  'billing-adapter-shape-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'validate-billing-read-shapes',
        requirement: 'Validate the plans and planSubscriptions connection node types and required fields through standard introspection.'
      },
      {
        id: 'fail-billing-on-adapter-shape-mismatch',
        requirement: 'Report Billing unavailable when a query root exists but its adapter-required shape does not.'
      }
    ]
  },
  'notifications-adapter-shape-false-ready': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'validate-notifications-inbox-shape',
        requirement: 'Validate the notifications connection node type and required fields through standard introspection.'
      },
      {
        id: 'fail-notifications-on-adapter-shape-mismatch',
        requirement: 'Report Notifications unavailable when the query root exists but its adapter-required shape does not.'
      }
    ]
  },
  'notifications-settings-discovered-unimplemented': {
    acceptance: 'require-mitigation',
    mitigationRequirements: [
      {
        id: 'hide-unimplemented-notification-settings',
        requirement: 'Treat notifications.settings as unavailable in Console Kit even when Query.notificationPreferences is discovered.'
      },
      {
        id: 'require-notification-settings-resource-and-surface',
        requirement: 'Expose settings only after the Notifications adapter and feature-pack contract implement a settings resource and surface.'
      }
    ]
  }
};

const REGISTRY_QUERY_OVERRIDE_ITEMS = [
  {
    item: 'feature-pack-data',
    sourceValueSha256:
      'd72a2acee5ee58aa71cc2a413226936dbd18725d98678f371a756440b7eecbc5',
    requiredPortableText: [
      'adapter-driven Sheets view',
      'Query._meta',
      'authEndpoint',
      'embedded-auth',
      'standalone-auth'
    ]
  },
  {
    item: 'console-module-data',
    sourceValueSha256:
      '1601f1a98def8390d3dd92d28f2b0b6b67f4da9b9ca40ed5f8e0b94bdbf863b8',
    requiredPortableText: [
      'adapter-driven Data view',
      'Query._meta',
      'nested Sheets Zustand store',
      'storeSlice'
    ]
  }
];

const VERIFICATION_PROFILES = [
  {
    id: 'static-registry-install',
    appliesTo: {
      catalogItems: 'all-except-runtime-install-roots',
      excludedInstallRoots: INSTALL_ROOT_NAMES
    },
    requirements: [
      'Verify installed file bytes and declared registry dependency closure.',
      'Run the consumer typecheck and production build.',
      'Review visual and accessibility behavior when rendered UI changed.'
    ],
    mustNotRequire: [
      'tenant endpoint configuration',
      'Query._meta or GraphQL capability discovery',
      'Auth flow acceptance',
      'tenant CRUD or RLS acceptance'
    ]
  },
  {
    id: 'tenant-runtime',
    appliesTo: {
      installRoots: INSTALL_ROOT_NAMES,
      surfaces: [
        'standalone-feature-pack',
        'console-module',
        'preset',
        'core',
        'full-console'
      ]
    },
    requirements: [
      'Verify installed bytes, sidecars, typecheck, and production build.',
      'Verify host endpoint and session configuration when required by the selected packs.',
      'Verify _meta, introspection, and capability evidence when the selected surface performs discovery.',
      'Verify Auth flows when Auth is installed and tenant CRUD plus denied RLS cases when the selected packs expose data actions.'
    ],
    sourceLimitationPolicy: {
      blocking: 'fail acceptance while any applicable blocking limitation is open',
      requireMitigation: 'pass only after every applicable mitigation requirement has evidence'
    }
  }
];

const STANDALONE_DATA_VIEW_CONTRACT = {
  importTarget: 'src/blocks/feature-packs/data/data-feature-pack.tsx',
  propsType: 'DataFeaturePackProps',
  propVocabulary: [
    'config', 'activeTable', 'defaultActiveTable', 'applicationScopes',
    'includeTables', 'excludeTables', 'pageSize', 'onActiveTableChange',
    'onCreateTable', 'onEvent', 'sheetsProps'
  ],
  resourceProps: [],
  configProps: ['config'],
  viewState: {
    controlled: ['activeTable:onActiveTableChange'],
    defaults: ['defaultActiveTable'],
    required: ['config'],
    local: [
      'uncontrolled active table',
      'metadata request state',
      'Sheets grid and editor state'
    ]
  }
};

export const STANDALONE_PACK_SUMMARIES = {
  auth: {
    component: 'AuthFeaturePack',
    importTarget: 'src/blocks/feature-packs/auth/auth-feature-pack.tsx',
    propsType: 'AuthFeaturePackProps',
    componentSource: {
      path: 'apps/blocks/src/blocks/feature-packs/auth/auth-feature-pack.tsx',
      sha256: '0d5498ee937a72bad80488f162c4eb991bf15de4e1a6ac2842bdd5901941b4d2'
    },
    contractSource: {
      path: 'apps/blocks/src/blocks/feature-packs/auth/auth-contracts.ts',
      sha256: 'f8285d204946bc596a84ba323cebf33f649ade1a4b8a2af6365bc7c4bdaef527'
    },
    resourceProps: ['view', 'account'],
    policyType: 'FeatureActionPolicy<AuthFeatureAction>',
    actionsType: 'AuthFeatureActions',
    policyKeys: [
      'signIn', 'signUp', 'recoverPassword', 'resetPassword',
      'sendVerificationEmail', 'signOut', 'updateProfile',
      'changePassword', 'verifyPassword', 'requestAccountDeletion',
      'disconnectConnectedAccount', 'revokeSession'
    ],
    actionInputs: [
      ['signIn', '{ email; password; rememberMe? }'],
      ['signUp', '{ email; password; rememberMe? }'],
      ['recoverPassword', '{ email }'],
      ['resetPassword', '{ password }'],
      ['sendVerificationEmail', '{ email }'],
      ['signOut', null],
      ['updateProfile', '{ displayName }'],
      ['changePassword', '{ currentPassword; newPassword }'],
      ['verifyPassword', '{ password }'],
      ['requestAccountDeletion', '{ password }'],
      ['disconnectConnectedAccount', '{ accountId; password }'],
      ['revokeSession', '{ sessionId }']
    ],
    viewState: {
      controlled: ['mode:onModeChange', 'accountSection:onAccountSectionChange'],
      defaults: ['defaultAccountSection'],
      required: ['view'],
      local: ['form values', 'pending actions', 'transient errors']
    }
  },
  users: {
    component: 'UsersFeaturePack',
    importTarget: 'src/blocks/feature-packs/users/users-feature-pack.tsx',
    propsType: 'UsersFeaturePackProps',
    componentSource: {
      path: 'apps/blocks/src/blocks/feature-packs/users/users-feature-pack.tsx',
      sha256: '907b439865b2d65be794718227e84912df8a72b507d80773e02bb487da4c0b0b'
    },
    contractSource: {
      path: 'apps/blocks/src/blocks/feature-packs/users/users-feature-pack.tsx',
      sha256: '907b439865b2d65be794718227e84912df8a72b507d80773e02bb487da4c0b0b'
    },
    resourceProps: ['resource'],
    policyType: 'FeatureActionPolicy<UsersFeatureAction>',
    actionsType: 'UsersFeatureActions',
    policyKeys: [
      'invite', 'assignInviteProfile', 'setApproved', 'setVerified',
      'setBanned', 'setDisabled', 'setOwner', 'setAdmin', 'setProfile',
      'setDirectPermission', 'createProfile', 'updateProfile',
      'deleteProfile', 'setDefaultProfile', 'setProfilePermission',
      'setDefaultPermission', 'cancelInvite', 'extendInvite'
    ],
    actionInputs: [
      ['invite', '{ recipient; profileId? }'],
      ['setApproved', '{ membershipId; approved }'],
      ['setVerified', '{ membershipId; verified }'],
      ['setBanned', '{ membershipId; banned }'],
      ['setDisabled', '{ membershipId; disabled }'],
      ['setOwner', '{ userId; owner }'],
      ['setAdmin', '{ userId; admin }'],
      ['setProfile', '{ membershipId; profileId? }'],
      ['setDirectPermission', '{ userId; permissionId; granted }'],
      ['createProfile', '{ name; slug; description? }'],
      ['updateProfile', '{ profileId; name; slug; description? }'],
      ['deleteProfile', '{ profileId }'],
      ['setDefaultProfile', '{ profileId }'],
      ['setProfilePermission', '{ profileId; permissionId; granted }'],
      ['setDefaultPermission', '{ permissionId; granted }'],
      ['cancelInvite', '{ inviteId }'],
      ['extendInvite', '{ inviteId }']
    ],
    viewState: {
      controlled: ['section:onSectionChange'],
      defaults: ['defaultSection=members'],
      required: ['resource'],
      local: ['filters', 'dialogs', 'pending actions', 'transient errors']
    }
  },
  organizations: {
    component: 'OrganizationsFeaturePack',
    importTarget: 'src/blocks/feature-packs/organizations/organizations-feature-pack.tsx',
    propsType: 'OrganizationsFeaturePackProps',
    componentSource: {
      path: 'apps/blocks/src/blocks/feature-packs/organizations/organizations-feature-pack.tsx',
      sha256: '0eda91c1eaaf3350a7fa983c5dc9f59acdca696168e576b387e5d0f651e510d6'
    },
    contractSource: {
      path: 'apps/blocks/src/blocks/feature-packs/organizations/organizations-contracts.ts',
      sha256: 'c4d403ac826dff46178212cbeba06b1416cd4b8be42d56fe29ad684299c55c39'
    },
    resourceProps: ['resource'],
    policyType: 'FeatureActionPolicy<OrganizationsFeatureAction>',
    actionsType: 'OrganizationsFeatureActions',
    policyKeys: [
      'createOrganization', 'selectOrganization', 'updateOrganization',
      'deleteOrganization', 'leaveOrganization', 'inviteMember',
      'assignInviteProfile', 'cancelInvite', 'approveMember', 'banMember',
      'disableMember', 'markMemberExternal', 'markMemberReadOnly',
      'removeMember', 'grantAdmin', 'grantOwner', 'assignProfile',
      'grantPermission', 'updateMemberProfile', 'createAccessProfile',
      'updateAccessProfile', 'deleteAccessProfile', 'setProfilePermission',
      'updateMembershipSettings', 'updateMembershipDefault',
      'setHierarchyEdge', 'removeHierarchyEdge', 'createOrganizationApiKey',
      'createOrganizationPrincipal', 'revokeOrganizationApiKey',
      'revokeOrganizationPrincipal'
    ],
    actionInputs: [
      ['createOrganization', '{ name }'],
      ['selectOrganization', '{ organizationId }'],
      ['updateOrganization', '{ organizationId; name; slug? }'],
      ['deleteOrganization', '{ organizationId }'],
      ['leaveOrganization', '{ organizationId; membershipId }'],
      ['inviteMember', '{ organizationId; channel; recipient?; profileId?; expiresAt?; multiple?; inviteLimit?; isReadOnly? }'],
      ['cancelInvite', '{ organizationId; inviteId }'],
      ['updateMemberLifecycle', '{ organizationId; membershipId; patch }'],
      ['removeMember', '{ organizationId; membershipId }'],
      ['setMemberAdmin', '{ organizationId; actorId; isGrant }'],
      ['setMemberOwner', '{ organizationId; actorId; isGrant }'],
      ['setMemberProfile', '{ organizationId; membershipId; profileId; isGrant }'],
      ['setMemberPermission', '{ organizationId; actorId; permissions; isGrant }'],
      ['upsertMemberProfile', '{ organizationId; membershipId; profile }'],
      ['createAccessProfile', '{ organizationId; name; description? }'],
      ['updateAccessProfile', '{ organizationId; profileId; name; description? }'],
      ['deleteAccessProfile', '{ organizationId; profileId }'],
      ['setProfilePermission', '{ organizationId; profileId; permissionId; isGrant }'],
      ['updateMembershipSettings', '{ organizationId; settingsId; patch }'],
      ['updateMembershipDefault', '{ organizationId; defaultId; isApproved }'],
      ['setHierarchyEdge', '{ organizationId; childId; parentId; positionTitle?; positionLevel? }'],
      ['removeHierarchyEdge', '{ organizationId; edge }'],
      ['createOrganizationApiKey', '{ organizationId; principalId; name; accessLevel?; mfaLevel?; expiresIn? }'],
      ['createOrganizationPrincipal', '{ organizationId; name; useAdminOwner?; isReadOnly?; bypassStepUp? }'],
      ['revokeOrganizationApiKey', '{ organizationId; apiKeyId }'],
      ['revokeOrganizationPrincipal', '{ organizationId; principalId }']
    ],
    viewState: {
      controlled: [
        'section:onSectionChange',
        'createOrganizationOpen:onCreateOrganizationOpenChange'
      ],
      defaults: ['defaultSection=members'],
      required: ['resource'],
      local: ['filters', 'dialogs', 'pending actions', 'transient errors']
    }
  },
  storage: {
    component: 'StorageFeaturePack',
    importTarget: 'src/blocks/feature-packs/storage/storage-feature-pack.tsx',
    propsType: 'StorageFeaturePackProps',
    componentSource: {
      path: 'apps/blocks/src/blocks/feature-packs/storage/storage-feature-pack.tsx',
      sha256: 'aab932eeb2f12415858dd085f6298fd68de3aa853a5a2120118570a33e188f11'
    },
    contractSource: {
      path: 'apps/blocks/src/blocks/feature-packs/storage/storage-feature-pack.tsx',
      sha256: 'aab932eeb2f12415858dd085f6298fd68de3aa853a5a2120118570a33e188f11'
    },
    resourceProps: ['resource'],
    policyType: 'FeatureActionPolicy<StorageFeatureAction>',
    actionsType: 'StorageFeatureActions',
    policyKeys: ['selectBucket', 'navigate', 'createBucket', 'upload', 'download', 'deleteObject'],
    actionInputs: [
      ['selectBucket', '{ bucketKey }'],
      ['navigate', '{ bucketKey; path }'],
      ['createBucket', "{ name; access: 'public' | 'private' }"],
      ['upload', '{ bucketKey; path; files }'],
      ['download', '{ bucketKey; objectKey }'],
      ['deleteObject', '{ bucketKey; objectKey }']
    ],
    viewState: {
      controlled: [],
      defaults: [],
      required: ['resource'],
      local: ['dialogs', 'pending actions', 'transient errors']
    }
  },
  billing: {
    component: 'BillingFeaturePack',
    importTarget: 'src/blocks/feature-packs/billing/billing-feature-pack.tsx',
    propsType: 'BillingFeaturePackProps',
    componentSource: {
      path: 'apps/blocks/src/blocks/feature-packs/billing/billing-feature-pack.tsx',
      sha256: 'd9a68dedca37a2e3f04fbb57020bfd8379ea7c4ffde601cb503853ba6b8f5ccf'
    },
    contractSource: {
      path: 'apps/blocks/src/blocks/billing/billing-settings-page/billing-settings-page.tsx',
      sha256: '5397c2813be9629e500e0ffc0eae75ce2f061c772476e55b6811281feb50a89b'
    },
    resourceProps: ['account', 'resources', 'formatOptions'],
    policyType: null,
    actionsType: 'BillingSettingsActions',
    policyKeys: [],
    actionInputs: [
      ['onPricingIntervalChange', "BillingPricingTableProps['onIntervalChange']"],
      ['onSelectPlan', "BillingPricingTableProps['onSelectPlan']"],
      ['onContactSales', "BillingPricingTableProps['onContactSales']"],
      ['onManageSubscription', "BillingSubscriptionCardProps['onManageSubscription']"],
      ['onChangePlan', "BillingSubscriptionCardProps['onChangePlan']"],
      ['onResolvePayment', "BillingSubscriptionCardProps['onResolvePayment']"],
      ['onViewHistory', "BillingUsageOverviewProps['onViewHistory']"],
      ['onBuyCredits', "BillingUsageOverviewProps['onBuyCredits']"],
      ['onHistoryMeterChange', "BillingUsageHistoryProps['onMeterChange']"],
      ['onHistoryPeriodChange', "BillingUsageHistoryProps['onPeriodChange']"],
      ['onHistoryPageChange', "BillingUsageHistoryProps['onPageChange']"],
      ['onActivityMeterChange', "BillingActivityTableProps['onMeterChange']"],
      ['onActivityEntryTypeChange', "BillingActivityTableProps['onEntryTypeChange']"],
      ['onActivityPageChange', "BillingActivityTableProps['onPageChange']"]
    ],
    viewState: {
      controlled: ['section:onSectionChange', 'controls.*'],
      defaults: ['defaultSection', 'controls.*.default*'],
      required: ['account', 'resources', 'formatOptions'],
      local: ['pending actions', 'transient messages']
    }
  },
  notifications: {
    component: 'NotificationsFeaturePack',
    importTarget: 'src/blocks/feature-packs/notifications/notifications-feature-pack.tsx',
    propsType: 'NotificationsFeaturePackProps',
    componentSource: {
      path: 'apps/blocks/src/blocks/feature-packs/notifications/notifications-feature-pack.tsx',
      sha256: '95df17d39e8747f56fa6e396656aba91dd5ddb938b7a5f11368dd8c911d67800'
    },
    contractSource: {
      path: 'apps/blocks/src/blocks/feature-packs/notifications/notifications-feature-pack.tsx',
      sha256: '95df17d39e8747f56fa6e396656aba91dd5ddb938b7a5f11368dd8c911d67800'
    },
    resourceProps: ['resource'],
    policyType: 'FeatureActionPolicy<NotificationsFeatureAction>',
    actionsType: 'NotificationsFeatureActions',
    policyKeys: ['markRead', 'markAllRead', 'deleteNotification', 'openNotification'],
    actionInputs: [
      ['markRead', '{ notificationId }'],
      ['markAllRead', null],
      ['deleteNotification', '{ notificationId }'],
      ['openNotification', '{ notification }']
    ],
    viewState: {
      controlled: [],
      defaults: [],
      required: ['resource'],
      local: ['filter', 'dialogs', 'pending actions', 'transient errors']
    }
  }
};

export function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertObject(value, label) {
  assert(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    `${label} must be an object.`
  );
}

function assertString(value, label) {
  assert(
    typeof value === 'string' && value.length > 0,
    `${label} must be a non-empty string.`
  );
}

function assertNullableString(value, label) {
  assert(
    value === null || typeof value === 'string',
    `${label} must be a string or null.`
  );
}

function assertStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array.`);
  const seen = new Set();
  for (const entry of value) {
    assertString(entry, `${label} entry`);
    assert(!seen.has(entry), `${label} contains duplicate value ${entry}.`);
    seen.add(entry);
  }
}

function assertExact(actual, expected, label) {
  assert(
    isDeepStrictEqual(actual, expected),
    `${label} drifted from the pinned Blocks contract.`
  );
}

function assertSha256(value, label) {
  assert(
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value),
    `${label} must be a lowercase SHA-256 digest.`
  );
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (cause) {
    const details = cause instanceof Error ? cause.message : String(cause);
    fail(`Unable to read ${label}: ${details}`);
  }
}

function resolveInside(root, relativePath, label) {
  assertString(relativePath, label);
  assert(!path.isAbsolute(relativePath), `${label} must be relative.`);
  const resolved = path.resolve(root, relativePath);
  assert(
    resolved.startsWith(`${root}${path.sep}`),
    `${label} escapes its contract root.`
  );
  return resolved;
}

function assertAttestation(record, label) {
  assertObject(record, label);
  assertString(record.path, `${label}.path`);
  assertSha256(record.sha256, `${label}.sha256`);
}

function assertAttestedFile(root, record, label) {
  assertAttestation(record, label);
  const filePath = resolveInside(root, record.path, `${label}.path`);
  assert(existsSync(filePath), `${label} does not exist: ${filePath}`);
  const actual = sha256(readFileSync(filePath));
  assert(
    actual === record.sha256,
    `${label} SHA-256 drifted: expected ${record.sha256}, received ${actual}.`
  );
  return filePath;
}

function byId(entries, label) {
  const result = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    assertString(entry.id, `${label} id`);
    assert(!result.has(entry.id), `Duplicate ${label} id ${entry.id}.`);
    result.set(entry.id, entry);
  }
  return result;
}

function byName(entries, label) {
  const result = new Map();
  for (const entry of entries) {
    assertObject(entry, `${label} entry`);
    assertString(entry.name, `${label} name`);
    assert(!result.has(entry.name), `Duplicate ${label} name ${entry.name}.`);
    result.set(entry.name, entry);
  }
  return result;
}

function sourceMap(snapshot) {
  return new Map(
    snapshot.source.attestations.canonicalFiles.map((record) => [
      record.path,
      record
    ])
  );
}

function assertSourceLink(actual, expectedPath, sources, label) {
  assertAttestation(actual, label);
  assert(actual.path === expectedPath, `${label}.path drifted.`);
  assertExact(actual, sources.get(expectedPath), label);
}

function bindingEndpointProjection(bindings) {
  const result = {};
  for (const binding of bindings) {
    result[binding.capability] = binding.alternatives.map(
      (candidate) => candidate.endpointKinds
    );
  }
  return result;
}

function assertBindingSet(
  bindings,
  expected,
  endpointKinds,
  sources,
  label
) {
  assert(Array.isArray(bindings), `${label} must be an array.`);
  const seen = new Set();
  for (const binding of bindings) {
    assertObject(binding, `${label} entry`);
    assertString(binding.capability, `${label} capability`);
    assert(!seen.has(binding.capability), `${label} repeats ${binding.capability}.`);
    seen.add(binding.capability);
    assert(
      Array.isArray(binding.alternatives) && binding.alternatives.length > 0,
      `${label} ${binding.capability} needs evidence alternatives.`
    );
    for (
      let alternativeIndex = 0;
      alternativeIndex < binding.alternatives.length;
      alternativeIndex += 1
    ) {
      const alternative = binding.alternatives[alternativeIndex];
      assertObject(alternative, `${binding.capability} alternative`);
      assert(
        alternative.id ===
          `${binding.capability}.path-${alternativeIndex + 1}`,
        `${binding.capability} alternative id drifted.`
      );
      assert(
        alternative.verificationProfile === 'tenant-runtime',
        `${binding.capability} alternative verification profile drifted.`
      );
      const expectedPathGroup =
        ALTERNATIVE_PATH_GROUPS[binding.capability]?.[alternativeIndex] ?? null;
      assert(
        (alternative.adapterPathGroup ?? null) === expectedPathGroup,
        `${binding.capability} alternative path group drifted.`
      );
      assertStringArray(
        alternative.endpointKinds,
        `${binding.capability} endpointKinds`
      );
      for (const endpointKind of alternative.endpointKinds) {
        assert(
          endpointKinds.includes(endpointKind),
          `${binding.capability} references unknown endpoint ${endpointKind}.`
        );
      }
      assertObject(alternative.evidence, `${binding.capability} evidence`);
      assertString(
        alternative.evidence.type,
        `${binding.capability} evidence.type`
      );
      if (alternative.evidence.contractSource) {
        const contractPath = alternative.evidence.contractSource.path;
        assertSourceLink(
          alternative.evidence.contractSource,
          contractPath,
          sources,
          `${binding.capability} contractSource`
        );
      }
    }
  }
  assertExact(bindingEndpointProjection(bindings), expected, label);
}

function assertConsoleModuleBindings(snapshot, manifestById, sources) {
  assert(
    Array.isArray(snapshot.consoleModuleBindings),
    'consoleModuleBindings must be an array.'
  );
  assert(
    snapshot.consoleModuleBindings.length === PACK_IDS.length,
    'consoleModuleBindings must cover every feature pack.'
  );
  const bindingByPack = new Map();
  for (const binding of snapshot.consoleModuleBindings) {
    assertObject(binding, 'Console module binding');
    assertString(binding.featurePack, 'Console module featurePack');
    assert(
      !bindingByPack.has(binding.featurePack),
      `Duplicate Console module binding ${binding.featurePack}.`
    );
    let expectedReadyState = 'all-required-capabilities';
    if (
      binding.featurePack === 'organizations' &&
      ADAPTER_REQUIREMENTS[binding.featurePack]
    ) {
      expectedReadyState =
        'all-required-capabilities-adapter-requirements-and-prerequisites';
    } else if (binding.featurePack === 'organizations') {
      expectedReadyState = 'all-required-capabilities-and-prerequisites';
    } else if (ADAPTER_REQUIREMENTS[binding.featurePack]) {
      expectedReadyState =
        'all-required-capabilities-and-adapter-requirements';
    }
    assert(
      binding.readyState === expectedReadyState,
      `${binding.featurePack} readyState drifted.`
    );
    const sourcePath =
      `apps/blocks/src/blocks/feature-packs/${binding.featurePack}/${binding.featurePack}-console-module.tsx`;
    assertSourceLink(
      binding.source,
      sourcePath,
      sources,
      `${binding.featurePack} module source`
    );
    assert(Array.isArray(binding.adapterSources), `${binding.featurePack}.adapterSources must be an array.`);
    assert(
      binding.adapterSources.length === ADAPTER_SOURCE_PATHS[binding.featurePack].length,
      `${binding.featurePack}.adapterSources count drifted.`
    );
    for (let index = 0; index < binding.adapterSources.length; index += 1) {
      assertSourceLink(
        binding.adapterSources[index],
        ADAPTER_SOURCE_PATHS[binding.featurePack][index],
        sources,
        `${binding.featurePack} adapter source ${index}`
      );
    }
    assertExact(
      binding.adapterRequirements ?? [],
      ADAPTER_REQUIREMENTS[binding.featurePack] ?? [],
      `${binding.featurePack}.adapterRequirements`
    );
    assertExact(
      binding.adapterRequirementPolicy ?? null,
      ADAPTER_REQUIREMENT_POLICIES[binding.featurePack] ?? null,
      `${binding.featurePack}.adapterRequirementPolicy`
    );
    assertExact(
      binding.adapterActionProfileIds ?? [],
      ADAPTER_ACTION_PROFILE_IDS[binding.featurePack] ?? [],
      `${binding.featurePack}.adapterActionProfileIds`
    );
    for (const profileId of binding.adapterActionProfileIds ?? []) {
      assert(
        snapshot.adapterActionProfiles[profileId],
        `${binding.featurePack} references an unknown adapter action profile.`
      );
    }
    for (const requirement of binding.adapterRequirements ?? []) {
      if (!requirement.connectionProfile) continue;
      assert(
        snapshot.adapterContractProfiles[requirement.connectionProfile],
        `${binding.featurePack} references an unknown adapter contract profile.`
      );
    }
    assertBindingSet(
      binding.required,
      REQUIRED_BINDING_ENDPOINTS[binding.featurePack],
      snapshot.endpointKinds,
      sources,
      `${binding.featurePack} required bindings`
    );
    assertBindingSet(
      binding.optional,
      OPTIONAL_BINDING_ENDPOINTS[binding.featurePack],
      snapshot.endpointKinds,
      sources,
      `${binding.featurePack} optional bindings`
    );
    const expectedPrerequisites =
      PREREQUISITE_BINDING_ENDPOINTS[binding.featurePack] ?? {};
    assertBindingSet(
      binding.prerequisites ?? [],
      expectedPrerequisites,
      snapshot.endpointKinds,
      sources,
      `${binding.featurePack} prerequisite bindings`
    );
    assertStringArray(
      binding.unboundOptionalCapabilities,
      `${binding.featurePack}.unboundOptionalCapabilities`
    );
    const manifest = manifestById.get(binding.featurePack);
    assert(manifest, `Missing manifest for ${binding.featurePack}.`);
    assertExact(
      binding.required.map((entry) => entry.capability).sort(),
      manifest.capabilities.required.slice().sort(),
      `${binding.featurePack} required capability coverage`
    );
    const coveredOptional = binding.optional
      .map((entry) => entry.capability)
      .concat(binding.unboundOptionalCapabilities);
    assertExact(
      coveredOptional.sort(),
      manifest.capabilities.optional.slice().sort(),
      `${binding.featurePack} optional capability coverage`
    );
    bindingByPack.set(binding.featurePack, binding);
  }
  assertExact(
    Array.from(bindingByPack.keys()),
    PACK_IDS,
    'Console module binding order'
  );
}

function assertRelease(snapshot, sources) {
  assertObject(snapshot.release, 'release');
  assert(snapshot.release.status === PINNED.publicationStatus, 'release.status drifted.');
  assert(snapshot.release.publicRegistryReady === false, 'Public registry must remain branch-only.');
  assert(snapshot.release.packageManager === PINNED.packageManager, 'release.packageManager drifted.');
  assert(snapshot.release.nodeEngine === PINNED.nodeEngine, 'release.nodeEngine drifted.');
  assert(snapshot.release.shadcnVersion === PINNED.shadcnVersion, 'release.shadcnVersion drifted.');
  assert(Array.isArray(snapshot.release.packages), 'release.packages must be an array.');
  assert(snapshot.release.packages.length === PACKAGE_RELEASES.length, 'release.packages count drifted.');
  for (let index = 0; index < PACKAGE_RELEASES.length; index += 1) {
    const expected = PACKAGE_RELEASES[index];
    const actual = snapshot.release.packages[index];
    assertObject(actual, `release.packages[${index}]`);
    assert(actual.name === expected.name, `${expected.name} release name drifted.`);
    assert(actual.version === expected.version, `${expected.name} release version drifted.`);
    assert(
      actual.snapshotStatus === PINNED.publicationStatus,
      `${expected.name} snapshot status drifted.`
    );
    assertSourceLink(
      actual.manifestSource,
      expected.manifestPath,
      sources,
      `${expected.name} manifest source`
    );
  }

  assertObject(snapshot.release.localConsumption, 'release.localConsumption');
  assert(
    snapshot.release.localConsumption.mode === 'pinned-local-build',
    'Local consumption mode drifted.'
  );
  assert(
    snapshot.release.localConsumption.mutatesTrackedSource === false,
    'Local consumption must not mutate tracked Blocks source.'
  );
  assertExact(
    snapshot.release.localConsumption.generatedPaths,
    [
      '.artifacts/npm',
      'apps/registry/registry.json',
      'apps/registry/public/r',
      'apps/registry/registry',
      'packages/ui/dist',
      'packages/data/dist',
      'packages/sheets/dist',
      'packages/schema-builder/dist'
    ],
    'Local generated artifact paths'
  );
  assertExact(
    snapshot.release.localConsumption.bootstrapSequence,
    [
      'node <skills-repo>/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs --blocks-repo <blocks-repo> --source-preflight',
      'pnpm --dir <blocks-repo> install --frozen-lockfile',
      'pnpm --dir <blocks-repo> build:registry',
      'pnpm --dir <blocks-repo> pack:local',
      'node <skills-repo>/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs --blocks-repo <blocks-repo>'
    ],
    'Fresh-checkout bootstrap sequence'
  );
  const commands = JSON.stringify(snapshot.release.localConsumption);
  for (const required of [
    'pnpm --dir <blocks-repo> build:registry',
    'pnpm --dir <blocks-repo> pack:local',
    'pnpm --dir <blocks-repo> local:registry',
    'python3 -m http.server',
    'shadcn@4.13.1'
  ]) {
    assert(commands.includes(required), `Local consumption is missing ${required}.`);
  }
  assert(
    snapshot.release.localConsumption.consumerWorkspace ===
      'disposable-or-isolated-worktree',
    'Local consumption must require an isolated consumer.'
  );
  assert(
    snapshot.release.localConsumption.localLockfilePolicy.includes('never commit') &&
      snapshot.release.localConsumption.localLockfilePolicy.includes('localhost'),
    'Local lockfile policy must reject committing localhost resolutions.'
  );
  assert(
    snapshot.release.localConsumption.promotionRule.includes('public release') &&
      snapshot.release.localConsumption.promotionRule.includes('regenerate'),
    'Consumer promotion must wait for public release and regenerate its lockfile.'
  );
  assert(
    snapshot.release.localConsumption.localInstallCommandTemplate ===
      'pnpm --dir <blocks-repo>/apps/registry exec shadcn add @constructive/{name} --cwd <consumer-repo> --yes',
    'Local install command template drifted.'
  );
}

function assertMetaAndStandaloneContracts(snapshot, sources) {
  assertObject(snapshot.metaContract, 'metaContract');
  assert(snapshot.metaContract.version === PINNED.metaContractVersion, 'metaContract.version drifted.');
  assert(snapshot.metaContract.coordinate === PINNED.metaCoordinate, 'metaContract.coordinate drifted.');
  assertSourceLink(
    snapshot.metaContract.source,
    'packages/data/src/meta-query.ts',
    sources,
    'metaContract.source'
  );
  assertSourceLink(
    snapshot.metaContract.compatibilitySource,
    'packages/data/src/schema-introspection-compatibility.ts',
    sources,
    'metaContract.compatibilitySource'
  );
  assertSourceLink(
    snapshot.metaContract.sheetsAdapterSource,
    'packages/sheets/src/adapter/postgraphile-adapter.ts',
    sources,
    'metaContract.sheetsAdapterSource'
  );
  assertExact(
    snapshot.metaContract.requirements,
    META_CONTRACT_REQUIREMENTS,
    'metaContract.requirements'
  );
  assertExact(
    snapshot.metaContract.documents,
    META_DOCUMENT_ATTESTATIONS,
    'metaContract.documents'
  );
  assertExact(
    snapshot.metaContract.evidenceOrder,
    [
      'current _meta signature introspection',
      'Query._meta payload validation',
      'standard GraphQL introspection cross-check'
    ],
    'metaContract.evidenceOrder'
  );

  assertObject(snapshot.standaloneContracts, 'standaloneContracts');
  assertObject(snapshot.standaloneContracts.nonData, 'standaloneContracts.nonData');
  assertExact(
    snapshot.standaloneContracts.nonData.featurePacks,
    PACK_IDS.slice(1),
    'non-Data standalone pack coverage'
  );
  assert(
    snapshot.standaloneContracts.nonData.discovery === 'none',
    'Non-Data standalone packs must not perform discovery.'
  );
  assert(
    snapshot.standaloneContracts.nonData.endpointResolution === 'none',
    'Non-Data standalone packs must not resolve endpoints.'
  );
  assertExact(
    snapshot.standaloneContracts.nonData.packs,
    STANDALONE_PACK_SUMMARIES,
    'Non-Data standalone pack summaries'
  );
  for (const [packId, summary] of Object.entries(
    snapshot.standaloneContracts.nonData.packs
  )) {
    assertSourceLink(
      summary.componentSource,
      summary.componentSource.path,
      sources,
      `${packId} standalone component source`
    );
    assertSourceLink(
      summary.contractSource,
      summary.contractSource.path,
      sources,
      `${packId} standalone contract source`
    );
    assert(
      summary.policyKeys.length > 0 || packId === 'billing',
      `${packId} standalone policy vocabulary is missing.`
    );
    assert(
      summary.actionInputs.length > 0,
      `${packId} standalone action input vocabulary is missing.`
    );
  }

  const data = snapshot.standaloneContracts.data;
  assertObject(data, 'standaloneContracts.data');
  assert(data.featurePack === 'data', 'Standalone Data featurePack drifted.');
  assert(data.component === 'DataFeaturePack', 'Standalone Data component drifted.');
  assertExact(
    {
      importTarget: data.importTarget,
      propsType: data.propsType,
      propVocabulary: data.propVocabulary,
      resourceProps: data.resourceProps,
      configProps: data.configProps,
      viewState: data.viewState
    },
    STANDALONE_DATA_VIEW_CONTRACT,
    'Standalone Data view contract'
  );
  assert(data.discovery === 'internal-data-schema', 'Standalone Data discovery drifted.');
  assertObject(data.planFieldOverride, 'Standalone Data planFieldOverride');
  assert(
    data.planFieldOverride.plan ===
      'references/install-plans.v1/feature-pack-data.json' &&
      data.planFieldOverride.field === 'standaloneContract.discovery' &&
      data.planFieldOverride.status === 'superseded-for-data',
    'Standalone Data must explicitly supersede the inspector v1 generic discovery sentence.'
  );
  assert(data.configType === 'SheetsConfig', 'Standalone Data configType drifted.');
  assert(data.executeType === 'SheetsExecuteFn', 'Standalone Data executeType drifted.');
  assertExact(data.requiredConfigFields, ['endpoint', 'auth'], 'Standalone Data required config');
  assertObject(data.authEndpointPolicy, 'Standalone Data authEndpointPolicy');
  assert(
    data.authEndpointPolicy.standaloneMode === 'required-explicit' &&
      data.authEndpointPolicy.sourceType === 'optional-string' &&
      data.authEndpointPolicy.sourceFallback ===
        'config.authEndpoint || config.endpoint' &&
      data.authEndpointPolicy.portableBehavior ===
        'fail-closed-before-render',
    'Standalone Data authEndpoint policy drifted.'
  );
  assertSourceLink(
    data.authEndpointPolicy.source,
    'packages/sheets/src/auth/auth-execute.ts',
    sources,
    'Standalone Data auth endpoint source'
  );
  assertExact(
    data.internalEvidence,
    ['Query._meta', 'standard GraphQL introspection'],
    'Standalone Data internal evidence'
  );
  assert(
    data.hostOwns.includes('semantic endpoint selection') &&
      data.hostOwns.includes('authentication mode and session boundary'),
    'Standalone Data must leave endpoint and session resolution with the host.'
  );
  assertSourceLink(
    data.componentSource,
    'apps/blocks/src/blocks/feature-packs/data/data-feature-pack.tsx',
    sources,
    'Standalone Data component source'
  );
  assertSourceLink(
    data.configSource,
    'packages/sheets/src/context/sheets-context.ts',
    sources,
    'Standalone Data config source'
  );
  assertSourceLink(
    data.executeSource,
    'packages/sheets/src/context/sheets-execute.ts',
    sources,
    'Standalone Data execute source'
  );
  assertSourceLink(
    data.providerSource,
    'packages/sheets/src/context/sheets-provider.tsx',
    sources,
    'Standalone Data provider source'
  );
  assertSourceLink(
    data.metaHookSource,
    'packages/sheets/src/hooks/use-sheets-meta.ts',
    sources,
    'Standalone Data metadata hook source'
  );
}

function assertHostOwnedStore(snapshot, sources) {
  const store = snapshot.hostOwnedStore;
  assertObject(store, 'hostOwnedStore');
  assert(store.factory === 'createConsoleKitStore', 'Host store factory drifted.');
  assertExact(
    store.positionalSignature,
    [
      'initialRouteInput: ConsoleKitRoute | FeaturePackId',
      'initialContext: ConsoleKitContext | null = null',
      'sliceContributions: readonly ConsoleKitStoreSliceContribution[] = []'
    ],
    'Host store positional signature'
  );
  assert(store.moduleSliceProperty === 'storeSlice', 'Host store slice property drifted.');
  assert(store.coreComponent === 'ConstructiveConsoleKitCore', 'Host store Core component drifted.');
  assertSourceLink(
    store.source,
    'apps/blocks/src/blocks/console-kit/store/console-kit-store.tsx',
    sources,
    'Host store source'
  );
  assertSourceLink(
    store.moduleContractSource,
    'apps/blocks/src/blocks/console-kit/feature-module.ts',
    sources,
    'Host store module contract source'
  );
  assertSourceLink(
    store.coreSource,
    'apps/blocks/src/blocks/console-kit/constructive/constructive-console-kit.tsx',
    sources,
    'Host store Core source'
  );
  assert(
    store.targetInvariant ===
      'one host-owned vanilla Zustand store per Console Kit instance with every installed module slice',
    'Host store target invariant drifted.'
  );
  assertObject(store.planFieldOverride, 'hostOwnedStore.planFieldOverride');
  assert(
    store.planFieldOverride.appliesTo ===
      'all non-standalone install plans containing Data' &&
      store.planFieldOverride.field === 'runtimeContract.state' &&
      store.planFieldOverride.status ===
        'superseded-by-current-source-conformance',
    'Host store plan-field override drifted.'
  );
  assertObject(store.currentSourceConformance, 'hostOwnedStore.currentSourceConformance');
  assert(
    store.currentSourceConformance.status === 'nonconforming-when-data-installed',
    'Current Data store conformance must remain explicit.'
  );
  assert(
    store.currentSourceConformance.consoleCoreStoreCount === 1 &&
      store.currentSourceConformance.dataNestedStoreCount === 1,
    'Current Console/Data Zustand store counts drifted.'
  );
  assert(
    store.currentSourceConformance.dataModuleStoreSlice === false,
    'Data must remain recorded as lacking a Console module storeSlice.'
  );
  assertSourceLink(
    store.currentSourceConformance.dataModuleSource,
    'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
    sources,
    'Current Data module source'
  );
  assertSourceLink(
    store.currentSourceConformance.dataProviderSource,
    'packages/sheets/src/context/sheets-provider.tsx',
    sources,
    'Current Data provider source'
  );
  assertSourceLink(
    store.currentSourceConformance.dataStoreSource,
    'packages/sheets/src/store/sheets-store.ts',
    sources,
    'Current Data store source'
  );
  assertExact(
    store.sourceLimitationIds,
    ['data-console-nested-sheets-store'],
    'Host store source limitation links'
  );
}

function assertRegistryQueryOverrides(snapshot) {
  assert(
    Array.isArray(snapshot.registry.queryOverrides) &&
      snapshot.registry.queryOverrides.length ===
        REGISTRY_QUERY_OVERRIDE_ITEMS.length,
    'registry.queryOverrides must contain every Data documentation correction.'
  );
  for (let index = 0; index < REGISTRY_QUERY_OVERRIDE_ITEMS.length; index += 1) {
    const expected = REGISTRY_QUERY_OVERRIDE_ITEMS[index];
    const override = snapshot.registry.queryOverrides[index];
    assertObject(override, `${expected.item} registry query override`);
    assert(
      override.item === expected.item &&
        override.field === 'docs' &&
        override.status === 'superseded-by-portable-contract',
      `${expected.item} registry query override identity drifted.`
    );
    assert(
      override.sourceValueSha256 === expected.sourceValueSha256,
      `${expected.item} source registry documentation hash drifted.`
    );
    assertString(
      override.portableValue,
      `${expected.item} portable registry documentation`
    );
    for (const requiredText of expected.requiredPortableText) {
      assert(
        override.portableValue.includes(requiredText),
        `${expected.item} portable registry documentation is missing ${requiredText}.`
      );
    }
    assert(
      !/provider-neutral(?: data)? view/iu.test(override.portableValue) &&
        !/host owns Sheets state/iu.test(override.portableValue),
      `${expected.item} portable documentation retained known-wrong source prose.`
    );
  }
}

function assertSourceLimitations(snapshot, sources, itemByName) {
  assert(Array.isArray(snapshot.sourceLimitations), 'sourceLimitations must be an array.');
  const limitationById = byId(snapshot.sourceLimitations, 'Source limitation');
  assertExact(
    Array.from(limitationById.keys()),
    Object.keys(SOURCE_LIMITATION_SCOPES),
    'Source limitation order'
  );
  for (const [id, expectedScope] of Object.entries(SOURCE_LIMITATION_SCOPES)) {
    const limitation = limitationById.get(id);
    const expectedPolicy = SOURCE_LIMITATION_POLICIES[id];
    assert(limitation, `Missing source limitation ${id}.`);
    assert(
      limitation.status === 'open-pinned-source-gap',
      `${id}.status drifted.`
    );
    assertExact(limitation.appliesTo, expectedScope, `${id}.appliesTo`);
    assert(
      limitation.acceptance === expectedPolicy.acceptance,
      `${id}.acceptance drifted.`
    );
    assert(
      Array.isArray(limitation.mitigationRequirements),
      `${id}.mitigationRequirements must be an array.`
    );
    const mitigationIds = new Set();
    for (const mitigation of limitation.mitigationRequirements) {
      assertObject(mitigation, `${id} mitigation requirement`);
      assertString(mitigation.id, `${id} mitigation id`);
      assertString(mitigation.requirement, `${id} mitigation requirement text`);
      assert(
        !mitigationIds.has(mitigation.id),
        `${id} repeats mitigation id ${mitigation.id}.`
      );
      mitigationIds.add(mitigation.id);
    }
    assertExact(
      limitation.mitigationRequirements,
      expectedPolicy.mitigationRequirements,
      `${id}.mitigationRequirements`
    );
    assertString(limitation.observedBehavior, `${id}.observedBehavior`);
    assertString(limitation.portableRequirement, `${id}.portableRequirement`);
    assertString(limitation.failureState, `${id}.failureState`);
    assert(
      Array.isArray(limitation.sourceEvidence),
      `${id}.sourceEvidence must be an array.`
    );
    const expectedPaths = SOURCE_LIMITATION_PATHS[id];
    assert(
      limitation.sourceEvidence.length === expectedPaths.length,
      `${id}.sourceEvidence count drifted.`
    );
    for (let index = 0; index < expectedPaths.length; index += 1) {
      assertSourceLink(
        limitation.sourceEvidence[index],
        expectedPaths[index],
        sources,
        `${id} source ${index}`
      );
    }
    for (const rootName of limitation.appliesTo.installRoots) {
      const item = itemByName.get(rootName);
      assert(item, `${id} references unknown install root ${rootName}.`);
      assert(
        limitation.appliesTo.surfaces.includes(item.surface),
        `${id} does not include ${rootName}'s surface ${item.surface}.`
      );
      assert(
        limitation.appliesTo.featurePacks.some((packId) =>
          item.featurePacks.includes(packId)
        ),
        `${id} does not match ${rootName}'s feature packs.`
      );
    }
  }
  const nestedStore = limitationById.get('data-console-nested-sheets-store');
  assert(
    nestedStore.portableRequirement.includes('storeSlice') &&
      nestedStore.failureState === 'known-nonconforming',
    'Data nested-store limitation behavior drifted.'
  );
  const authFallback = limitationById.get(
    'data-standalone-auth-endpoint-fallback'
  );
  assert(
    authFallback.observedBehavior.includes('config.authEndpoint || config.endpoint') &&
      authFallback.portableRequirement.includes('explicit non-empty authEndpoint') &&
      authFallback.portableRequirement.includes('fail closed') &&
      authFallback.failureState === 'configuration-error-before-render',
    'Standalone Data auth-endpoint limitation behavior drifted.'
  );
  const databaseScope = limitationById.get(
    'data-standalone-database-scope-fallback'
  );
  assert(
    databaseScope.observedBehavior.includes("config.databaseId || 'default'") &&
      databaseScope.portableRequirement.includes('tenant descriptor') &&
      databaseScope.failureState === 'configuration-error-before-render',
    'Standalone Data database-scope limitation behavior drifted.'
  );
  const persistentToken = limitationById.get(
    'data-standalone-persistent-token-storage'
  );
  assert(
    persistentToken.observedBehavior.includes('window.localStorage') &&
      persistentToken.observedBehavior.includes('rememberMe') &&
      persistentToken.portableRequirement.includes('embedded') &&
      persistentToken.failureState === 'unsafe-persistent-credential-storage',
    'Standalone Data persistent-token limitation behavior drifted.'
  );
  const csrf = limitationById.get('data-standalone-csrf-auth-unavailable');
  assert(
    csrf.observedBehavior.includes('csrfTokenProvider') &&
      csrf.portableRequirement.includes('require_csrf_for_auth') &&
      csrf.failureState === 'unsupported-security-mode',
    'Standalone Data CSRF limitation behavior drifted.'
  );
  const organizations = limitationById.get(
    'organizations-meta-membership-false-ready'
  );
  assert(
    organizations.observedBehavior.includes('contract.members') &&
      organizations.portableRequirement.includes('contract.members') &&
      organizations.failureState === 'unavailable',
    'Organizations false-ready limitation behavior drifted.'
  );
  const storage = limitationById.get(
    'storage-cross-endpoint-capability-false-ready'
  );
  assert(
    storage.observedBehavior.includes('different endpoints') &&
      storage.portableRequirement.includes('storage, admin, or data') &&
      storage.portableRequirement.includes('same endpoint') &&
      storage.failureState === 'unavailable',
    'Storage false-ready limitation behavior drifted.'
  );
  assertExact(
    snapshot.standaloneContracts.data.sourceLimitationIds,
    [
      'data-standalone-auth-endpoint-fallback',
      'data-standalone-database-scope-fallback',
      'data-standalone-persistent-token-storage',
      'data-standalone-csrf-auth-unavailable'
    ],
    'Standalone Data source limitation links'
  );
  const dataBinding = snapshot.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'data'
  );
  assert(dataBinding, 'Data module binding is missing.');
  assertExact(
    dataBinding.sourceLimitationIds,
    ['data-console-nested-sheets-store'],
    'Data Console source limitation links'
  );
  const organizationsBinding = snapshot.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'organizations'
  );
  assert(organizationsBinding, 'Organizations module binding is missing.');
  assertExact(
    organizationsBinding.sourceLimitationIds,
    [
      'organizations-meta-membership-false-ready',
      'organizations-adapter-shape-false-ready'
    ],
    'Organizations source limitation links'
  );
  const organizationsPrerequisite = organizationsBinding.prerequisites[0];
  assert(
    organizationsPrerequisite.capability ===
      'organizations.identity-directory',
    'Organizations identity-directory prerequisite drifted.'
  );
  assertExact(
    organizationsPrerequisite.alternatives[0].evidence,
    {
      type: 'graphql-operation-fields',
      operation: 'query',
      coordinate: 'Query.users',
      requiredFields: ['id', 'type']
    },
    'Organizations auth identity prerequisite'
  );
  assert(
    organizationsPrerequisite.alternatives[1].evidence.type ===
      'compatible-meta-contract' &&
      organizationsPrerequisite.alternatives[1].evidence.requirements.includes(
        'readable application organization root'
      ),
    'Organizations application identity prerequisite drifted.'
  );
  const storageBinding = snapshot.consoleModuleBindings.find(
    (binding) => binding.featurePack === 'storage'
  );
  assert(storageBinding, 'Storage module binding is missing.');
  assertExact(
    storageBinding.sourceLimitationIds,
    [
      'storage-cross-endpoint-capability-false-ready',
      'storage-adapter-shape-false-ready'
    ],
    'Storage source limitation links'
  );
  const adapterLimitationIds = {
    auth: ['auth-adapter-shape-false-ready'],
    users: ['users-adapter-shape-false-ready'],
    billing: ['billing-adapter-shape-false-ready'],
    notifications: [
      'notifications-adapter-shape-false-ready',
      'notifications-settings-discovered-unimplemented'
    ]
  };
  for (const [packId, limitationIds] of Object.entries(adapterLimitationIds)) {
    const binding = snapshot.consoleModuleBindings.find(
      (candidate) => candidate.featurePack === packId
    );
    assert(binding, `${packId} module binding is missing.`);
    assertExact(
      binding.sourceLimitationIds,
      limitationIds,
      `${packId} adapter-shape source limitation links`
    );
    const limitationId = limitationIds[0];
    const limitation = limitationById.get(limitationId);
    assert(
      limitation.observedBehavior.includes('operation name') ||
        limitation.observedBehavior.includes('query root'),
      `${limitationId} observed behavior drifted.`
    );
    assert(
      limitation.portableRequirement.includes('standard introspection') &&
        limitation.failureState === 'unavailable',
      `${limitationId} portable behavior drifted.`
    );
  }
  const notificationsSettings = limitationById.get(
    'notifications-settings-discovered-unimplemented'
  );
  assert(
    notificationsSettings.observedBehavior.includes(
      'notifications.settings'
    ) &&
      notificationsSettings.portableRequirement.includes(
        'inbox and read-state only'
      ) &&
      notificationsSettings.failureState === 'unavailable',
    'Notifications settings limitation behavior drifted.'
  );
}

export function assertSnapshot(snapshot) {
  assertObject(snapshot, 'Snapshot');
  assert(snapshot.schemaVersion === 1, 'Snapshot schemaVersion must be 1.');
  assert(
    snapshot.kind === 'constructive.blocks-install-roots',
    'Snapshot kind must be constructive.blocks-install-roots.'
  );

  assertObject(snapshot.source, 'source');
  assert(snapshot.source.repository === PINNED.repository, 'source.repository drifted.');
  assert(snapshot.source.branch === PINNED.branch, 'source.branch drifted.');
  assert(snapshot.source.commit === PINNED.commit, 'source.commit drifted.');
  assertExact(
    snapshot.source.acceptedCheckoutStates,
    [
      'named-branch-at-pinned-commit',
      'detached-at-pinned-commit'
    ],
    'Accepted Blocks checkout states'
  );
  assert(
    snapshot.source.publicationStatus === PINNED.publicationStatus,
    'source.publicationStatus drifted.'
  );
  assert(
    snapshot.source.trackedWorktreeRequired === true,
    'source.trackedWorktreeRequired must be true.'
  );
  assertObject(snapshot.source.inspector, 'source.inspector');
  assert(snapshot.source.inspector.schemaVersion === 1, 'Inspector schemaVersion must be 1.');
  assert(
    snapshot.source.inspector.kind === 'constructive.console-kit-install-roots',
    'Inspector kind drifted.'
  );
  assert(snapshot.source.inspector.script === 'scripts/inspect-console-kit.ts', 'Inspector script drifted.');
  assert(snapshot.source.inspector.mode === 'pinned-prebuilt', 'Inspector mode must be pinned-prebuilt.');
  assert(
    snapshot.source.inspector.command ===
      'pnpm --dir <blocks-repo> --silent console-kit:inspect --no-build',
    'Inspector command must be CWD-safe and explicitly prebuilt.'
  );

  const attestations = snapshot.source.attestations;
  assertObject(attestations, 'source.attestations');
  assert(attestations.algorithm === 'sha256', 'Attestation algorithm must be sha256.');
  assertAttestation(attestations.aggregateRegistry, 'aggregateRegistry attestation');
  assert(
    attestations.aggregateRegistry.path === 'apps/registry/registry.json',
    'Aggregate registry path drifted.'
  );
  assertAttestation(attestations.registryCatalog, 'registryCatalog attestation');
  assert(
    attestations.registryCatalog.path === 'references/registry-catalog.v1.json',
    'Registry catalog path drifted.'
  );
  assert(Array.isArray(attestations.canonicalFiles), 'canonicalFiles must be an array.');
  const sources = sourceMap(snapshot);
  assert(
    sources.size === attestations.canonicalFiles.length,
    'canonicalFiles contains duplicate paths.'
  );
  assertExact(Array.from(sources.keys()), CANONICAL_SOURCE_PATHS, 'Canonical source path set');
  for (const record of attestations.canonicalFiles) {
    assertAttestation(record, `Canonical source ${record.path ?? 'unknown'}`);
  }
  assert(Array.isArray(attestations.installPlans), 'installPlans must be an array.');
  assert(
    attestations.installPlans.length === INSTALL_ROOT_NAMES.length,
    'Every Console install root needs one complete plan attestation.'
  );
  const planItems = new Set();
  for (const record of attestations.installPlans) {
    assertAttestation(record, `Install plan ${record.item ?? 'unknown'}`);
    assertString(record.item, 'Install plan item');
    assert(!planItems.has(record.item), `Duplicate install plan ${record.item}.`);
    assert(
      record.path === `references/install-plans.v1/${record.item}.json`,
      `${record.item} plan path drifted.`
    );
    planItems.add(record.item);
  }
  assertExact(Array.from(planItems).sort(), INSTALL_ROOT_NAMES.slice().sort(), 'Install plan item set');

  assertObject(snapshot.registry, 'registry');
  assert(snapshot.registry.namespace === PINNED.registryNamespace, 'registry.namespace drifted.');
  assert(snapshot.registry.urlTemplate === PINNED.registryUrl, 'registry.urlTemplate drifted.');
  assert(snapshot.registry.shadcnVersion === PINNED.shadcnVersion, 'registry.shadcnVersion drifted.');
  assert(
    snapshot.registry.shadcnVersionPolicy === 'exact',
    'registry.shadcnVersionPolicy must be exact.'
  );
  assert(
    !Object.hasOwn(snapshot.registry, 'minimumShadcnVersion'),
    'registry.minimumShadcnVersion is forbidden because newer CLI versions are not implied compatible.'
  );
  assertObject(snapshot.registry.catalog, 'registry.catalog');
  assert(snapshot.registry.catalog.path === attestations.registryCatalog.path, 'Registry catalog link drifted.');
  assert(snapshot.registry.catalog.itemCount === PINNED.registryItemCount, 'Registry item count drifted.');
  assertObject(snapshot.registry.componentsJson, 'registry.componentsJson');
  assertObject(snapshot.registry.componentsJson.registries, 'registry componentsJson.registries');
  assert(
    snapshot.registry.componentsJson.registries[PINNED.registryNamespace] === PINNED.registryUrl,
    'Canonical registry namespace mapping drifted.'
  );
  assertRegistryQueryOverrides(snapshot);

  assertExact(snapshot.endpointKinds, ENDPOINT_KINDS, 'Endpoint kind mapping');
  assertExact(snapshot.constructiveApiNames, CONSTRUCTIVE_API_NAMES, 'Constructive API mapping');

  assert(Array.isArray(snapshot.featurePackManifests), 'featurePackManifests must be an array.');
  const manifestById = byId(snapshot.featurePackManifests, 'Feature-pack manifest');
  assertExact(Array.from(manifestById.keys()), PACK_IDS, 'Feature-pack manifest order');
  for (const manifest of snapshot.featurePackManifests) {
    assert(manifest.schemaVersion === 1, `${manifest.id} schemaVersion must be 1.`);
    assertString(manifest.title, `${manifest.id}.title`);
    assertString(manifest.description, `${manifest.id}.description`);
    assertStringArray(manifest.dependencies, `${manifest.id}.dependencies`);
    assertObject(manifest.endpoints, `${manifest.id}.endpoints`);
    assertStringArray(manifest.endpoints.required, `${manifest.id}.endpoints.required`);
    assertStringArray(manifest.endpoints.optional, `${manifest.id}.endpoints.optional`);
    assertObject(manifest.capabilities, `${manifest.id}.capabilities`);
    assertStringArray(manifest.capabilities.required, `${manifest.id}.capabilities.required`);
    assertStringArray(manifest.capabilities.optional, `${manifest.id}.capabilities.optional`);
    assertObject(manifest.metadata, `${manifest.id}.metadata`);
    const declaredEndpoints = manifest.endpoints.required.concat(manifest.endpoints.optional);
    for (const endpoint of declaredEndpoints) {
      assert(ENDPOINT_KINDS.includes(endpoint), `${manifest.id} references unknown endpoint ${endpoint}.`);
    }
  }

  assert(Array.isArray(snapshot.presetProfiles), 'presetProfiles must be an array.');
  const profileById = byId(snapshot.presetProfiles, 'Preset profile');
  assertExact(Array.from(profileById.keys()), PROFILE_IDS, 'Preset profile order');
  for (const profile of snapshot.presetProfiles) {
    assert(profile.schemaVersion === 1, `${profile.id} schemaVersion must be 1.`);
    assertString(profile.presetSlug, `${profile.id}.presetSlug`);
    assert(profile.stability === 'stable', `${profile.id} must be stable.`);
    assertStringArray(profile.featurePacks, `${profile.id}.featurePacks`);
    for (const packId of profile.featurePacks) {
      assert(manifestById.has(packId), `${profile.id} references unknown pack ${packId}.`);
    }
  }

  assert(Array.isArray(snapshot.items), 'items must be an array.');
  const itemByName = byName(snapshot.items, 'Install root');
  assertExact(Array.from(itemByName.keys()), INSTALL_ROOT_NAMES, 'Install-root order');
  for (const item of snapshot.items) {
    assertString(item.surface, `${item.name}.surface`);
    assertString(item.title, `${item.name}.title`);
    assertString(item.description, `${item.name}.description`);
    assertStringArray(item.featurePacks, `${item.name}.featurePacks`);
    assertStringArray(item.presetProfiles, `${item.name}.presetProfiles`);
    const command =
      `pnpm dlx shadcn@${PINNED.shadcnVersion} add ${PINNED.registryNamespace}/${item.name}`;
    assert(item.installCommand === command, `${item.name} install command drifted.`);
  }
  for (const packId of PACK_IDS) {
    assert(itemByName.has(`feature-pack-${packId}`), `Missing feature-pack-${packId}.`);
    assert(itemByName.has(`console-module-${packId}`), `Missing console-module-${packId}.`);
  }
  for (const profileId of PROFILE_IDS) {
    assert(itemByName.has(`preset-${profileId}`), `Missing preset-${profileId}.`);
  }

  assert(
    Array.isArray(snapshot.backendPresetRouting),
    'backendPresetRouting must be an array.'
  );
  assertExact(
    snapshot.backendPresetSource,
    BACKEND_PRESET_SOURCE,
    'Backend preset source attestation'
  );
  assertExact(
    snapshot.backendPresetRouting,
    BACKEND_PRESET_ROUTES,
    'Backend preset routing table'
  );
  const routedPresetSlugs = new Set();
  for (const route of snapshot.backendPresetRouting) {
    assert(
      !routedPresetSlugs.has(route.presetSlug),
      `Duplicate backend preset route ${route.presetSlug}.`
    );
    routedPresetSlugs.add(route.presetSlug);
    if (route.frontendPresetRoot === null) {
      assert(
        route.presetSlug === 'blank' && route.featurePacks.length === 0,
        'Only blank may be a backend-only empty preset route.'
      );
      assert(
        itemByName.has(route.customComposition.coreRoot),
        'Blank custom composition references a missing Console core root.'
      );
      continue;
    }
    const item = itemByName.get(route.frontendPresetRoot);
    const profile = snapshot.presetProfiles.find(
      (candidate) => candidate.presetSlug === route.presetSlug
    );
    assert(item, `${route.presetSlug} references a missing frontend preset root.`);
    assert(profile, `${route.presetSlug} references a missing featureful profile.`);
    assertExact(
      route.featurePacks,
      profile.featurePacks,
      `${route.presetSlug} routed feature packs`
    );
    assertExact(
      route.featurePacks,
      item.featurePacks,
      `${route.presetSlug} frontend-root feature packs`
    );
  }
  assertExact(
    Array.from(routedPresetSlugs),
    ['blank', 'auth:hardened', 'b2b:storage', 'full'],
    'Backend preset routing completeness'
  );

  assertRelease(snapshot, sources);
  assertExact(
    snapshot.adapterContractProfiles,
    ADAPTER_CONTRACT_PROFILES,
    'Adapter contract profiles'
  );
  assertExact(
    snapshot.adapterActionProfiles,
    ADAPTER_ACTION_PROFILES,
    'Adapter action profiles'
  );
  for (const [profileId, profile] of Object.entries(
    snapshot.adapterActionProfiles
  )) {
    assertSourceLink(
      profile.source,
      profile.source.path,
      sources,
      `${profileId} action profile source`
    );
    assert(
      profile.documents.length > 0,
      `${profileId} must contain action documents.`
    );
    for (const document of profile.documents) {
      assert(
        Array.isArray(document) &&
          document.length === profile.documentTupleFields.length,
        `${profileId} action document tuple drifted.`
      );
      assert(
        ENDPOINT_KINDS.includes(document[0]),
        `${profileId} action document endpoint drifted.`
      );
      assert(
        /^Mutation\.[A-Za-z_][A-Za-z0-9_]*$/u.test(document[1]),
        `${profileId} action document coordinate drifted.`
      );
      assertString(document[2], `${profileId} action document input type`);
      assert(
        document[3] === null || typeof document[3] === 'string',
        `${profileId} action document payload path drifted.`
      );
      assertStringArray(
        document[4],
        `${profileId} action document required payload fields`
      );
    }
  }
  assertMetaAndStandaloneContracts(snapshot, sources);
  assertConsoleModuleBindings(snapshot, manifestById, sources);
  assertHostOwnedStore(snapshot, sources);
  assertSourceLimitations(snapshot, sources, itemByName);
  assertExact(
    snapshot.verificationProfiles,
    VERIFICATION_PROFILES,
    'Verification profiles'
  );

  assertObject(snapshot.runtimeContract, 'runtimeContract');
  assert(snapshot.runtimeContract.appliesTo === 'console-kit', 'runtimeContract must apply to Console Kit.');
  assertExact(
    snapshot.runtimeContract.tenantDescriptor.endpointKinds,
    ENDPOINT_KINDS,
    'Runtime endpoint kinds'
  );
  assert(
    snapshot.runtimeContract.state.factory === 'createConsoleKitStore',
    'Runtime store factory drifted.'
  );

  return {
    itemByName,
    manifestById,
    profileById,
    sources
  };
}

export function projectRegistryCatalog(registry) {
  assertObject(registry, 'Aggregate registry');
  assert(Array.isArray(registry.items), 'Aggregate registry items must be an array.');
  const items = registry.items.map((item) => {
    const files = (item.files ?? []).map((file) => ({
      path: file.path,
      type: file.type,
      target: file.target ?? null
    }));
    return {
      name: item.name,
      type: item.type,
      title: item.title,
      description: item.description,
      categories: item.categories ?? [],
      docs: item.docs ?? null,
      dependencies: item.dependencies ?? [],
      devDependencies: item.devDependencies ?? [],
      registryDependencies: item.registryDependencies ?? [],
      files,
      installCommand:
        `pnpm dlx shadcn@${PINNED.shadcnVersion} add ${PINNED.registryNamespace}/${item.name}`
    };
  });
  return {
    schemaVersion: 1,
    kind: 'constructive.blocks-registry-catalog',
    sourceCommit: PINNED.commit,
    aggregatePath: 'apps/registry/registry.json',
    registryNamespace: PINNED.registryNamespace,
    itemCount: items.length,
    items
  };
}

export function assertRegistryCatalog(catalog, snapshot) {
  assertObject(catalog, 'Registry catalog');
  assert(catalog.schemaVersion === 1, 'Registry catalog schemaVersion must be 1.');
  assert(
    catalog.kind === 'constructive.blocks-registry-catalog',
    'Registry catalog kind drifted.'
  );
  assert(catalog.sourceCommit === PINNED.commit, 'Registry catalog sourceCommit drifted.');
  assert(catalog.aggregatePath === 'apps/registry/registry.json', 'Registry catalog aggregatePath drifted.');
  assert(catalog.registryNamespace === PINNED.registryNamespace, 'Registry catalog namespace drifted.');
  assert(catalog.itemCount === PINNED.registryItemCount, 'Registry catalog itemCount drifted.');
  assert(Array.isArray(catalog.items), 'Registry catalog items must be an array.');
  assert(catalog.items.length === catalog.itemCount, 'Registry catalog item count is inconsistent.');
  const itemByName = byName(catalog.items, 'Registry catalog item');
  for (const item of catalog.items) {
    assertString(item.type, `${item.name}.type`);
    assertString(item.title, `${item.name}.title`);
    assertString(item.description, `${item.name}.description`);
    assertStringArray(item.categories, `${item.name}.categories`);
    assertNullableString(item.docs, `${item.name}.docs`);
    assertStringArray(item.dependencies, `${item.name}.dependencies`);
    assertStringArray(item.devDependencies, `${item.name}.devDependencies`);
    assertStringArray(item.registryDependencies, `${item.name}.registryDependencies`);
    assert(Array.isArray(item.files), `${item.name}.files must be an array.`);
    for (const file of item.files) {
      assertObject(file, `${item.name} file`);
      assertString(file.path, `${item.name} file.path`);
      assertString(file.type, `${item.name} file.type`);
      assertNullableString(file.target, `${item.name} file.target`);
    }
    const command =
      `pnpm dlx shadcn@${PINNED.shadcnVersion} add ${PINNED.registryNamespace}/${item.name}`;
    assert(item.installCommand === command, `${item.name} catalog install command drifted.`);
    for (const dependency of item.registryDependencies) {
      if (!dependency.startsWith(`${PINNED.registryNamespace}/`)) continue;
      const dependencyName = dependency.slice(PINNED.registryNamespace.length + 1);
      assert(itemByName.has(dependencyName), `${item.name} references unknown registry item ${dependency}.`);
    }
  }
  for (const name of [
    'constructive-theme',
    'button',
    'sidebar',
    'app-bar',
    'app-shell',
    'billing-settings-page'
  ].concat(INSTALL_ROOT_NAMES)) {
    assert(itemByName.has(name), `Registry catalog is missing ${name}.`);
  }
  for (const override of snapshot.registry.queryOverrides) {
    const sourceItem = itemByName.get(override.item);
    assert(sourceItem, `Registry catalog is missing ${override.item}.`);
    assert(
      sha256(Buffer.from(sourceItem.docs, 'utf8')) ===
        override.sourceValueSha256,
      `Raw ${override.item} documentation no longer matches its explicit query override.`
    );
    assert(
      /provider-neutral(?: data)? view/iu.test(sourceItem.docs),
      `${override.item} query override must be removed or updated when upstream prose is corrected.`
    );
  }
  for (const item of snapshot.items) {
    const catalogItem = itemByName.get(item.name);
    assert(catalogItem, `Registry catalog is missing Console root ${item.name}.`);
    assert(catalogItem.installCommand === item.installCommand, `${item.name} command differs between contracts.`);
  }
  return itemByName;
}

function assertPlan(plan, item, snapshot) {
  assertObject(plan, `${item.name} plan`);
  assert(plan.schemaVersion === 1, `${item.name} plan schemaVersion drifted.`);
  assert(
    plan.kind === 'constructive.console-kit-install-plan',
    `${item.name} plan kind drifted.`
  );
  assert(plan.item === item.name, `${item.name} plan item drifted.`);
  assert(plan.surface === item.surface, `${item.name} plan surface drifted.`);
  assertObject(plan.install, `${item.name}.install`);
  assert(plan.install.command === item.installCommand, `${item.name} plan command drifted.`);
  assertExact(
    plan.install.componentsJson,
    snapshot.registry.componentsJson,
    `${item.name} components.json mapping`
  );
  assertObject(plan.composition, `${item.name}.composition`);
  assert(Array.isArray(plan.composition.registryItems), `${item.name} registryItems must be an array.`);
  for (const [dependencyKind, dependencies] of [
    ['npmDependencies', plan.composition.npmDependencies],
    ['devDependencies', plan.composition.devDependencies]
  ]) {
    assert(Array.isArray(dependencies), `${item.name} ${dependencyKind} must be an array.`);
    const dependencyNames = new Set();
    for (const dependency of dependencies) {
      assertObject(dependency, `${item.name} ${dependencyKind} entry`);
      assertString(dependency.name, `${item.name} ${dependencyKind} name`);
      assert(
        !dependencyNames.has(dependency.name),
        `${item.name} ${dependencyKind} repeats ${dependency.name}.`
      );
      dependencyNames.add(dependency.name);
      assertStringArray(
        dependency.requiredBy,
        `${item.name} ${dependencyKind} ${dependency.name}.requiredBy`
      );
    }
  }
  assert(Array.isArray(plan.composition.files), `${item.name} files must be an array.`);
  assert(Array.isArray(plan.featurePacks), `${item.name} featurePacks must be an array.`);
  assert(Array.isArray(plan.presetProfiles), `${item.name} presetProfiles must be an array.`);
  assertString(plan.registryDocumentation, `${item.name} registryDocumentation`);
  assertObject(plan.verify, `${item.name}.verify`);
  assertString(plan.verify.runFrom, `${item.name}.verify.runFrom`);
  assertStringArray(plan.verify.commands, `${item.name}.verify.commands`);
  assertStringArray(plan.verify.manualChecks, `${item.name}.verify.manualChecks`);
  assertExact(plan.featurePacks, item.featurePacks.map(
    (id) => snapshot.featurePackManifests.find((manifest) => manifest.id === id)
  ), `${item.name} feature-pack plan`);
  assertExact(plan.presetProfiles, item.presetProfiles.map(
    (id) => snapshot.presetProfiles.find((profile) => profile.id === id)
  ), `${item.name} preset plan`);
  const fileTargets = new Set(plan.composition.files.map((file) => file.target));
  for (const packId of item.featurePacks) {
    assert(
      fileTargets.has(`~/.constructive/feature-packs/${packId}.json`),
      `${item.name} is missing the ${packId} feature-pack sidecar.`
    );
  }
  for (const profileId of item.presetProfiles) {
    assert(
      fileTargets.has(`~/.constructive/feature-packs/${profileId}.json`),
      `${item.name} is missing the ${profileId} preset sidecar.`
    );
  }
  const standalone = item.surface === 'standalone-feature-pack';
  assert(
    standalone ? plan.standaloneContract !== null : plan.standaloneContract === null,
    `${item.name} standalone contract shape drifted.`
  );
  assert(
    standalone
      ? plan.runtimeContract === null
      : isDeepStrictEqual(plan.runtimeContract, snapshot.runtimeContract),
    `${item.name} runtime contract drifted.`
  );
}

export function validateSkillArtifacts(snapshot, root = skillDirectory) {
  const catalogPath = assertAttestedFile(
    root,
    snapshot.source.attestations.registryCatalog,
    'Pinned registry catalog'
  );
  const catalog = readJson(catalogPath, 'pinned registry catalog');
  assertRegistryCatalog(catalog, snapshot);

  const planByItem = new Map();
  for (const record of snapshot.source.attestations.installPlans) {
    const filePath = assertAttestedFile(root, record, `Pinned plan ${record.item}`);
    const plan = readJson(filePath, `pinned plan ${record.item}`);
    const item = snapshot.items.find((candidate) => candidate.name === record.item);
    assert(item, `Pinned plan references unknown install root ${record.item}.`);
    assertPlan(plan, item, snapshot);
    planByItem.set(record.item, plan);
  }
  return {
    catalog,
    planByItem
  };
}

export function parseArguments(arguments_) {
  let blocksRepo = null;
  let help = false;
  let query = null;
  let registryType = null;
  let sourcePreflight = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--blocks-repo') {
      assert(blocksRepo === null, '--blocks-repo may be provided only once.');
      const value = arguments_[index + 1];
      assert(value && !value.startsWith('-'), '--blocks-repo requires a path.');
      blocksRepo = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--source-preflight') {
      assert(!sourcePreflight, '--source-preflight may be provided only once.');
      sourcePreflight = true;
      continue;
    }
    if (argument === '--list-roots' || argument === '--list-registry') {
      assert(query === null, 'Select only one query mode.');
      query = {
        kind: argument === '--list-roots' ? 'list-roots' : 'list-registry',
        value: null
      };
      continue;
    }
    if (argument === '--root' || argument === '--registry-item') {
      assert(query === null, 'Select only one query mode.');
      const value = arguments_[index + 1];
      assert(value && !value.startsWith('-'), `${argument} requires a name.`);
      query = {
        kind: argument === '--root' ? 'root' : 'registry-item',
        value
      };
      index += 1;
      continue;
    }
    if (argument === '--type') {
      assert(registryType === null, '--type may be provided only once.');
      const value = arguments_[index + 1];
      assert(value && !value.startsWith('-'), '--type requires a registry type.');
      registryType = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument ${argument}.`);
  }
  assert(
    registryType === null || query?.kind === 'list-registry',
    '--type is valid only with --list-registry.'
  );
  assert(
    !sourcePreflight || blocksRepo !== null,
    '--source-preflight requires --blocks-repo.'
  );
  assert(
    !sourcePreflight || query === null,
    '--source-preflight cannot be combined with a query mode.'
  );
  return { blocksRepo, help, query, registryType, sourcePreflight };
}

function usage() {
  return [
    'Validate the pinned Constructive Blocks skill contract.',
    '',
    'Usage:',
    '  node /absolute/path/to/check-blocks-contract.mjs',
    '  node /absolute/path/to/check-blocks-contract.mjs --blocks-repo /absolute/path/to/blocks --source-preflight',
    '  node /absolute/path/to/check-blocks-contract.mjs --blocks-repo /absolute/path/to/blocks',
    '  node /absolute/path/to/check-blocks-contract.mjs --list-roots',
    '  node /absolute/path/to/check-blocks-contract.mjs --root preset-b2b-storage',
    '  node /absolute/path/to/check-blocks-contract.mjs --list-registry [--type registry:block]',
    '  node /absolute/path/to/check-blocks-contract.mjs --registry-item app-shell',
    '',
    'Without --blocks-repo, validates the portable catalog, all 19 complete plans,',
    'hard-coded mappings, and their SHA-256 attestations.',
    'With --source-preflight, requires the exact clean tracked commit and verifies',
    'canonical tracked source without requiring ignored generated artifacts.',
    'With --blocks-repo alone, additionally verifies aggregate registry bytes and',
    'compares every prebuilt --no-build inspector plan. The checker never rebuilds',
    'or edits Blocks.'
  ].join('\n');
}

function registryQueryOverride(snapshot, itemName) {
  return snapshot.registry.queryOverrides.find(
    (override) => override.item === itemName && override.field === 'docs'
  ) ?? null;
}

function sourceLimitationsForRoot(snapshot, rootName) {
  return snapshot.sourceLimitations.filter((limitation) =>
    limitation.appliesTo.installRoots.includes(rootName)
  );
}

function runtimeModeProfilesForRoot(item) {
  if (item.name === 'feature-pack-data') {
    return [
      { id: 'embedded-auth', limitationModes: [] },
      { id: 'standalone-auth', limitationModes: ['standalone-auth'] },
      {
        id: 'standalone-auth-csrf-required',
        limitationModes: [
          'standalone-auth',
          'standalone-auth-csrf-required'
        ]
      }
    ];
  }
  if (item.surface === 'standalone-feature-pack') {
    return [{ id: 'host-controlled', limitationModes: [] }];
  }
  return [{
    id: 'console',
    limitationModes: [
      'console',
      'console-discovery',
      'console-meta-discovery'
    ]
  }];
}

function limitationAppliesToRuntimeProfile(limitation, profile) {
  return limitation.appliesTo.runtimeModes.some(
    (mode) => profile.limitationModes.includes(mode)
  );
}

function runtimeStatusForRoot(item, snapshot) {
  const limitations = sourceLimitationsForRoot(snapshot, item.name);
  const profiles = runtimeModeProfilesForRoot(item);
  const modes = profiles.map((profile) => {
    const applicable = limitations.filter(
      (limitation) => limitationAppliesToRuntimeProfile(limitation, profile)
    );
    const blockingLimitationIds = applicable.filter(
      (limitation) => limitation.acceptance === 'blocking'
    ).map((limitation) => limitation.id);
    const mitigationRequiredLimitationIds = applicable.filter(
      (limitation) => limitation.acceptance === 'require-mitigation'
    ).map((limitation) => limitation.id);
    let status = 'eligible';
    if (blockingLimitationIds.length > 0) status = 'blocked';
    else if (mitigationRequiredLimitationIds.length > 0) {
      status = 'mitigation-required';
    }
    return {
      id: profile.id,
      status,
      blockingLimitationIds,
      mitigationRequiredLimitationIds
    };
  });
  const blockingLimitations = limitations.filter(
    (limitation) => limitation.acceptance === 'blocking'
  );
  const unconditionalBlockerIds = blockingLimitations.filter(
    (limitation) => profiles.every(
      (profile) => limitationAppliesToRuntimeProfile(limitation, profile)
    )
  ).map((limitation) => limitation.id);
  const conditionalBlockers = blockingLimitations.filter(
    (limitation) => !unconditionalBlockerIds.includes(limitation.id)
  ).map((limitation) => ({
    id: limitation.id,
    limitationRuntimeModes: limitation.appliesTo.runtimeModes,
    blockedRuntimeModes: modes.filter(
      (mode) => mode.blockingLimitationIds.includes(limitation.id)
    ).map((mode) => mode.id)
  }));
  let status = 'eligible';
  if (unconditionalBlockerIds.length > 0) status = 'blocked';
  else if (conditionalBlockers.length > 0) status = 'conditionally-blocked';
  else if (modes.some((mode) => mode.status === 'mitigation-required')) {
    status = 'mitigation-required';
  }
  return {
    status,
    blocked: unconditionalBlockerIds.length > 0,
    unconditionalBlockerIds,
    conditionalBlockerIds: conditionalBlockers.map((blocker) => blocker.id),
    conditionalBlockers,
    modes
  };
}

function installabilityEnvelope(snapshot) {
  const local = snapshot.release.localConsumption;
  return {
    releaseStatus: snapshot.release.status,
    publicRegistryReady: snapshot.release.publicRegistryReady,
    publicInstallCommands: {
      status: 'blocked',
      availability: 'future-only',
      template: local.installCommandTemplate,
      reason: 'The pinned Blocks source is branch-only and its public registry artifacts are not released.'
    },
    pinnedLocalConsumption: {
      sourceCommit: snapshot.source.commit,
      acceptedCheckoutStates: snapshot.source.acceptedCheckoutStates,
      workflow: local.bootstrapSequence,
      installCommandTemplate: local.localInstallCommandTemplate,
      packageRegistryCommand: local.packageRegistryCommand,
      blockRegistryCommand: local.blockRegistryCommand,
      consumerNpmrc: local.consumerNpmrc,
      consumerRegistryTemplate: local.consumerRegistryTemplate,
      consumerIsolation: {
        required: true,
        workspace: local.consumerWorkspace
      },
      lockfile: {
        frozenInstallRequired: true,
        installCommand: local.bootstrapSequence[1],
        localResolutionPolicy: local.localLockfilePolicy,
        promotionRule: local.promotionRule
      }
    }
  };
}

function rootItemForQuery(item, snapshot) {
  const limitations = sourceLimitationsForRoot(snapshot, item.name);
  const runtimeStatus = runtimeStatusForRoot(item, snapshot);
  return {
    name: item.name,
    surface: item.surface,
    title: item.title,
    description: item.description,
    featurePacks: item.featurePacks,
    presetProfiles: item.presetProfiles,
    installCommand: item.installCommand,
    sourceLimitationIds: limitations.map((limitation) => limitation.id),
    sourceLimitationAcceptances: limitations.map((limitation) => ({
      id: limitation.id,
      acceptance: limitation.acceptance,
      runtimeModes: limitation.appliesTo.runtimeModes
    })),
    runtimeStatus,
    blocked: runtimeStatus.blocked
  };
}

function metaContractForItem(snapshot, itemName) {
  const installRoot = snapshot.items.find(
    (candidate) => candidate.name === itemName
  );
  if (!installRoot || !installRoot.featurePacks.includes('data')) return null;
  return snapshot.metaContract;
}

function registryItemForQuery(item, snapshot) {
  const override = registryQueryOverride(snapshot, item.name);
  const installRoot = snapshot.items.find(
    (candidate) => candidate.name === item.name
  );
  const portableOverrides = override
    ? [{
        field: override.field,
        status: override.status,
        reason: override.reason
      }]
    : [];
  return {
    name: item.name,
    type: item.type,
    title: item.title,
    description: item.description,
    categories: item.categories,
    docs: override ? override.portableValue : item.docs,
    dependencies: item.dependencies,
    devDependencies: item.devDependencies,
    registryDependencies: item.registryDependencies,
    files: item.files,
    installCommand: item.installCommand,
    portableOverrides,
    sourceLimitations: sourceLimitationsForRoot(snapshot, item.name),
    metaContract: metaContractForItem(snapshot, item.name),
    runtimeStatus: installRoot
      ? runtimeStatusForRoot(installRoot, snapshot)
      : null,
    installability: installabilityEnvelope(snapshot)
  };
}

function planForQuery(plan, snapshot) {
  const result = structuredClone(plan);
  const override = registryQueryOverride(snapshot, plan.item);
  if (override) result.registryDocumentation = override.portableValue;
  return result;
}

function standaloneContractForPack(snapshot, packId) {
  if (packId === 'data') return snapshot.standaloneContracts.data;
  const nonData = snapshot.standaloneContracts.nonData;
  return {
    discovery: nonData.discovery,
    endpointResolution: nonData.endpointResolution,
    sessionOwnership: nonData.sessionOwnership,
    hostProvides: nonData.hostProvides,
    pack: nonData.packs[packId]
  };
}

function adapterProfilesForBindings(snapshot, bindings) {
  const contractIds = new Set();
  const actionIds = new Set();
  for (const binding of bindings) {
    for (const requirement of binding.adapterRequirements ?? []) {
      if (requirement.connectionProfile) {
        contractIds.add(requirement.connectionProfile);
      }
    }
    for (const profileId of binding.adapterActionProfileIds ?? []) {
      actionIds.add(profileId);
    }
  }
  return {
    contracts: Array.from(contractIds).map((id) => ({
      id,
      contract: snapshot.adapterContractProfiles[id]
    })),
    actions: Array.from(actionIds).map((id) => ({
      id,
      contract: snapshot.adapterActionProfiles[id]
    }))
  };
}

function queryOutput(options, loaded) {
  if (!options.query) return null;
  switch (options.query.kind) {
    case 'list-roots':
      return {
        schemaVersion: 1,
        kind: 'constructive.blocks-install-root-list',
        sourceCommit: PINNED.commit,
        installability: installabilityEnvelope(loaded.snapshot),
        metaContract: loaded.snapshot.metaContract,
        items: loaded.snapshot.items.map(
          (item) => rootItemForQuery(item, loaded.snapshot)
        )
      };
    case 'root': {
      const sourcePlan = loaded.artifacts.planByItem.get(options.query.value);
      assert(sourcePlan, `Unknown Console install root ${options.query.value}.`);
      const item = loaded.snapshot.items.find(
        (candidate) => candidate.name === options.query.value
      );
      const plan = planForQuery(sourcePlan, loaded.snapshot);
      const standalonePackId = item.surface === 'standalone-feature-pack'
        ? item.featurePacks[0]
        : null;
      const standalone = standalonePackId
        ? {
            featurePack: standalonePackId,
            contract: standaloneContractForPack(
              loaded.snapshot,
              standalonePackId
            )
          }
        : null;
      const moduleBindings = item.surface === 'standalone-feature-pack'
        ? []
        : loaded.snapshot.consoleModuleBindings.filter(
            (binding) => item.featurePacks.includes(binding.featurePack)
          );
      return {
        schemaVersion: 1,
        kind: 'constructive.blocks-install-root',
        sourceCommit: PINNED.commit,
        installability: installabilityEnvelope(loaded.snapshot),
        runtimeStatus: runtimeStatusForRoot(item, loaded.snapshot),
        backendPresetSource: loaded.snapshot.backendPresetSource,
        backendPresetRoute: loaded.snapshot.backendPresetRouting.find(
          (route) => route.frontendPresetRoot === item.name
        ) ?? null,
        plan,
        portableContract: {
          standalone,
          consoleModuleBindings: moduleBindings,
          adapterProfiles: adapterProfilesForBindings(
            loaded.snapshot,
            moduleBindings
          ),
          consoleStore: item.surface === 'standalone-feature-pack'
            ? null
            : loaded.snapshot.hostOwnedStore,
          metaContract: item.featurePacks.includes('data')
            ? loaded.snapshot.metaContract
            : null,
          registryOverrides: loaded.snapshot.registry.queryOverrides.filter(
            (override) => override.item === item.name
          ).map((override) => ({
            field: override.field,
            status: override.status,
            reason: override.reason
          })),
          sourceLimitations: sourceLimitationsForRoot(
            loaded.snapshot,
            item.name
          )
        }
      };
    }
    case 'list-registry': {
      const allowedTypes = new Set([
        'registry:theme',
        'registry:lib',
        'registry:hook',
        'registry:ui',
        'registry:block'
      ]);
      if (options.registryType) {
        assert(
          allowedTypes.has(options.registryType),
          `Unknown registry type ${options.registryType}.`
        );
      }
      const selected = loaded.artifacts.catalog.items.filter(
        (item) => !options.registryType || item.type === options.registryType
      ).map((item) => registryItemForQuery(item, loaded.snapshot));
      return {
        schemaVersion: 1,
        kind: 'constructive.blocks-registry-item-list',
        sourceCommit: PINNED.commit,
        installability: installabilityEnvelope(loaded.snapshot),
        metaContract: loaded.snapshot.metaContract,
        filter: {
          type: options.registryType
        },
        itemCount: selected.length,
        items: selected.map((item) => ({
          name: item.name,
          type: item.type,
          title: item.title,
          description: item.description,
          categories: item.categories,
          docs: item.docs,
          installCommand: item.installCommand,
          runtimeStatus: item.runtimeStatus,
          sourceLimitationIds: item.sourceLimitations.map(
            (limitation) => limitation.id
          )
        }))
      };
    }
    case 'registry-item': {
      const item = loaded.artifacts.catalog.items.find(
        (candidate) => candidate.name === options.query.value
      );
      assert(item, `Unknown registry item ${options.query.value}.`);
      return registryItemForQuery(item, loaded.snapshot);
    }
    default:
      fail(`Unknown query mode ${options.query.kind}.`);
  }
}

function runGit(blocksRepo, arguments_, label) {
  try {
    return execFileSync('git', arguments_, {
      cwd: blocksRepo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (cause) {
    const stderr =
      cause && typeof cause === 'object' && typeof cause.stderr === 'string'
        ? cause.stderr.trim()
        : '';
    fail(`${label} failed: ${stderr || (cause instanceof Error ? cause.message : String(cause))}`);
  }
}

function runBlocksInspector(blocksRepo, arguments_) {
  const commandArguments = [
    '--dir',
    blocksRepo,
    '--silent',
    'console-kit:inspect',
    '--no-build'
  ].concat(arguments_);
  try {
    const stdout = execFileSync('pnpm', commandArguments, {
      cwd: skillDirectory,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return JSON.parse(stdout);
  } catch (cause) {
    const stderr =
      cause && typeof cause === 'object' && typeof cause.stderr === 'string'
        ? cause.stderr.trim()
        : '';
    fail(
      `Pinned prebuilt Blocks inspector failed: ${stderr ||
        (cause instanceof Error ? cause.message : String(cause))}`
    );
  }
}

function assertLiveRelease(blocksRepo) {
  const rootPackage = readJson(path.join(blocksRepo, 'package.json'), 'Blocks package.json');
  assert(rootPackage.packageManager === PINNED.packageManager, 'Live Blocks packageManager drifted.');
  assert(rootPackage.engines?.node === PINNED.nodeEngine, 'Live Blocks Node engine drifted.');
  const registryPackage = readJson(
    path.join(blocksRepo, 'apps/registry/package.json'),
    'Blocks registry package.json'
  );
  assert(
    registryPackage.devDependencies?.shadcn === PINNED.shadcnVersion,
    'Live shadcn registry dependency drifted.'
  );
  for (const expected of PACKAGE_RELEASES) {
    const manifest = readJson(
      path.join(blocksRepo, expected.manifestPath),
      expected.manifestPath
    );
    assert(manifest.name === expected.name, `${expected.manifestPath} package name drifted.`);
    assert(manifest.version === expected.version, `${expected.name} version drifted.`);
  }
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function templateLiteralConstant(source, constantName) {
  const marker = `export const ${constantName} = /* GraphQL */ \``;
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing ${constantName} GraphQL source constant.`);
  const contentStart = start + marker.length;
  const end = source.indexOf('`;', contentStart);
  assert(end >= 0, `Unterminated ${constantName} GraphQL source constant.`);
  return source.slice(contentStart, end);
}

function assertMetaSourceContract(snapshot, blocksRepo) {
  const sourcePath = resolveInside(
    blocksRepo,
    snapshot.metaContract.source.path,
    'Meta contract source path'
  );
  const source = readFileSync(sourcePath, 'utf8');
  const requirementsStart = source.indexOf(
    'export const META_CONTRACT_REQUIREMENTS = {'
  );
  const requirementsEnd = source.indexOf(
    '} as const satisfies Record<MetaContractTypeAlias',
    requirementsStart
  );
  assert(
    requirementsStart >= 0 && requirementsEnd > requirementsStart,
    'The pinned META_CONTRACT_REQUIREMENTS source block is missing.'
  );
  const requirementsSource = source.slice(
    requirementsStart,
    requirementsEnd
  );
  for (const [alias, requirement] of Object.entries(
    META_CONTRACT_REQUIREMENTS
  )) {
    assert(
      requirementsSource.includes(`${alias}:`) &&
        requirementsSource.includes(`typeName: '${requirement.typeName}'`) &&
        requirement.fields.every((field) =>
          requirementsSource.includes(`'${field}'`)
        ),
      `Pinned _meta requirement ${alias} drifted in source.`
    );
  }

  const querySource = templateLiteralConstant(source, 'META_QUERY_SOURCE');
  const introspectionFields = Object.entries(META_CONTRACT_REQUIREMENTS).map(
    ([alias, requirement]) =>
      `${alias}: __type(name: "${requirement.typeName}") { name fields { name } }`
  ).join('\n\t\t');
  const introspectionSource =
    `\n\tquery ConstructiveMetaContract {\n\t\t${introspectionFields}\n\t}\n`;
  const introspectionTemplate = templateLiteralConstant(
    source,
    'META_CONTRACT_INTROSPECTION_SOURCE'
  );
  assert(
    introspectionTemplate ===
      '\n\tquery ConstructiveMetaContract {\n\t\t${metaContractIntrospectionFields}\n\t}\n',
    'META_CONTRACT_INTROSPECTION_SOURCE template drifted.'
  );
  const actualDocuments = {
    metaQuery: {
      sourceConstant: 'META_QUERY_SOURCE',
      operationName: 'ConstructiveMeta',
      byteLength: Buffer.byteLength(querySource),
      sha256: sha256Text(querySource)
    },
    contractIntrospection: {
      sourceConstant: 'META_CONTRACT_INTROSPECTION_SOURCE',
      operationName: 'ConstructiveMetaContract',
      byteLength: Buffer.byteLength(introspectionSource),
      sha256: sha256Text(introspectionSource)
    }
  };
  assertExact(
    actualDocuments,
    snapshot.metaContract.documents,
    'Pinned _meta GraphQL document attestations'
  );
}

function assertActionProfileSources(snapshot, blocksRepo) {
  for (const [profileId, profile] of Object.entries(
    snapshot.adapterActionProfiles
  )) {
    const sourcePath = resolveInside(
      blocksRepo,
      profile.source.path,
      `${profileId} action source path`
    );
    const source = readFileSync(sourcePath, 'utf8');
    const compactSource = source.replace(/\s+/gu, '');
    for (const document of profile.documents) {
      const coordinate = document[1];
      const inputType = document[2];
      const payloadPath = document[3];
      const requiredPayloadFields = document[4];
      const mutationName = coordinate.slice('Mutation.'.length);
      if (coordinate === 'Mutation.createUser') continue;
      const selection = payloadPath === null
        ? requiredPayloadFields.join('')
        : `${payloadPath}{${requiredPayloadFields.join('')}}`;
      assert(
        compactSource.includes(`$input:${inputType}!`) &&
          compactSource.includes(
            `${mutationName}(input:$input){${selection}}`
          ),
        `${profileId} source no longer contains ${coordinate} with its required payload minimum.`
      );
    }
  }

  const organizations = snapshot.adapterActionProfiles[
    'organizations-enabled-actions'
  ];
  const createUser = organizations.documents.find(
    (document) => document[1] === 'Mutation.createUser'
  );
  assertExact(
    createUser,
    [
      'auth',
      'Mutation.createUser',
      'CreateUserInput',
      'user',
      ['id', 'type', 'username']
    ],
    'Organizations createUser action minimum'
  );
  const sourcePath = resolveInside(
    blocksRepo,
    organizations.source.path,
    'Organizations action source path'
  );
  const source = readFileSync(sourcePath, 'utf8');
  assert(
    source.includes("fields.includes('id') && fields.includes('type')") &&
      source.includes("loaded.userFields.includes('username')") &&
      source.includes(
        "requiredFields: ['username', 'displayName', 'type']"
      ) &&
      source.includes('const returnedId = asString(returnedUser?.id);') &&
      source.includes('returnedUser?.type === 2') &&
      source.includes(
        'asString(returnedUser?.username) === provisioning.username'
      ) &&
      source.includes("!loaded.userFields.includes('displayName')") &&
      source.includes('returnedUser?.displayName === name'),
    'Organizations createUser input, required output, or optional displayName behavior drifted.'
  );
}

export function assertBlocksSourcePreflight(snapshot, blocksRepo) {
  assert(existsSync(blocksRepo), `Blocks repository does not exist: ${blocksRepo}`);
  const commit = runGit(blocksRepo, ['rev-parse', 'HEAD'], 'Resolving Blocks HEAD');
  assert(
    commit === PINNED.commit && commit === snapshot.source.commit,
    `Blocks HEAD ${commit} does not match pinned commit ${PINNED.commit}.`
  );
  const trackedStatus = runGit(
    blocksRepo,
    ['status', '--porcelain=v1', '--untracked-files=no'],
    'Checking Blocks worktree'
  );
  assert(
    trackedStatus.length === 0,
    `Blocks tracked worktree must be clean before attestation:\n${trackedStatus}`
  );

  for (const record of snapshot.source.attestations.canonicalFiles) {
    assertAttestedFile(blocksRepo, record, `Live canonical source ${record.path}`);
  }
  assertLiveRelease(blocksRepo);
  assertMetaSourceContract(snapshot, blocksRepo);
  assertActionProfileSources(snapshot, blocksRepo);

  const dataModulePath = resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/data/data-console-module.tsx',
    'Data Console module path'
  );
  const dataModuleSource = readFileSync(dataModulePath, 'utf8');
  assert(
    !/\bstoreSlice\s*:/.test(dataModuleSource),
    'The pinned Data Console module unexpectedly contributes storeSlice; update the conformance record.'
  );
  const dataProviderPath = resolveInside(
    blocksRepo,
    'packages/sheets/src/context/sheets-provider.tsx',
    'Data Sheets provider path'
  );
  const dataProviderSource = readFileSync(dataProviderPath, 'utf8');
  assert(
    /\bcreateSheetsStore\s*\(\s*\)/.test(dataProviderSource),
    'The pinned SheetsProvider no longer creates its nested Zustand store; update the conformance record.'
  );
  const dataFeaturePath = resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/data/data-feature-pack.tsx',
    'Standalone Data feature-pack path'
  );
  const dataFeatureSource = readFileSync(dataFeaturePath, 'utf8');
  assert(
    dataFeatureSource.includes('export type DataFeaturePackProps') &&
      dataFeatureSource.includes('config: SheetsConfig;') &&
      dataFeatureSource.includes('activeTable?: string;') &&
      dataFeatureSource.includes('defaultActiveTable?: string;') &&
      dataFeatureSource.includes(
        'onActiveTableChange?: (tableName: string) => void;'
      ) &&
      dataFeatureSource.includes(
        'React.useState(defaultActiveTable ?? \'\')'
      ) &&
      dataFeatureSource.includes(
        'controlledActiveTable === undefined'
      ) &&
      dataFeatureSource.includes('onActiveTableChange?.(tableName)'),
    'Standalone Data props or controlled/default active-table behavior drifted.'
  );
  const authExecutePath = resolveInside(
    blocksRepo,
    'packages/sheets/src/auth/auth-execute.ts',
    'Standalone Data auth execution path'
  );
  const authExecuteSource = readFileSync(authExecutePath, 'utf8');
  assert(
    /config\.authEndpoint\s*\|\|\s*config\.endpoint/.test(authExecuteSource),
    'Standalone Data auth execution no longer falls back to the data endpoint; update the limitation.'
  );
  assert(
    !authExecuteSource.includes('csrfTokenProvider'),
    'Standalone Data auth execution now supports CSRF transport; update the limitation.'
  );
  const tokenStorePath = resolveInside(
    blocksRepo,
    'packages/sheets/src/auth/utils/token-store.ts',
    'Standalone Data token store path'
  );
  const tokenStoreSource = readFileSync(tokenStorePath, 'utf8');
  assert(
    tokenStoreSource.includes('window.localStorage') &&
      tokenStoreSource.includes('storage.setItem(storageKey(databaseId)'),
    'Standalone Data no longer persists tokens in localStorage; update the limitation.'
  );
  for (const hookName of ['use-login.ts', 'use-register.ts']) {
    const hookPath = resolveInside(
      blocksRepo,
      `packages/sheets/src/auth/hooks/${hookName}`,
      `Standalone Data ${hookName} path`
    );
    const hookSource = readFileSync(hookPath, 'utf8');
    assert(
      hookSource.includes("config.databaseId || 'default'") &&
        hookSource.includes('setStoredToken(') &&
        hookSource.includes('rememberMe'),
      `Standalone Data ${hookName} no longer exposes the database fallback and remember/persistence mismatch; update the limitations.`
    );
  }
  const organizationsContractPath = resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/organizations/organizations-meta-contract.ts',
    'Organizations metadata contract path'
  );
  const organizationsContractSource = readFileSync(
    organizationsContractPath,
    'utf8'
  );
  assert(
    /\bmembers\?\s*:/.test(organizationsContractSource) &&
      organizationsContractSource.includes(
        'if (!memberTable) return { organizations: organization };'
      ),
    'Organizations metadata no longer permits an organizations-only contract; update the limitation.'
  );
  const organizationsModulePath = resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/organizations/organizations-console-module.tsx',
    'Organizations Console module path'
  );
  const organizationsModuleSource = readFileSync(organizationsModulePath, 'utf8');
  assert(
    organizationsModuleSource.includes('contract.members?.root') &&
      organizationsModuleSource.includes(
        "supportedCapabilities: ['organizations.memberships']"
      ),
    'Organizations discovery no longer reports memberships from an optional member contract; update the limitation.'
  );
  const organizationsAdapterSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/console-kit/constructive/organizations-adapter.ts',
    'Organizations adapter path'
  ), 'utf8');
  assert(
    organizationsAdapterSource.includes('function connectionSelection(') &&
      organizationsAdapterSource.includes('mutation ConsoleKitUpdateOrgMembership') &&
      organizationsAdapterSource.includes("connectionSelection(schema, 'OrgMembership'") &&
      organizationsAdapterSource.includes("connectionSelection(authSchema, typeName"),
    'Organizations connection, action, or identity path shapes changed; update the limitation.'
  );
  const storageModulePath = resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/storage/storage-console-module.tsx',
    'Storage Console module path'
  );
  const storageModuleSource = readFileSync(storageModulePath, 'utf8');
  assert(
    storageModuleSource.includes("['storage', 'admin', 'data']") &&
      storageModuleSource.includes(
        'for (const [endpoint, metadata] of metadataByEndpoint)'
      ) &&
      storageModuleSource.includes(
        "supportedCapabilities: ['storage.buckets', 'storage.files']"
      ),
    'Storage discovery no longer exposes the cross/any-endpoint mismatch; update the limitation.'
  );
  const storageAdapterPath = resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/console-kit/constructive/storage-adapter.ts',
    'Storage adapter path'
  );
  const storageAdapterSource = readFileSync(storageAdapterPath, 'utf8');
  assert(
    storageAdapterSource.includes(
      "const endpointPriority: readonly ConsoleEndpointKind[] = ["
    ) &&
      storageAdapterSource.includes("'storage',") &&
      storageAdapterSource.includes("'admin',") &&
      storageAdapterSource.includes("'data'") &&
      storageAdapterSource.includes('function storageRoots('),
    'Storage adapter endpoint or paired-root behavior changed; update the limitation.'
  );

  const authModuleSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/auth/auth-console-module.tsx',
    'Auth Console module path'
  ), 'utf8');
  const authAdapterSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/console-kit/constructive/auth-adapter.ts',
    'Auth adapter path'
  ), 'utf8');
  assert(
    authModuleSource.includes("fields: ['signIn', 'signUp']") &&
      authAdapterSource.includes('query ConsoleKitCurrentAccount') &&
      authAdapterSource.includes('mutation ConsoleKitResetPassword'),
    'Auth discovery or its fixed adapter operation shapes changed; update the limitation.'
  );

  const usersModuleSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/users/users-console-module.tsx',
    'Users Console module path'
  ), 'utf8');
  const usersAdapterSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/console-kit/constructive/users-adapter.ts',
    'Users adapter path'
  ), 'utf8');
  assert(
    usersModuleSource.includes("fields: ['users']") &&
      usersModuleSource.includes("fields: ['appMemberships']") &&
      usersAdapterSource.includes("connectionSelection(adminSchema, 'AppMembership'") &&
      usersAdapterSource.includes('mutation ConsoleKitUpdateAppMembership'),
    'Users discovery or its connection/action shapes changed; update the limitation.'
  );

  const billingModuleSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/billing/billing-console-module.tsx',
    'Billing Console module path'
  ), 'utf8');
  const billingAdapterSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/console-kit/constructive/billing-adapter.ts',
    'Billing adapter path'
  ), 'utf8');
  assert(
    billingModuleSource.includes("fields: ['plans']") &&
      billingAdapterSource.includes('function connectionContract(') &&
      billingAdapterSource.includes('query ConsoleKitBilling'),
    'Billing discovery or its fixed connection shapes changed; update the limitation.'
  );

  const notificationsModuleSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/notifications/notifications-console-module.tsx',
    'Notifications Console module path'
  ), 'utf8');
  const notificationsAdapterSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/console-kit/constructive/notifications-adapter.ts',
    'Notifications adapter path'
  ), 'utf8');
  const notificationsFeatureSource = readFileSync(resolveInside(
    blocksRepo,
    'apps/blocks/src/blocks/feature-packs/notifications/notifications-feature-pack.tsx',
    'Notifications feature-pack path'
  ), 'utf8');
  assert(
    notificationsModuleSource.includes("capability: 'notifications.settings'") &&
      notificationsAdapterSource.includes(
        "const capabilities: readonly AtomicCapabilityId[] = ['notifications.inbox']"
      ) &&
      !notificationsAdapterSource.includes("'notifications.settings'") &&
      notificationsAdapterSource.includes('function connectionContract(') &&
      notificationsFeatureSource.includes('NotificationsFeatureData') &&
      !notificationsFeatureSource.includes('notificationPreferences'),
    'Notifications discovery, inbox adapter shape, or unimplemented settings boundary changed; update the limitations.'
  );

  const appShellSource = readFileSync(resolveInside(
    blocksRepo,
    'packages/ui/src/components/app-shell.tsx',
    'App shell source path'
  ), 'utf8');
  const sidebarSource = readFileSync(resolveInside(
    blocksRepo,
    'packages/ui/src/components/sidebar.tsx',
    'Sidebar source path'
  ), 'utf8');
  const uiIndexSource = readFileSync(resolveInside(
    blocksRepo,
    'packages/ui/src/index.ts',
    'UI package index path'
  ), 'utf8');
  assert(
    appShellSource.includes('<SidebarProvider') &&
      appShellSource.includes('return useRender({') &&
      sidebarSource.includes("const SIDEBAR_COOKIE_NAME = 'sidebar_state'") &&
      sidebarSource.includes('function SidebarProvider(') &&
      uiIndexSource.includes('AppShell,') &&
      uiIndexSource.includes('SidebarProvider,'),
    'The pinned shadcn-aligned app shell or sidebar export contract changed.'
  );

  const inspectorPath = resolveInside(
    blocksRepo,
    snapshot.source.inspector.script,
    'inspector path'
  );
  assert(existsSync(inspectorPath), `Blocks inspector does not exist: ${inspectorPath}`);
}

export function assertBlocksSource(snapshot, artifacts, blocksRepo) {
  assertBlocksSourcePreflight(snapshot, blocksRepo);
  assertAttestedFile(
    blocksRepo,
    snapshot.source.attestations.aggregateRegistry,
    'Live aggregate registry'
  );

  const aggregatePath = resolveInside(
    blocksRepo,
    snapshot.source.attestations.aggregateRegistry.path,
    'aggregate registry path'
  );
  const registry = readJson(aggregatePath, 'live aggregate registry');
  assert(registry.$schema === PINNED.registrySchema, 'Live aggregate registry schema drifted.');
  assert(registry.name === 'constructive', 'Live aggregate registry name drifted.');
  assert(registry.homepage === PINNED.registryHomepage, 'Live aggregate registry homepage drifted.');
  assertExact(
    projectRegistryCatalog(registry),
    artifacts.catalog,
    'Live aggregate registry catalog projection'
  );

  const liveList = runBlocksInspector(blocksRepo, ['--list']);
  assert(liveList.schemaVersion === snapshot.source.inspector.schemaVersion, 'Live inspector schemaVersion drifted.');
  assert(liveList.kind === snapshot.source.inspector.kind, 'Live inspector kind drifted.');
  assertExact(liveList.items, snapshot.items, 'Live inspector install roots');

  for (const item of snapshot.items) {
    const livePlan = runBlocksInspector(
      blocksRepo,
      ['--item', item.name, '--compact']
    );
    assertExact(
      livePlan,
      artifacts.planByItem.get(item.name),
      `Live complete plan ${item.name}`
    );
  }
}

export function loadPortableContract() {
  const snapshot = readJson(snapshotPath, snapshotPath);
  assertSnapshot(snapshot);
  const artifacts = validateSkillArtifacts(snapshot);
  return {
    snapshot,
    artifacts
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const loaded = loadPortableContract();
  if (options.blocksRepo) {
    if (options.sourcePreflight) {
      assertBlocksSourcePreflight(loaded.snapshot, options.blocksRepo);
    } else {
      assertBlocksSource(loaded.snapshot, loaded.artifacts, options.blocksRepo);
    }
  }
  const output = queryOutput(options, loaded);
  if (output) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  let sourceStatus = '';
  if (options.sourcePreflight) {
    sourceStatus = ` Pinned clean tracked source ${PINNED.commit} matches; generated artifacts were not required.`;
  } else if (options.blocksRepo) {
    sourceStatus = ` Pinned clean source ${PINNED.commit} matches.`;
  }
  process.stdout.write(
    `Blocks contract OK: ${PINNED.registryItemCount} registry items, ${INSTALL_ROOT_NAMES.length} complete Console plans, ${PACK_IDS.length} packs, ${PROFILE_IDS.length} presets.${sourceStatus}\n`
  );
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    main();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
