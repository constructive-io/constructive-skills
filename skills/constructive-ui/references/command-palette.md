# Command Palette Reference

Full command palette system from `@constructive-io/command-palette` — registry-based command management with keyboard shortcuts, multi-step wizards, and background tasks.

> **Package**: `@constructive-io/command-palette` (standalone package in `packages/command-palette/`)
> **UI primitives**: `@constructive-io/ui/command` (cmdk-backed components)

## Quick Start

```tsx
import {
  CommandPalette,
  CommandRegistryManager,
  createCommandRegistry,
  usePageCommands,
  useBackgroundTasks,
  BackgroundTaskStack,
  kbd,
} from '@constructive-io/command-palette';

// 1. Create a registry with initial commands
const registry = createCommandRegistry({
  groups: [
    { id: 'navigation', label: 'Navigate', priority: 1 },
    { id: 'actions', label: 'Actions', priority: 2 },
  ],
  commands: [
    {
      id: 'go-home',
      label: 'Go to Dashboard',
      type: 'navigation',
      group: 'navigation',
      href: '/',
      icon: Home,
      shortcut: kbd('h', 'mod'),
      keywords: ['home', 'main'],
    },
  ],
});

// 2. Render the palette (Cmd+K by default)
function App() {
  const router = useRouter();
  const bgTasks = useBackgroundTasks();

  return (
    <>
      <CommandPalette
        registry={registry}
        navigate={(href) => router.push(href)}
        backgroundTasks={bgTasks}
      />
      <BackgroundTaskStack
        tasks={bgTasks.tasks}
        onCancel={bgTasks.cancel}
        onDismiss={bgTasks.dismiss}
      />
    </>
  );
}
```

## Type System

### CommandDefinition

Every command in the palette is a `CommandDefinition`:

```typescript
interface CommandDefinition {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }> | string;
  shortcut?: KeyBinding;           // Structured binding, NOT a string
  type: CommandType;
  group: string;
  keywords?: string[];
  href?: string;                   // For navigation/external types
  external?: boolean;              // Open in new tab
  onSelect?: (signal?: AbortSignal) => void | Promise<void>;
  background?: boolean;            // Run as tracked background task
  backgroundBehavior?: 'close' | 'reset' | 'persist' | ((controls: BackgroundPaletteControls) => void);
  disabled?: boolean;
  hidden?: boolean;
  priority?: number;               // Lower = higher in group (default: 99)
  multiStep?: MultiStepConfig<any>;
}

type CommandType = 'navigation' | 'action' | 'search' | 'external' | 'multi-step';
```

### CommandGroupDef

```typescript
interface CommandGroupDef {
  id: string;
  label: string;
  priority: number;  // Lower = appears first
}
```

### KeyBinding

Keyboard shortcuts use a structured type, not plain strings:

```typescript
type KeyModifier = 'mod' | 'shift' | 'alt';

interface KeyBinding {
  modifiers?: KeyModifier[];
  key: string;  // Lowercase: 'h', 'k', 'enter', 'backspace', ',', '/'
}

// Factory function
kbd('k', 'mod')           // Cmd+K (Mac) / Ctrl+K (Win/Linux)
kbd('n', 'mod', 'shift')  // Cmd+Shift+N
kbd('/')                   // Just /
```

### Keybinding Utilities

```typescript
import { kbd, matchKeyBinding, formatKeyBinding, isMac, isEditableTarget } from '@constructive-io/command-palette';

// Match against a KeyboardEvent
matchKeyBinding(event, kbd('k', 'mod'))  // true if Cmd+K pressed

// Format for display: ['⌘', 'K'] on Mac, ['Ctrl', 'K'] on PC
formatKeyBinding(kbd('k', 'mod'))

// Platform detection (SSR-safe, defaults to non-Mac)
isMac()

// Skip shortcuts when user is typing in an input/textarea
isEditableTarget(event.target)
```

## Registry

### CommandRegistryManager

Central store for commands and groups with pub/sub for reactive UI updates. Uses cached snapshots for `useSyncExternalStore` compatibility.

```typescript
import { CommandRegistryManager, createCommandRegistry } from '@constructive-io/command-palette';

// Create with initial data
const registry = createCommandRegistry({
  groups: [{ id: 'nav', label: 'Navigate', priority: 1 }],
  commands: [{ id: 'home', label: 'Home', type: 'navigation', group: 'nav', href: '/' }],
});

// Or create empty and populate dynamically
const registry = new CommandRegistryManager();
registry.registerGroup({ id: 'nav', label: 'Navigate', priority: 1 });
registry.registerCommand({ id: 'home', label: 'Home', type: 'navigation', group: 'nav', href: '/' });

// Unregister
registry.unregisterCommand('home');
registry.unregisterGroup('nav');

// Read (returns cached snapshot arrays)
registry.getCommands();  // CommandDefinition[]
registry.getGroups();    // CommandGroupDef[]

// Subscribe to changes
const unsub = registry.subscribe(() => console.log('registry changed'));
```

