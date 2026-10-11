/**
 * Inline verdicts: after a dry-run, show what each statement did at the end of its
 * line in the editor. Cleared as soon as the document is edited (they'd be stale).
 * Logic for labels and line mapping lives in src/ottl/inline.ts.
 */

import * as vscode from "vscode";
import type { InlineKind, InlineVerdict } from "./ottl/inline";

const COLORS: Record<InlineKind, vscode.ThemeColor> = {
  "changed": new vscode.ThemeColor("testing.iconPassed"),
  "no-effect": new vscode.ThemeColor("editorWarning.foreground"),
  "not-matched": new vscode.ThemeColor("descriptionForeground"),
  "error": new vscode.ThemeColor("editorError.foreground"),
};

export class InlineVerdicts implements vscode.Disposable {
  private readonly types = new Map<InlineKind, vscode.TextEditorDecorationType>();
  private readonly shown = new Map<string, InlineVerdict[]>(); // by document URI
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor() {
    for (const kind of Object.keys(COLORS) as InlineKind[]) {
      this.types.set(kind, vscode.window.createTextEditorDecorationType({
        after: { color: COLORS[kind], margin: "0 0 0 2em", fontStyle: "italic" },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      }));
    }
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length > 0) this.clear(e.document.uri);
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.repaint()),
    );
  }

  show(uri: vscode.Uri, verdicts: InlineVerdict[]): void {
    this.shown.set(uri.toString(), verdicts);
    this.repaint();
  }

  clear(uri: vscode.Uri): void {
    if (this.shown.delete(uri.toString())) this.repaint();
  }

  private repaint(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const verdicts = this.shown.get(editor.document.uri.toString()) ?? [];
      for (const [kind, type] of this.types) {
        const options: vscode.DecorationOptions[] = verdicts
          .filter((v) => v.kind === kind && v.line < editor.document.lineCount)
          .map((v) => {
            const end = editor.document.lineAt(v.line).range.end;
            return {
              range: new vscode.Range(end, end),
              hoverMessage: new vscode.MarkdownString(v.detail),
              renderOptions: { after: { contentText: v.label } },
            };
          });
        editor.setDecorations(type, options);
      }
    }
  }

  dispose(): void {
    for (const t of this.types.values()) t.dispose();
    this.subscriptions.forEach((s) => s.dispose());
  }
}
