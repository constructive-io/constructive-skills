# Constructive Command Palette

Build command palettes with navigation and executable commands using @constructive-io/ui.

## When to Apply

Use this skill when:
- Building a command palette (Cmd+K / Ctrl+K interface)
- Implementing keyboard-driven navigation
- Creating searchable command menus
- Adding quick actions to your application

## Overview

The Command component from @constructive-io/ui provides a full-featured command palette with search, keyboard navigation, grouping, and shortcuts. This skill covers both the UI component usage and a recommended command specification schema for defining your application's commands.

## Component Reference

```tsx
import {
  Command,
  CommandDialog,
  CommandDialogTrigger,
  CommandDialogPopup,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandGroupLabel,
  CommandCollection,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
  CommandFooter,
  CommandPanel,
  CommandEmpty,
} from '@constructive-io/ui/command';
```

### Component Hierarchy

```
CommandDialog (modal wrapper)
├── CommandDialogTrigger (button to open)
└── CommandDialogPopup (popup content)
    └── Command (root)
        ├── CommandInput (search box)
        ├── CommandPanel (list container)
        │   ├── CommandList (scrollable list)
        │   │   └── CommandGroup (category)
        │   │       ├── CommandGroupLabel
        │   │       └── CommandCollection
        │   │           └── CommandItem
        │   │               └── CommandShortcut
        │   └── CommandEmpty (no results state)
        └── CommandFooter (keyboard hints)
```

## Command Specification Schema

Define your commands using this TypeScript schema:

### Type Definitions

```typescript
// Command types
type CommandType = 'navigation' | 'action' | 'search' | 'external';

// Individual command definition
interface CommandDefinition {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Icon component or icon name from lucide-react */
  icon?: React.ComponentType<{ className?: string }> | string;
  /** Keyboard shortcut (e.g., "⌘K", "⌘⇧P") */
  shortcut?: string;
  /** Command type */
  type: CommandType;
  /** Group/category this command belongs to */
  group: string;
  /** Additional search keywords */
  keywords?: string[];
  /** For navigation: the route path */
  href?: string;
  /** For external: open in new tab */
  external?: boolean;
  /** For action: the handler function */
  onSelect?: () => void | Promise<void>;
  /** Whether command is currently disabled */
  disabled?: boolean;
  /** Whether to hide from palette (for programmatic use) */
  hidden?: boolean;
  /** Priority for sorting within group (lower = higher priority) */
  priority?: number;
}

// Command group definition
interface CommandGroup {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Sort priority (lower = appears first) */
  priority: number;
}

// Full command registry
interface CommandRegistry {
  groups: CommandGroup[];
  commands: CommandDefinition[];
}
```

### Example Command Registry

