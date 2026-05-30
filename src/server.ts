import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  DocumentFormattingParams,
  TextEdit,
  Diagnostic,
  DiagnosticSeverity,
  DocumentRangeFormattingParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  FormatOptions,
  formatText,
  getFormattingDiagnostics,
} from './formatter';

// Settings interface
interface PrettierLspSettings {
  localOnly?: boolean;
  defaultConfig?: string;
  ignorePath?: string;
  editorconfig?: boolean;
  validate?: {
    enable: boolean;
  };
}

// Create LSP connection
const connection = createConnection(ProposedFeatures.all);

// Create document manager
const documents = new TextDocuments(TextDocument);

// Workspace root directory
let workspaceRoot: string | undefined;

// Default settings
const defaultSettings: PrettierLspSettings = {
  localOnly: false,
  defaultConfig: undefined,
  ignorePath: '.prettierignore',
  editorconfig: true,
  validate: {
    enable: true,
  },
};

// Server settings
let hasConfigurationCapability = false;
let globalSettings: PrettierLspSettings = { ...defaultSettings };
const documentSettings = new Map<string, Thenable<PrettierLspSettings>>();

// Initialize handler
connection.onInitialize((params: InitializeParams) => {
  // Use workspaceFolders (preferred) or fall back to rootPath
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    workspaceRoot = params.workspaceFolders[0].uri.replace(/^file:\/\//, '');
  } else if (params.rootPath) {
    workspaceRoot = params.rootPath;
  } else {
    workspaceRoot = process.cwd();
  }

  const capabilities = params.capabilities;

  // Check if client supports workspace/configuration
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
    },
    serverInfo: {
      name: 'prettier-lsp',
      version: '0.5.0',
    },
  };

  return result;
});

// Settings helpers
async function getDocumentSettings(
  resource: string,
): Promise<PrettierLspSettings> {
  if (!hasConfigurationCapability) {
    return globalSettings;
  }

  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'prettierLsp',
    });
    documentSettings.set(resource, result);
  }

  // Ensure we have defaults for any missing values
  const settings = await result;

  // Handle case where settings is null or undefined
  if (!settings || typeof settings !== 'object') {
    return { ...defaultSettings };
  }

  return {
    localOnly: settings.localOnly ?? defaultSettings.localOnly,
    defaultConfig: settings.defaultConfig ?? defaultSettings.defaultConfig,
    ignorePath: settings.ignorePath ?? defaultSettings.ignorePath,
    editorconfig: settings.editorconfig ?? defaultSettings.editorconfig,
    validate: settings.validate ?? defaultSettings.validate,
  };
}

// Clear settings cache when configuration changes
connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentSettings.clear();
  } else {
    // Merge incoming settings with defaults
    const incomingSettings = change.settings.prettierLsp || {};
    globalSettings = {
      localOnly: incomingSettings.localOnly ?? defaultSettings.localOnly,
      defaultConfig:
        incomingSettings.defaultConfig ?? defaultSettings.defaultConfig,
      ignorePath: incomingSettings.ignorePath ?? defaultSettings.ignorePath,
      editorconfig:
        incomingSettings.editorconfig ?? defaultSettings.editorconfig,
      validate: incomingSettings.validate ?? defaultSettings.editorconfig,
    };
  }

  // Refresh all open documents
  documents.all().forEach(validateDocument);
});

// Clear document settings on close
documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
});

// Build format options from settings (settings already have defaults applied)
function buildFormatOptions(settings: PrettierLspSettings) {
  // Extra safety: handle null/undefined settings
  if (!settings || typeof settings !== 'object') {
    return {
      localOnly: defaultSettings.localOnly,
      defaultConfig: defaultSettings.defaultConfig,
      ignorePath: defaultSettings.ignorePath,
      editorconfig: defaultSettings.editorconfig,
    };
  }

  return {
    localOnly: settings.localOnly ?? defaultSettings.localOnly,
    defaultConfig: settings.defaultConfig ?? defaultSettings.defaultConfig,
    ignorePath: settings.ignorePath ?? defaultSettings.ignorePath,
    editorconfig: settings.editorconfig ?? defaultSettings.editorconfig,
  };
}

