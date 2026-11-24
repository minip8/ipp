/**
 * Two-way binding between a Y.Text and a Monaco model, plus remote cursors from Yjs awareness.
 * Adapted from the approach of y-monaco (which imports the bundled monaco-editor and so cannot
 * be used with the AMD build we load at runtime).
 */
import type * as MonacoNS from 'monaco-editor';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { presenceUser } from '../yjs-guards';
import type { Monaco } from './monaco-loader';

type Editor = MonacoNS.editor.IStandaloneCodeEditor;

export type PresenceUser = { name: string; color: string; userId?: string };
type RelSel = { anchor: unknown; head: unknown; buffer: string };

export const cssString = (s: string) =>
  `"${s
    .slice(0, 40)
    .replace(/[\\"]/g, '\\$&')
    .replace(/[\n\r\f]/g, ' ')}"`;

export class MonacoBinding {
  private mux = false;
  private savedSelections = new Map<
    Editor,
    { start: Y.RelativePosition; end: Y.RelativePosition; dir: MonacoNS.SelectionDirection } | null
  >();
  private decorations = new Map<Editor, MonacoNS.editor.IEditorDecorationsCollection>();
  private disposables: { dispose(): void }[] = [];
  private styleEl: HTMLStyleElement | null = null;
  readonly undoManager: Y.UndoManager;