## Hooks

### useCommandRegistry

Subscribe to registry changes with concurrent-mode safety (`useSyncExternalStore`):

```typescript
import { useCommandRegistry } from '@constructive-io/command-palette';

function MyComponent({ registry }: { registry: CommandRegistryManager }) {
  const { commands, groups } = useCommandRegistry(registry);
  // Re-renders when commands/groups change
}
```

### usePageCommands

Register page-scoped commands that auto-cleanup on unmount:

```typescript
import { usePageCommands } from '@constructive-io/command-palette';

function SettingsPage({ registry }: { registry: CommandRegistryManager }) {
  // Memoize the commands array for stable references
  const commands = useMemo(() => [
    {
      id: 'settings-reset',
      label: 'Reset Settings',
      type: 'action' as const,
      group: 'actions',
      onSelect: () => resetSettings(),
    },
  ], []);

  usePageCommands(registry, commands);
  // Commands registered on mount, unregistered on unmount
}
```

### useCommandExecution

Handles all command types (navigation, action, external, multi-step, background):

```typescript
import { useCommandExecution } from '@constructive-io/command-palette';

const { execute } = useCommandExecution(navigate, onMultiStepStart, backgroundTasks);
await execute(command);
```

### useGlobalShortcuts

Single document-level keydown listener for all command shortcuts. Skips editable targets:

```typescript
import { useGlobalShortcuts } from '@constructive-io/command-palette';

// Typically used internally by CommandPalette, but can be used standalone
useGlobalShortcuts(commands, execute, enabled);
```

## CommandPalette Component

The main component wires together registry, shortcuts, multi-step, and background tasks:

```typescript
interface CommandPaletteProps {
  registry: CommandRegistryManager;
  navigate?: NavigateAdapter;         // e.g. router.push
  open?: boolean;                     // Controlled open state
  onOpenChange?: (open: boolean) => void;
  shortcut?: KeyBinding;             // Default: kbd('k', 'mod') = Cmd+K
  placeholder?: string;             // Default: 'Type a command or search...'
  backgroundTasks?: UseBackgroundTasks;
}
```

### Adapter Strategy (Framework Independence)

```typescript
// Next.js App Router
const router = useRouter();
<CommandPalette navigate={(href) => router.push(href)} />

// Plain browser
<CommandPalette navigate={(href) => window.location.assign(href)} />
```

No Next.js imports exist in the command-palette package.

## Multi-Step Commands

Wizard flows inside the palette with step-by-step data collection.

### Builder API

```typescript
import { multiStepCommand } from '@constructive-io/command-palette';

type WizardCtx = { name: string; template: string; confirmed: boolean };

const createProjectCmd = multiStepCommand<WizardCtx>({
  id: 'create-project',
  label: 'Create Project',
  group: 'actions',
  icon: FolderPlus,
})
  .step({
    id: 'name',
    title: 'Project Name',
    Component: NameStep,
  })
  .step({
    id: 'template',
    title: 'Choose Template',
    Component: TemplateStep,
    loader: async (ctx) => fetchTemplates(),  // Async data loading
    skippable: true,
  })
  .step({
    id: 'confirm',
    title: 'Confirm',
    Component: ConfirmStep,
    validate: (ctx) => ctx.name.length > 0 || 'Name is required',
  })
  .initialContext({ confirmed: false })
  .onComplete(async (ctx) => {
    await api.createProject(ctx);
  })
  .onCancel((ctx, stepIndex) => {
    console.log(`Cancelled at step ${stepIndex}`);
  })
  .build();
```

### Step Component Props

Each step receives:

```typescript
interface StepViewProps<TContext, TStepData = undefined> {
  context: Readonly<TContext>;       // Accumulated from previous steps
  data: TStepData;                   // From this step's loader
  onComplete: (output: Partial<TContext>) => void;  // Merge into context & advance
  onBack: () => void;
  onSkip: () => void;
  onError: (error: Error | string) => void;
  status: StepStatus;                // 'idle' | 'active' | 'loading' | 'error' | 'complete'
  error: Error | null;
  isFirst: boolean;
  isLast: boolean;
  stepIndex: number;
  totalSteps: number;
}
```

### Step Definition

