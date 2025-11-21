# prettier-lsp

A Prettier Language Server Protocol (LSP) implementation with the same performance benefits as prettierd.

## Why prettier-lsp?

prettier-lsp provides the same performance benefits as [prettierd](https://github.com/fsouza/prettierd) by:
- Running as a long-lived LSP server process
- Keeping Node.js runtime and Prettier modules cached in memory
- Avoiding startup overhead on every format request
- Supporting local prettier installations

Unlike prettierd which uses socket/daemon communication, prettier-lsp uses the standard LSP protocol, making it easier to integrate with editors that have native LSP support.

## Installation

### From npm (recommended)

```bash
npm install -g @daliusd/prettier-lsp
```

### From source

```bash
git clone https://github.com/daliusd/prettier-lsp.git
cd prettier-lsp
npm install
npm run build
npm link
```

## Features

- **LSP-based formatting**: Standard `textDocument/formatting` support
- **Diagnostic warnings**: Shows warnings when code isn't formatted according to Prettier rules
- **Local prettier resolution**: Automatically uses project-local prettier if available
- **Configuration support**: Respects `.prettierrc`, `.prettierrc.js`, etc.
- **Ignore file support**: Honors `.prettierignore` files
- **LSP settings**: Configure via standard LSP settings

## Neovim Integration

### Quick Start

Add this configuration to your `~/.config/nvim/init.lua`:

**Option 1: Always enable (uses Prettier defaults if no config found)**
```lua
-- prettier-lsp for formatting
vim.api.nvim_create_autocmd('FileType', {
  pattern = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json', 'html', 'css' },
  callback = function()
    vim.lsp.start({
      name = 'prettier-lsp',
      cmd = { 'prettier-lsp', '--stdio' },
      root_dir = vim.fs.root(0, { 'package.json', '.git' }),
    })
  end,
})
```

**Option 2: Only enable if Prettier config exists (recommended)**
```lua
-- prettier-lsp for formatting (only if prettier config exists)
vim.api.nvim_create_autocmd('FileType', {
  pattern = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'json', 'html', 'css' },
  callback = function()
    local root_dir = vim.fs.root(0, { '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.toml' })
    
    -- Only start LSP if prettier config was found
    if root_dir then
      vim.lsp.start({
        name = 'prettier-lsp',
        cmd = { 'prettier-lsp', '--stdio' },
        root_dir = root_dir,
        -- Settings are optional - sensible defaults are used if omitted
        -- Uncomment and customize as needed:
        -- settings = {
        --   prettierLsp = {
        --     localOnly = true,  -- Only use project-local prettier
        --     defaultConfig = '/path/to/default/.prettierrc',  -- Fallback config
        --     ignorePath = '.prettierignore',  -- Custom ignore file (default)
        --     editorconfig = true,  -- Respect .editorconfig (default)
        --   },
        -- },
      })
    end
  end,
})
```

### Diagnostic Warnings

prettier-lsp provides **line-specific** diagnostic warnings showing exactly which lines need formatting and what the expected format should be. This helps you identify and understand formatting issues before saving.

**How it works:**
- Uses smart diff algorithm (LCS) to accurately detect changes
- Shows warnings only on lines that actually need changes
- Handles line insertions/deletions correctly (won't flag all subsequent lines)
- Provides clear, actionable messages showing exactly what needs to change
- Updates automatically as you type
- Clears after formatting (on save with format-on-save enabled)

**Diagnostic Message Types:**

1. **Content Changes**: `Replace with: <expected line>`
   - Shows when line content needs to be modified

2. **Whitespace Issues**: `Whitespace issue. Expected: "<expected line>"`
   - Shown when only indentation/spacing changes (content is identical)

3. **Line Deletions**: `Delete line: <content>` or `Delete this blank line`
   - Indicates lines that should be removed

4. **Line Insertions**: `Insert line after this: <content>` or `Insert blank line after this`
   - Shows where new lines need to be added

**Example:**
When you have unformatted code like:
```javascript
const x = 5
function test() {
    return "hello"
}


const y = {a:1,b:2};
```

You'll see **specific warnings on each line** that needs formatting:
- Line 1: `Replace with: const x = 5;` (missing semicolon)
- Line 3: `Whitespace issue. Expected: "  return \"hello\";"` (wrong indentation)
- Line 6: `Delete this blank line` (extra blank line)
- Line 8: `Replace with: const y = { a: 1, b: 2 };` (spacing around braces)

After formatting, all diagnostics clear and your code is properly formatted!

The diagnostics will appear:
- **On specific lines** with formatting issues (not the whole file)
- In your editor's diagnostic list (`:lua vim.diagnostic.setloclist()`)
- As inline warnings showing the expected format
- In the sign column (if enabled in your config)

### Format on Save

The prettier-lsp server will automatically format files on save if you have an `LspAttach` autocmd that handles format on save. Example:

```lua
vim.api.nvim_create_autocmd('LspAttach', {
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)

    if
      client ~= nil
      and client:supports_method('textDocument/formatting')
    then
      vim.api.nvim_create_autocmd('BufWritePre', {
        buffer = args.buf,
        callback = function()
          vim.lsp.buf.format({ bufnr = args.buf, id = client.id })
        end,
      })
    end
  end,
})
```

### Configuration

#### LSP Settings (Optional)

prettier-lsp works out of the box with sensible defaults. Settings are **optional** and only needed if you want to customize behavior.

**Example with all settings:**

```lua
vim.lsp.start({
  name = 'prettier-lsp',
  cmd = { 'prettier-lsp', '--stdio' },
  root_dir = vim.fs.root(0, { '.prettierrc', '.prettierrc.js', '.prettierrc.json' }),
  settings = {
    prettierLsp = {
      localOnly = false,           -- Only use project-local prettier (default: false)
      defaultConfig = nil,          -- Path to fallback prettier config (default: nil)
      ignorePath = '.prettierignore', -- Prettier ignore file (default: '.prettierignore')
      editorconfig = true,          -- Respect .editorconfig (default: true)
    },
  },
})
```

**Available settings (all optional):**

- `localOnly` (boolean, default: `false`): If `true`, only use project-local Prettier. If no local Prettier is found, formatting will be disabled instead of falling back to bundled Prettier.

- `defaultConfig` (string, default: `nil`): Path to a default Prettier config file to use when no project config is found. Useful for enforcing a consistent style across projects.

- `ignorePath` (string, default: `'.prettierignore'`): Path to the Prettier ignore file relative to the project root.

- `editorconfig` (boolean, default: `true`): Whether to respect `.editorconfig` files when formatting.

### Configuring Diagnostics (Optional)

By default, diagnostics are enabled. You can customize how they appear in Neovim:

```lua
-- Configure diagnostic display (optional, these are good defaults)
vim.diagnostic.config({
  virtual_text = true,  -- Show inline diagnostic messages
  signs = true,         -- Show signs in the sign column
  underline = true,     -- Underline diagnostic areas
  update_in_insert = false,  -- Don't update diagnostics while typing
  severity_sort = true, -- Sort by severity
})

-- You can also filter prettier-lsp diagnostics if needed
vim.diagnostic.config({
  virtual_text = {
    source = "if_many",  -- Show source if multiple sources
  },
})
```

### Verifying It Works

**Testing Formatting:**
1. Open a JS file with messy formatting:
   ```javascript
   const x={a:1,b:2};
   const y=   {c:3,d:4};
   ```

2. You should immediately see warning diagnostics **on each line** with issues:
   - Line 1: Shows "Expected: const x = { a: 1, b: 2 };"
   - Line 2: Shows "Expected: const y = { c: 3, d: 4 };"

3. Save the file (`:w`)

4. All diagnostics clear and code is formatted:
   ```javascript
   const x = { a: 1, b: 2 };
   const y = { c: 3, d: 4 };
   ```

**Testing Diagnostics:**
- Open any unformatted JS/TS file
- You should see warning indicators on specific lines (not the whole file)
- Hover over warnings to see the expected formatted line
- Run `:lua vim.diagnostic.setloclist()` to see all diagnostics in a list
- Format the file to clear the warnings

### Checking LSP Status

Run `:LspInfo` in a JS/TS file to see if prettier-lsp is attached.

### Troubleshooting

- **Not formatting?** Check `:LspInfo` to see if prettier-lsp is attached
- **Errors?** Check `:messages` for error output
- **Wrong style?** Check if there's a `.prettierrc` in your project
- **LSP not starting?** 
  - Verify prettier-lsp is installed: `which prettier-lsp`
  - Try running manually: `prettier-lsp --stdio` (it should start and wait for input)

## How it Works

1. **Long-running process**: The LSP server stays alive between format requests
2. **Module caching**: Prettier and its dependencies remain in memory
3. **Real-time line-specific diagnostics**: 
   - Uses smart diff algorithm (LCS-based) to detect actual changes
   - Correctly handles line insertions/deletions without false positives
   - Shows warnings only on lines that actually need changes
   - Each diagnostic shows the expected formatted line
   - Updates on file open and content changes
   - Clears automatically when file is formatted
4. **Smart resolution**: 
   - Looks for prettier in your project's `node_modules` first
   - Falls back to bundled prettier if not found
   - Can be configured to only use local prettier via LSP settings
5. **Configuration resolution**: 
   - Resolves prettier config files per-file
   - Supports all prettier config formats
   - Respects `.prettierignore`

## Performance

**Why it's as fast as prettierd:**

- **Long-running process**: The LSP server doesn't exit after each format
- **Module caching**: `require()` cache keeps prettier in memory
- **No startup overhead**: Node.js stays running, no repeated initialization
- **Efficient communication**: LSP over stdio is lightweight

**Typical performance:**
- First format: ~100-200ms (loading prettier)
- Subsequent formats: ~10-50ms (everything cached)

prettier-lsp keeps the Node.js process and prettier modules in memory, so formatting should be nearly instant after the first format.

## Comparison with prettierd

| Feature | prettier-lsp | prettierd |
|---------|-------------|-----------|
| Performance | ✅ Same (long-running process) | ✅ |
| Protocol | LSP (standard) | Socket/daemon (custom) |
| Editor integration | Native LSP support | Requires adapter |
| Diagnostic warnings | ✅ Line-specific with expected format | ❌ |
| Local prettier | ✅ | ✅ |
| Config support | ✅ | ✅ |
| Ignore files | ✅ | ✅ |
| Setup complexity | Simple (just point to binary) | Socket management |

## Architecture

```
prettier-lsp/
├── src/
│   ├── server.ts       # LSP server implementation
│   ├── formatter.ts    # Prettier formatting logic
│   └── resolver.ts     # Module & config resolution
├── bin/
│   └── prettier-lsp    # Executable entry point
└── package.json
```

**Components:**

1. **LSP Server** (`server.ts`)
   - Creates LSP connection on stdin/stdout
   - Manages document synchronization
   - Handles `textDocument/formatting` requests
   - Stays alive between format requests

2. **Formatter** (`formatter.ts`)
   - Formats text using prettier
   - Generates line-by-line diagnostics comparing original vs formatted
   - Shows expected format for each problematic line
   - Checks `.prettierignore`
   - Resolves configurations per-file

3. **Resolver** (`resolver.ts`)
   - Finds prettier module (project-local or bundled)
   - Resolves prettier config files
   - Handles LSP settings

## Development

```bash
# Watch mode for development
npm run watch

# Build
npm run build

# Run tests
npm test
```

## License

ISC - Copyright (c) 2025 Dalius Dobravolskas