function minimalEdit(document: TextDocument, formatted: string): TextEdit {
  const text = document.getText();

  // length of common prefix
  let i = 0;
  while (i < text.length && i < formatted.length && text[i] === formatted[i]) {
    ++i;
  }
  // length of common suffix
  let j = 0;
  while (
    i + j < text.length &&
    i + j < formatted.length &&
    text[text.length - j - 1] === formatted[formatted.length - j - 1]
  ) {
    ++j;
  }
  const newText = formatted.substring(i, formatted.length - j);
  const start = document.positionAt(i);
  const end = document.positionAt(text.length - j);

  return TextEdit.replace({ start, end }, newText);
}

// Validate document and send diagnostics
async function validateDocument(document: TextDocument): Promise<void> {
  const diagnostics: Diagnostic[] = [];

  try {
    const settings = await getDocumentSettings(document.uri);
    if (!settings.validate?.enable) {
      return;
    }
    const options = buildFormatOptions(settings);

    const text = document.getText();

    const formattingIssues = await getFormattingDiagnostics(
      document.uri,
      text,
      workspaceRoot || process.cwd(),
      options,
    );

    for (const issue of formattingIssues) {
      const lineText = document.getText({
        start: { line: issue.line, character: 0 },
        end: { line: issue.line + 1, character: 0 },
      });

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: issue.line, character: 0 },
          end: { line: issue.line, character: lineText.trimEnd().length },
        },
        message: issue.message,
        source: 'prettier-lsp',
      });
    }
  } catch (error) {
    // Don't send diagnostics on error
    connection.console.error(`Diagnostic error: ${error}`);
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// Document formatting handler
connection.onDocumentFormatting(
  async (params: DocumentFormattingParams): Promise<TextEdit[] | null> => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    try {
      const text = document.getText();
      const settings = await getDocumentSettings(document.uri);
      const options = buildFormatOptions(settings);

      const formatted = await formatText(
        params.textDocument.uri,
        text,
        workspaceRoot || process.cwd(),
        options,
      );

      if (formatted === null || formatted === text) {
        return null;
      }

      // Return the full document replacement
      return [
        TextEdit.replace(
          {
            start: { line: 0, character: 0 },
            end: {
              line: document.lineCount,
              character: 0,
            },
          },
          formatted,
        ),
      ];
    } catch (error) {
      connection.console.error(`Formatting error: ${error}`);
      return null;
    }
  },
);
connection.onDocumentRangeFormatting(
  async (params: DocumentRangeFormattingParams): Promise<TextEdit[] | null> => {
    connection.console.log('onDocumentRangeFormatting');

    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    try {
      const text = document.getText();
      const settings = await getDocumentSettings(document.uri);
      const options = buildFormatOptions(settings);
      const rangeStart = document.offsetAt(params.range.start);
      const rangeEnd = document.offsetAt(params.range.end);

      const formatted = await formatText(
        params.textDocument.uri,
        text,
        workspaceRoot || process.cwd(),
        options,
        { rangeStart, rangeEnd },
      );

      if (formatted === null || formatted === text) {
        return null;
      }
      return [minimalEdit(document, formatted)];
    } catch (error) {
      connection.console.error(`Formatting error: ${error}`);
      return null;
    }
  },
);

// Validate on document open
documents.onDidOpen((event) => {
  validateDocument(event.document);
});

// Validate on document change
documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

// Clear diagnostics on document close
documents.onDidClose((event) => {
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

// Log startup (stderr is safe for LSP)
connection.onInitialized(() => {
  connection.console.info('Prettier LSP server initialized');
});