  constructor(
    private readonly monaco: Monaco,
    private readonly ytext: Y.Text,
    private readonly model: MonacoNS.editor.ITextModel,
    private readonly editor: Editor,
    private readonly awareness: Awareness | null,
    private readonly bufferName: string,
  ) {
    const doc = ytext.doc;
    if (!doc) throw new Error('Y.Text is not attached to a document');
    this.undoManager = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([this]),
      captureTimeout: 400,
    });

    if (model.getValue() !== ytext.toString()) {
      this.mux = true;
      model.setValue(ytext.toString());
      this.mux = false;
    }

    doc.on('beforeAllTransactions', this.beforeAllTransactions);
    ytext.observe(this.onYText);
    this.disposables.push(
      model.onDidChangeContent((e) => {
        if (this.mux) return;
        this.mux = true;
        try {
          doc.transact(() => {
            [...e.changes]
              .sort((a, b) => b.rangeOffset - a.rangeOffset)
              .forEach((c) => {
                ytext.delete(c.rangeOffset, c.rangeLength);
                ytext.insert(c.rangeOffset, c.text);
              });
          }, this);
        } finally {
          this.mux = false;
        }
      }),
      model.onWillDispose(() => this.destroy()),
    );

    if (awareness) {
      this.styleEl = document.createElement('style');
      document.head.appendChild(this.styleEl);
      this.disposables.push(editor.onDidChangeCursorSelection(() => this.publishSelection()));
      this.disposables.push(editor.onDidBlurEditorText(() => this.publishSelection()));
      awareness.on('change', this.renderRemote);
      this.publishSelection();
      this.renderRemote();
    }
  }

  private beforeAllTransactions = () => {
    if (this.mux) return;
    this.savedSelections = new Map();
    const sel = this.editor.getSelection();
    if (sel && this.editor.getModel() === this.model) {
      const start = Y.createRelativePositionFromTypeIndex(
        this.ytext,
        this.model.getOffsetAt(sel.getStartPosition()),
      );
      const end = Y.createRelativePositionFromTypeIndex(
        this.ytext,
        this.model.getOffsetAt(sel.getEndPosition()),
      );
      this.savedSelections.set(this.editor, { start, end, dir: sel.getDirection() });
    }
  };

  private onYText = (event: Y.YTextEvent) => {
    if (this.mux) return;
    this.mux = true;
    try {
      let index = 0;
      const edits: MonacoNS.editor.IIdentifiedSingleEditOperation[] = [];
      // Apply ops one by one so positions are computed on the evolving model.
      for (const op of event.delta) {
        if (op.retain !== undefined) {
          index += op.retain;
        } else if (op.insert !== undefined) {
          const text = typeof op.insert === 'string' ? op.insert : '';
          const pos = this.model.getPositionAt(index);
          edits.length = 0;
          edits.push({
            range: new this.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text,
          });
          this.model.applyEdits(edits);
          index += text.length;
        } else if (op.delete !== undefined) {
          const a = this.model.getPositionAt(index);
          const b = this.model.getPositionAt(index + op.delete);
          this.model.applyEdits([
            {
              range: new this.monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column),
              text: '',
            },
          ]);
        }
      }
      const saved = this.savedSelections.get(this.editor);
      const doc = this.ytext.doc;
      if (saved && doc) {
        const s = Y.createAbsolutePositionFromRelativePosition(saved.start, doc);
        const e = Y.createAbsolutePositionFromRelativePosition(saved.end, doc);
        if (s && e) {
          const sp = this.model.getPositionAt(s.index);
          const ep = this.model.getPositionAt(e.index);
          const sel =
            saved.dir === this.monaco.SelectionDirection.LTR
              ? new this.monaco.Selection(sp.lineNumber, sp.column, ep.lineNumber, ep.column)
              : new this.monaco.Selection(ep.lineNumber, ep.column, sp.lineNumber, sp.column);
          this.editor.setSelection(sel);
        }
      }
    } finally {
      this.mux = false;
    }
    this.renderRemote();
  };

  private publishSelection() {
    const aw = this.awareness;
    if (!aw) return;
    const sel = this.editor.getSelection();
    if (!sel || this.editor.getModel() !== this.model) return;
    const anchor = Y.createRelativePositionFromTypeIndex(
      this.ytext,
      this.model.getOffsetAt(sel.getSelectionStart()),
    );
    const head = Y.createRelativePositionFromTypeIndex(
      this.ytext,
      this.model.getOffsetAt(sel.getPosition()),
    );
    const value: RelSel = {
      anchor: Y.relativePositionToJSON(anchor),
      head: Y.relativePositionToJSON(head),
      buffer: this.bufferName,
    };
    aw.setLocalStateField('selection', value);
  }

  private renderRemote = () => {
    const aw = this.awareness;
    const doc = this.ytext.doc;
    if (!aw || !doc) return;
    const decos: MonacoNS.editor.IModelDeltaDecoration[] = [];
    const css: string[] = [];
    aw.getStates().forEach((state, clientId) => {
      if (clientId === doc.clientID) return;
      const sel = state.selection as RelSel | undefined;
      const user = presenceUser(state.user);
      if (!sel || typeof sel !== 'object' || sel.buffer !== this.bufferName) return;
      let anchor: Y.AbsolutePosition | null = null;
      let head: Y.AbsolutePosition | null = null;
      try {
        anchor = Y.createAbsolutePositionFromRelativePosition(
          Y.createRelativePositionFromJSON(sel.anchor),
          doc,
        );
        head = Y.createAbsolutePositionFromRelativePosition(
          Y.createRelativePositionFromJSON(sel.head),
          doc,
        );
      } catch {
        return;
      }
      if (!anchor || !head || anchor.type !== this.ytext || head.type !== this.ytext) return;
      // presenceUser() guarantees a #rrggbb colour and a string name.
      const color = user?.color ?? '#8b5cf6';
      const name = user?.name ?? 'Guest';
      css.push(
        `.yRemoteSelection-${clientId}{background-color:${color}33}`,
        `.yRemoteSelectionHead-${clientId}{border-left:2px solid ${color};position:relative}`,
        `.yRemoteSelectionHead-${clientId}::after{content:${cssString(name)};background:${color}}`,
      );
      const a = this.model.getPositionAt(anchor.index);
      const h = this.model.getPositionAt(head.index);
      const [start, end] = anchor.index <= head.index ? [a, h] : [h, a];
      if (anchor.index !== head.index) {
        decos.push({
          range: new this.monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: { className: `yRemoteSelection yRemoteSelection-${clientId}`, stickiness: 1 },
        });
      }
      decos.push({
        range: new this.monaco.Range(h.lineNumber, h.column, h.lineNumber, h.column),
        options: {
          beforeContentClassName: `yRemoteSelectionHead yRemoteSelectionHead-${clientId}`,
          stickiness: 1,
        },
      });
    });
    if (this.styleEl) this.styleEl.textContent = css.join('\n');
    let coll = this.decorations.get(this.editor);
    if (!coll) {
      coll = this.editor.createDecorationsCollection();
      this.decorations.set(this.editor, coll);
    }
    if (this.editor.getModel() === this.model) coll.set(decos);
  };

  private destroyed = false;

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.ytext.unobserve(this.onYText);
    this.ytext.doc?.off('beforeAllTransactions', this.beforeAllTransactions);
    this.awareness?.off('change', this.renderRemote);
    for (const d of this.decorations.values()) d.clear();
    this.styleEl?.remove();
    this.undoManager.destroy();
  }
}