```typescript
interface StepDefinition<TContext, TStepData = undefined> {
  id: string;
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  Component: React.ComponentType<StepViewProps<TContext, TStepData>>;
  loader?: (context: Readonly<TContext>) => Promise<TStepData>;
  validate?: (context: Readonly<TContext>) => true | string;
  skippable?: boolean;
}
```

### State Machine

Multi-step flows use a lightweight local state machine (no xstate dependency):
- Forward/backward animations via `motion/react` with directional slides
- Step indicator dots: complete = filled, active = filled + ring, error = destructive, idle = outline
- Loader effects run when a step has no cached data
- Completion effects run on last step
- Cancel aborts inflight loaders/completion

## Background Tasks

Fire-and-forget command dispatch with tracking, cancellation, and auto-dismiss.

### useBackgroundTasks Hook

```typescript
import { useBackgroundTasks } from '@constructive-io/command-palette';

const bgTasks = useBackgroundTasks({
  onTaskChange: (task) => {
    if (task.status === 'error') showErrorToast(`${task.label} failed`);
  },
  successDismissMs: 5000,     // Auto-dismiss success after 5s
  cancelledDismissMs: 3000,   // Auto-dismiss cancelled after 3s
});

// bgTasks.tasks       — sorted: running first, then by completedAt desc
// bgTasks.dispatch    — start a background task
// bgTasks.cancel      — abort via AbortController
// bgTasks.dismiss     — remove non-running tasks
// bgTasks.dismissCompleted — remove all completed tasks
```

### Background Command Definition

```typescript
{
  id: 'export-csv',
  label: 'Export as CSV',
  type: 'action',
  group: 'data',
  background: true,
  backgroundBehavior: 'close',  // or 'reset', 'persist', or callback
  onSelect: async (signal) => {
    const blob = await api.exportCsv({ signal });
    downloadBlob(blob, 'data.csv');
  },
}
```

### Background Task Components

**BackgroundTaskStack** — floating toast-style stack (bottom-right):

```tsx
<BackgroundTaskStack
  tasks={bgTasks.tasks}
  onCancel={bgTasks.cancel}
  onDismiss={bgTasks.dismiss}
/>
```

**InlineTaskBar** — compact inline indicator inside the palette (rendered automatically by `CommandPalette` when `backgroundTasks` prop is provided).

### Dual-Mode Rendering

- **Palette open**: `InlineTaskBar` renders between `CommandPanel` and `CommandFooter`
- **Palette closed**: `BackgroundTaskStack` renders as a floating stack (consumer places it)

## KbdShortcut Component

Renders a `KeyBinding` as individual `<kbd>` elements (Raycast-style):

```tsx
import { KbdShortcut } from '@constructive-io/command-palette';

<KbdShortcut binding={kbd('k', 'mod')} />
// Renders: [⌘] [K] on Mac, [Ctrl] [K] on PC
```

## UI Primitives (from @constructive-io/ui/command)

The palette renders using cmdk-backed components from the UI library:

```tsx
import {
  CommandDialog,
  CommandDialogPopup,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandFooter,
  CommandPanel,
  CommandEmpty,
  CommandShortcut,
  CommandGroupLabel,
  CommandCollection,
  Command,
} from '@constructive-io/ui/command';
```

Key behaviors:
- `onSelect` on `CommandItem` fires on both click and Enter
- Direct children pattern (no render-function callbacks, no `items` prop)
- Built-in filtering against children textContent + `keywords` prop
- `data-slot` attributes for styling hooks

### data-slot Selectors

```css
[data-slot="command-input"]       { /* search input */ }
[data-slot="command-list"]        { /* scrollable list */ }
[data-slot="command-group"]       { /* group container */ }
[data-slot="command-group-label"] { /* group heading */ }
[data-slot="command-item"]        { /* individual item */ }
[data-slot="command-shortcut"]    { /* keyboard shortcut */ }
[data-slot="command-footer"]      { /* footer area */ }
[data-slot="command-empty"]       { /* empty state */ }
[data-slot="inline-task-bar"]     { /* background tasks inline bar */ }
```

## Best Practices

1. **Organize by intent** — group commands by user goal (Navigate, Create, Settings)
2. **Use clear labels** — "Go to Dashboard" > "Dashboard"
3. **Add keywords** — include synonyms and related terms for search
4. **Limit shortcuts** — only assign to frequently-used commands
5. **Show descriptions** — add for complex or ambiguous commands
6. **Context awareness** — use `usePageCommands` for page-scoped commands
7. **Background for slow ops** — use `background: true` for exports, syncs, uploads
8. **Provide feedback** — use `onTaskChange` to fire toasts on completion/failure
9. **Memoize command arrays** — pass stable references to `usePageCommands`