```typescript
import {
  HomeIcon,
  LayoutDashboardIcon,
  FolderIcon,
  PlusIcon,
  UserPlusIcon,
  DownloadIcon,
  SettingsIcon,
  BellIcon,
  ShieldIcon,
  PuzzleIcon,
  SearchIcon,
  HelpCircleIcon,
  ExternalLinkIcon,
} from 'lucide-react';

// Define your command groups
const commandGroups: CommandGroup[] = [
  { id: 'navigation', label: 'Navigation', priority: 1 },
  { id: 'actions', label: 'Actions', priority: 2 },
  { id: 'settings', label: 'Settings', priority: 3 },
  { id: 'help', label: 'Help', priority: 4 },
];

// Define your commands
const commands: CommandDefinition[] = [
  // Navigation commands
  {
    id: 'go-home',
    label: 'Go to Home',
    icon: HomeIcon,
    type: 'navigation',
    group: 'navigation',
    href: '/',
    shortcut: '⌘H',
    keywords: ['home', 'start', 'main'],
  },
  {
    id: 'go-dashboard',
    label: 'Go to Dashboard',
    icon: LayoutDashboardIcon,
    type: 'navigation',
    group: 'navigation',
    href: '/dashboard',
    shortcut: '⌘D',
    keywords: ['dashboard', 'overview', 'stats'],
  },
  {
    id: 'go-projects',
    label: 'Go to Projects',
    icon: FolderIcon,
    type: 'navigation',
    group: 'navigation',
    href: '/projects',
    keywords: ['projects', 'folders'],
  },

  // Action commands
  {
    id: 'create-project',
    label: 'Create New Project',
    description: 'Start a new project from scratch',
    icon: PlusIcon,
    type: 'action',
    group: 'actions',
    shortcut: '⌘N',
    keywords: ['new', 'create', 'project', 'add'],
    onSelect: () => {
      // Open create project modal
      console.log('Opening create project modal...');
    },
  },
  {
    id: 'invite-member',
    label: 'Invite Team Member',
    icon: UserPlusIcon,
    type: 'action',
    group: 'actions',
    keywords: ['invite', 'team', 'member', 'add', 'user'],
    onSelect: () => {
      // Open invite modal
      console.log('Opening invite modal...');
    },
  },
  {
    id: 'export-data',
    label: 'Export Data',
    icon: DownloadIcon,
    type: 'action',
    group: 'actions',
    keywords: ['export', 'download', 'data', 'csv'],
    onSelect: () => {
      // Trigger export
      console.log('Exporting data...');
    },
  },

  // Settings commands
  {
    id: 'settings-account',
    label: 'Account Settings',
    icon: SettingsIcon,
    type: 'navigation',
    group: 'settings',
    href: '/settings/account',
    shortcut: '⌘,',
    keywords: ['settings', 'account', 'profile'],
  },
  {
    id: 'settings-notifications',
    label: 'Notification Preferences',
    icon: BellIcon,
    type: 'navigation',
    group: 'settings',
    href: '/settings/notifications',
    keywords: ['notifications', 'alerts', 'email'],
  },
  {
    id: 'settings-security',
    label: 'Security Settings',
    icon: ShieldIcon,
    type: 'navigation',
    group: 'settings',
    href: '/settings/security',
    keywords: ['security', 'password', '2fa', 'authentication'],
  },
  {
    id: 'settings-integrations',
    label: 'Integrations',
    icon: PuzzleIcon,
    type: 'navigation',
    group: 'settings',
    href: '/settings/integrations',
    keywords: ['integrations', 'apps', 'connect'],
  },

  // Help commands
  {
    id: 'search-docs',
    label: 'Search Documentation',
    icon: SearchIcon,
    type: 'search',
    group: 'help',
    shortcut: '⌘/',
    keywords: ['docs', 'documentation', 'help', 'search'],
    onSelect: () => {
      // Open docs search
      console.log('Opening docs search...');
    },
  },
  {
    id: 'help-center',
    label: 'Help Center',
    icon: HelpCircleIcon,
    type: 'external',
    group: 'help',
    href: 'https://help.example.com',
    external: true,
    keywords: ['help', 'support', 'faq'],
  },
  {
    id: 'whats-new',
    label: "What's New",
    icon: ExternalLinkIcon,
    type: 'external',
    group: 'help',
    href: 'https://example.com/changelog',
    external: true,
    keywords: ['changelog', 'updates', 'new', 'features'],
  },
];

export const commandRegistry: CommandRegistry = {
  groups: commandGroups,
  commands,
};
```

## Implementation

### Basic Command Palette

```tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Command,
  CommandDialog,
  CommandDialogTrigger,
  CommandDialogPopup,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandGroupLabel,
  CommandCollection,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
  CommandFooter,
  CommandPanel,
  CommandEmpty,
} from '@constructive-io/ui/command';
import { Button } from '@constructive-io/ui/button';
import { commandRegistry, type CommandDefinition, type CommandGroup as CmdGroup } from './commands';

// Transform registry to component format
function useCommandItems() {
  const router = useRouter();
  
  // Group commands by their group
  const groupedCommands = commandRegistry.groups
    .sort((a, b) => a.priority - b.priority)
    .map(group => ({
      value: group.id,
      label: group.label,
      items: commandRegistry.commands
        .filter(cmd => cmd.group === group.id && !cmd.hidden && !cmd.disabled)
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .map(cmd => ({
          value: cmd.id,
          label: cmd.label,
          description: cmd.description,
          icon: cmd.icon,
          shortcut: cmd.shortcut,
          keywords: cmd.keywords,
          onSelect: () => handleCommandSelect(cmd),
        })),
    }))
    .filter(group => group.items.length > 0);

  function handleCommandSelect(cmd: CommandDefinition) {
    switch (cmd.type) {
      case 'navigation':
        if (cmd.href) {
          router.push(cmd.href);
        }
        break;
      case 'external':
        if (cmd.href) {
          window.open(cmd.href, cmd.external ? '_blank' : '_self');
        }
        break;
      case 'action':
      case 'search':
        cmd.onSelect?.();
        break;
    }
  }

  return groupedCommands;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const commandItems = useCommandItems();

  // Global keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogTrigger asChild>
        <Button variant="outline" className="w-[280px] justify-start text-muted-foreground">
          <span>Search commands...</span>
          <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
            ⌘K
          </kbd>
        </Button>
      </CommandDialogTrigger>
      <CommandDialogPopup>
        <Command
          items={commandItems}
          onValueChange={(value) => {
            // Find and execute the command
            const cmd = commandRegistry.commands.find(c => c.id === value);
            if (cmd) {
              setOpen(false);
              // Handle command execution here
            }
          }}
        >
          <CommandInput placeholder="Type a command or search..." />
          <CommandPanel>
            <CommandList>
              {(group, index) => (
                <React.Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.label}</CommandGroupLabel>
                    <CommandCollection>
                      {(item) => (
                        <CommandItem
                          key={item.value}
                          value={item.value}
                          onSelect={item.onSelect}
                        >
                          {item.icon && <item.icon className="mr-2 h-4 w-4" />}
                          <div className="flex flex-col">
                            <span>{item.label}</span>
                            {item.description && (
                              <span className="text-xs text-muted-foreground">
                                {item.description}
                              </span>
                            )}
                          </div>
                          {item.shortcut && (
                            <CommandShortcut>{item.shortcut}</CommandShortcut>
                          )}
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                  {index < commandItems.length - 1 && <CommandSeparator />}
                </React.Fragment>
              )}
            </CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 py-4">
                <p className="text-sm">No commands found</p>
                <p className="text-xs text-muted-foreground">
                  Try a different search term
                </p>
              </div>
            </CommandEmpty>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1">↑</kbd>
                <kbd className="rounded border bg-muted px-1">↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1">↵</kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1">esc</kbd>
                Close
              </span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
```

### Inline Command Menu (Non-Dialog)

For embedding a command list directly in the page:

```tsx
<Command items={commandItems} className="w-[400px] rounded-lg border shadow-md">
  <CommandInput placeholder="Search commands..." />
  <CommandList>
    {(group, index) => (
      <React.Fragment key={group.value}>
        <CommandGroup items={group.items}>
          <CommandGroupLabel>{group.label}</CommandGroupLabel>
          <CommandCollection>
            {(item) => (
              <CommandItem key={item.value} value={item.value}>
                {item.icon && <item.icon className="mr-2 h-4 w-4" />}
                <span>{item.label}</span>
                {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
              </CommandItem>
            )}
          </CommandCollection>
        </CommandGroup>
        {index < commandItems.length - 1 && <CommandSeparator />}
      </React.Fragment>
    )}
  </CommandList>
  <CommandEmpty>No results found.</CommandEmpty>
</Command>
```

## Command Registry Utilities

### Dynamic Command Registration

```typescript
// commands/registry.ts
class CommandRegistryManager {
  private commands: Map<string, CommandDefinition> = new Map();
  private groups: Map<string, CommandGroup> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor(initial?: CommandRegistry) {
    if (initial) {
      initial.groups.forEach(g => this.groups.set(g.id, g));
      initial.commands.forEach(c => this.commands.set(c.id, c));
    }
  }

  registerCommand(command: CommandDefinition) {
    this.commands.set(command.id, command);
    this.notify();
  }

  unregisterCommand(id: string) {
    this.commands.delete(id);
    this.notify();
  }

  registerGroup(group: CommandGroup) {
    this.groups.set(group.id, group);
    this.notify();
  }

  getCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  getGroups(): CommandGroup[] {
    return Array.from(this.groups.values());
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l());
  }
}

export const commandRegistry = new CommandRegistryManager();
```

### Context-Aware Commands

Register commands based on the current page/context:

```typescript
// hooks/use-page-commands.ts
import { useEffect } from 'react';
import { commandRegistry } from './registry';

export function usePageCommands(commands: CommandDefinition[]) {
  useEffect(() => {
    // Register commands when component mounts
    commands.forEach(cmd => commandRegistry.registerCommand(cmd));
    
    // Unregister when component unmounts
    return () => {
      commands.forEach(cmd => commandRegistry.unregisterCommand(cmd.id));
    };
  }, [commands]);
}

// Usage in a page component
function ProjectsPage() {
  usePageCommands([
    {
      id: 'project-new',
      label: 'New Project',
      type: 'action',
      group: 'actions',
      onSelect: () => openNewProjectModal(),
    },
    {
      id: 'project-import',
      label: 'Import Project',
      type: 'action',
      group: 'actions',
      onSelect: () => openImportModal(),
    },
  ]);

  return <div>...</div>;
}
```

## Keyboard Shortcut Symbols

Use these symbols for cross-platform shortcuts:

| Symbol | Meaning | Mac | Windows/Linux |
|--------|---------|-----|---------------|
| ⌘ | Command/Ctrl | Cmd | Ctrl |
| ⇧ | Shift | Shift | Shift |
| ⌥ | Option/Alt | Option | Alt |
| ⌃ | Control | Control | Ctrl |
| ↵ | Enter/Return | Return | Enter |
| ⌫ | Backspace | Delete | Backspace |
| ⎋ | Escape | Esc | Esc |

### Common Shortcuts

```typescript
const commonShortcuts = {
  openPalette: '⌘K',
  search: '⌘/',
  newItem: '⌘N',
  save: '⌘S',
  settings: '⌘,',
  home: '⌘H',
  dashboard: '⌘D',
  help: '⌘?',
  close: '⎋',
};
```

## Styling with data-slot

Command components use `data-slot` attributes:

```css
[data-slot="command-input"] { /* search input */ }
[data-slot="command-list"] { /* scrollable list */ }
[data-slot="command-group"] { /* group container */ }
[data-slot="command-group-label"] { /* group heading */ }
[data-slot="command-item"] { /* individual item */ }
[data-slot="command-shortcut"] { /* keyboard shortcut */ }
[data-slot="command-footer"] { /* footer area */ }
[data-slot="command-empty"] { /* empty state */ }
```

## Best Practices

1. **Organize by intent** - Group commands by what users want to do (Navigate, Create, Settings)
2. **Use clear labels** - "Go to Dashboard" is better than just "Dashboard"
3. **Add keywords** - Include synonyms and related terms for better search
4. **Limit shortcuts** - Only assign shortcuts to frequently-used commands
5. **Show descriptions** - Add descriptions for complex or ambiguous commands
6. **Handle loading states** - Show loading indicators for async commands
7. **Provide feedback** - Toast or notification after command execution
8. **Context awareness** - Only show relevant commands for the current page/state

## TypeScript Types

```typescript
import type { CommandDefinition, CommandGroup, CommandRegistry } from './commands';

// The Command component accepts items in this format:
type CommandItemType = {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  description?: string;
  keywords?: string[];
  onSelect?: () => void;
};

type CommandGroupType = {
  value: string;
  label: string;
  items: CommandItemType[];
};
```

## References

- [@constructive-io/ui Command component](https://www.npmjs.com/package/@constructive-io/ui)
- [Base UI Autocomplete](https://base-ui.com/react/components/autocomplete) (underlying primitive)
- [Lucide Icons](https://lucide.dev/) for command icons
- Inspired by: Linear, Notion, VS Code, Raycast command palettes
