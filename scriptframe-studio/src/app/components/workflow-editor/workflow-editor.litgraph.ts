import { Injectable, signal } from '@angular/core';
import { LGraph, LGraphCanvas, LGraphNode, LiteGraph, RenderShape } from '@comfyorg/litegraph';
import {
  ScriptFrameNode,
  ScriptFrameLink,
  ScriptFrameNodeType,
  ScriptFrameWorkflow,
  ComfyUINodeInput,
  ComfyUINodeOutput,
} from '../../models';

export interface LiteNodeCallbacks {
  onNodeMoved(node: ScriptFrameNode): void;
  onNodeSelected(node: ScriptFrameNode | null): void;
  onGraphChanged(): void;
  /** Called when a search-box widget wants to create a new node at a canvas position. */
  onCreateNode?(type: string, x: number, y: number): void;
}

export interface LiteNodeSelection {
  node: ScriptFrameNode | null;
  link: ScriptFrameLink | null;
}

/** Searchable palette entry shown in the double-click search box. */
export interface LitePaletteEntry {
  type: string;
  title: string;
  description?: string;
}

const NODE_COLORS: Record<ScriptFrameNodeType, { box: string; text: string; bg: string }> = {
  worker: { box: '#fcd34a', text: '#92400e', bg: '#fef3c7' }, // Amber - faded header, dark amber text
  llm: { box: '#c4b5fd', text: '#5b21b6', bg: '#f3e8ff' },         // Violet - faded header, dark violet text
  'comfyui-stack': { box: '#67e8f9', text: '#155e75', bg: '#cffafe' }, // Cyan - faded header, dark cyan text
  'comfyui-app': { box: '#5eead4', text: '#134e4a', bg: '#ccfbf1' },   // Teal - faded header, dark teal text
  start: { box: '#86efac', text: '#14532d', bg: '#dcfce7' },           // Green - workflow entry point
  'character-scene-creator': { box: '#fda4af', text: '#881337', bg: '#ffe4e6' }, // Rose - character/scene creator
};

/** Meta attached to each LiteGraph node; used to avoid mutating the underlying model on transient drags. */
export interface SfNodeMeta {
  data: ScriptFrameNode;
  fromLiteGraph: boolean;
}

function nodeBodyHeight(type: ScriptFrameNodeType, data?: ScriptFrameNode['data']): number {
  if (type === 'comfyui-stack') {
    return data?.comfyuiStackId ? 128 : 120;
  }
  if (type === 'comfyui-app') {
    return data?.comfyuiAppId ? 110 : 100;
  }
  if (type === 'llm') {
    return data?.appId ? 110 : 100;
  }
  if (type === 'worker') {
    // Worker shows LLM + ComfyUI stack ports; make it a bit taller.
    return data?.llmAppId || data?.comfyuiStackId ? 180 : 150;
  }
  if (type === 'start') {
    // Entry point: a single wildcard output port plus a short hint line.
    return 60;
  }
  if (type === 'character-scene-creator') {
    // Three data inputs + one ComfyUI stack input on the left; three outputs on the right.
    return 170;
  }
  return 62;
}

/** Small rectangular node; renders a faded color title bar with dark title text. */
class ScriptNode extends LGraphNode {
  declare meta: SfNodeMeta;

  // Dark, high-contrast text on top of the faded (light) header colors.
  static title_text_color = '#1f2937';

  override onDrawTitleBar(ctx: CanvasRenderingContext2D): void {
    const colors = this.meta?.data ? NODE_COLORS[this.meta.data.type] : undefined;
    const box = colors?.box ?? '#e2e8f0';
    const size = this.size;
    const h = LiteGraph.NODE_TITLE_HEIGHT;
    // ctx is already translated to the node's top-left; draw in local coords.
    ctx.save();
    ctx.fillStyle = box;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.roundRect(0, -h, size[0], h, 4);
    ctx.fill();
    ctx.restore();
  }

  override onDrawTitleText(ctx: CanvasRenderingContext2D): void {
    const colors = this.meta?.data ? NODE_COLORS[this.meta.data.type] : undefined;
    const size = this.size;
    const h = LiteGraph.NODE_TITLE_HEIGHT;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.font = this.titleFontStyle;
    const title = this.getTitle() ?? this.type;
    ctx.fillStyle = colors?.text ?? '#1f2937';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, h, -h / 2);
    ctx.restore();
  }

  override onDrawBackground(ctx: CanvasRenderingContext2D): void {
    const colors = this.meta?.data ? NODE_COLORS[this.meta.data.type] : undefined;
    const bg = colors?.bg ?? '#232a36';
    const size = this.size;
    const h = LiteGraph.NODE_TITLE_HEIGHT;
    // Draw the node body background (below the title bar)
    ctx.save();
    ctx.fillStyle = bg;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.roundRect(0, 0, size[0], size[1] - h, 4);
    ctx.fill();
    ctx.restore();
  }
}

@Injectable({ providedIn: 'root' })
export class WorkflowEditorLiteGraphService {
  private graph: LGraph | null = null;
  private canvas: LGraphCanvas | null = null;
  private canvasElem: HTMLCanvasElement | null = null;
  private nodeMap = new Map<string, LGraphNode>();
  private detached = new Map<string, ScriptFrameNode>();
  private callbacks: LiteNodeCallbacks | null = null;
  private suppressUiEvents = false;
  private palette: LitePaletteEntry[] = [];
  private pendingChange = false;
  readonly selection = signal<LiteNodeSelection>({ node: null, link: null });

  /** Schedules a single onGraphChanged callback per tick (drags fire it repeatedly). */
  private notifyGraphChanged(): void {
    if (this.pendingChange) return;
    this.pendingChange = true;
    queueMicrotask(() => {
      this.pendingChange = false;
      this.callbacks?.onGraphChanged();
    });
  }

  /** Provide the palette entries used by the double-click search box. */
  setPalette(palette: LitePaletteEntry[]): void {
    this.palette = palette;
    const lc = this.canvas;
    if (lc) {
      lc.onSearchBox = (helper: Element, str: string) => {
        helper.innerHTML = '';
        const q = str.toLowerCase().trim();
        const matches = this.palette.filter(
          (p) => !q || p.title.toLowerCase().includes(q) || p.type.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)
        );
        // Render entries ourselves with a click-to-create handler. Returning no
        // list prevents LiteGraph from appending its own generic placeholders.
        for (const item of matches.slice(0, 12)) {
          const help = document.createElement('div');
          help.className = 'litegraph lite-search-item';
          help.textContent = item.title;
          const typeEl = document.createElement('span');
          typeEl.className = 'litegraph lite-search-item-type';
          typeEl.textContent = item.type;
          help.append(typeEl);
          help.dataset['type'] = item.type;
          help.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.createAt(ev, item.type);
            (lc.search_box as any)?.close?.();
          });
          helper.append(help);
        }
        return undefined;
      };
      lc.onSearchBoxSelection = (_name: any, event: any) => {
        if (event?.clientX !== undefined) {
          this.createAt(event, String(_name));
        } else {
          this.callbacks?.onCreateNode?.(String(_name), 100, 100);
        }
      };
    }
  }

  /**
   * Create a node from the search box, anchored at the location the box was
   * opened (double-click) rather than the clicked list item.
   */
  private createAt(event: MouseEvent, type: string): void {
    const entry = this.palette.find((p) => p.type === type);
    if (!entry) return;
    const cv = this.canvas?.canvas;
    const lc = this.canvas;
    if (cv && lc && lc.ds) {
      const b = cv.getBoundingClientRect();
      // LiteGraph positions its search box at (event.clientX - 80, event.clientY - 20).
      // Recover the anchor (the original double-click location) from the dialog box.
      let anchorX = event.clientX;
      let anchorY = event.clientY;
      const sb = lc.search_box as HTMLElement | undefined;
      if (sb) {
        const lx = parseInt(sb.style.left || '', 10);
        const ty = parseInt(sb.style.top || '', 10);
        if (!Number.isNaN(lx)) anchorX = lx + 80;
        if (!Number.isNaN(ty)) anchorY = ty + 20;
      }
      const scale = lc.ds.scale;
      const x = (anchorX - b.left) / scale - lc.ds.offset[0];
      const y = (anchorY - b.top) / scale - lc.ds.offset[1];
      this.callbacks?.onCreateNode?.(entry.type, Math.round(x), Math.round(y));
    } else {
      this.callbacks?.onCreateNode?.(entry.type, 100, 100);
    }
  }

  setup(container: HTMLElement, callbacks: LiteNodeCallbacks): void {
    this.callbacks = callbacks;

    const canvas = document.createElement('canvas');
    canvas.id = 'scriptframe-litegraph';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '1';
    canvas.style.cursor = 'default';
    container.innerHTML = '';
    container.appendChild(canvas);
    this.canvasElem = canvas;

    const lgraph = new LGraph();
    lgraph.onNodeAdded = (node) => this.handleNodeAdded(node);
    lgraph.onNodeRemoved = (node) => this.handleNodeRemoved(node);
    this.graph = lgraph;

    const lcanvas = new LGraphCanvas(canvas, lgraph);
    lcanvas.background_image = '';
    lcanvas.allow_dragnodes = true;
    lcanvas.allow_dragcanvas = true;
    lcanvas.drag_mode = true;
    lcanvas.read_only = false;
    lcanvas.autoresize = true;
    lcanvas.setDirty(true, true);
    this.canvas = lcanvas;

    // Selection sync
    lcanvas.onNodeSelected = (node) => {
      const meta = (node as any).meta as SfNodeMeta | undefined;
      if (!meta) return;
      this.selection.set({ node: meta.data, link: null });
      this.callbacks?.onNodeSelected(meta.data);
    };
    lcanvas.onNodeDeselected = () => {
      // Only fire if nothing else is selected (deselectAll or click on empty canvas)
      if (lcanvas.selectedItems?.size === 0) {
        this.selection.set({ node: null, link: null });
        this.callbacks?.onNodeSelected(null);
      }
    };
    lcanvas.onAfterChange = () => {
      this.syncNodePositions();
      this.notifyGraphChanged();
    };
    lcanvas.onNodeMoved = (node_dragged) => {
      if (this.suppressUiEvents) return;
      this.syncNodePositions();
      const meta = (node_dragged as any)?.meta as SfNodeMeta | undefined;
      if (meta?.data) {
        this.callbacks?.onNodeMoved(meta.data);
      }
      this.notifyGraphChanged();
    };

    LiteGraph.NODE_TITLE_HEIGHT = 28;
    LiteGraph.NODE_SLOT_HEIGHT = 20;
    LiteGraph.NODE_WIDTH = 220;
    LiteGraph.NODE_MIN_WIDTH = 160;
    LiteGraph.NODE_DEFAULT_SHAPE = RenderShape.BOX;
    LiteGraph.ROUND_RADIUS = 4;
    LiteGraph.NODE_DEFAULT_BGCOLOR = '#1e1e24'; // Dark fallback for unknown nodes
    LiteGraph.NODE_DEFAULT_COLOR = '#1e1e24'; // Text color for title
    LiteGraph.NODE_DEFAULT_BOXCOLOR = '#778';
    LiteGraph.NODE_TITLE_COLOR = '#1f2937'; // Dark title text on the faded (light) header colors
    // Socket/port label text: dark for readability on the faded (light) node bodies.
    LiteGraph.NODE_TEXT_COLOR = '#1f2937';
    LiteGraph.NODE_TEXT_HIGHLIGHT_COLOR = '#111827';
    LiteGraph.NODE_SELECTED_TITLE_COLOR = '#0f172a';
    LiteGraph.CANVAS_GRID_SIZE = 20;

    // Match the backing store to the container so nodes render at full resolution.
    try { lcanvas.resize(); } catch { /* ignore */ }
    requestAnimationFrame(() => {
      try { lcanvas.resize(); } catch { /* ignore */ }
      lcanvas.setDirty(true, true);
    });

    this.suppressUiEvents = false;
    this.selection.set({ node: null, link: null });
  }

  destroy(): void {
    if (this.graph) {
      try { this.graph.clear(); } catch { /* ignore */ }
      this.graph = null;
    }
    if (this.canvas) {
      try { this.canvas.clear(); } catch { /* ignore */ }
      this.canvas = null;
    }
    this.canvasElem?.remove();
    this.canvasElem = null;
    this.nodeMap.clear();
    this.detached.clear();
    this.suppressUiEvents = false;
    this.selection.set({ node: null, link: null });
  }

  /** Rebuild every node + link from the workflow model. */
  syncFromWorkflow(workflow: ScriptFrameWorkflow): void {
    if (!this.graph) return;
    this.suppressUiEvents = true;
    try {
      for (const node of workflow.nodes) {
        this.createOrSyncNode(node);
      }
      this.rebuildLinks(workflow.links || []);
    } finally {
      this.suppressUiEvents = false;
    }
  }

  private createOrSyncNode(sf: ScriptFrameNode): void {
    const existing = this.nodeMap.get(sf.id);
    if (existing) {
      (existing as any).meta.data = sf;
      this.applyNodeState(existing, sf);
      existing.pos = [sf.position.x, sf.position.y];
      return;
    }
    const node = this.createNode(sf);
    if (node) {
      this.graph?.add(node);
      this.nodeMap.set(sf.id, node);
    }
  }

  createNode(sf: ScriptFrameNode): LGraphNode | null {
    if (!this.graph) return null;
    const node = new ScriptNode(sf.title || sf.type, 'sf-node');
    node.meta = { data: sf, fromLiteGraph: false };
    this.applyNodeState(node, sf);
    node.pos = [sf.position.x, sf.position.y];
    return node;
  }

  /** Add a brand-new node (e.g. from palette) to the graph. */
  addNode(sf: ScriptFrameNode): void {
    if (!this.graph) return;
    const node = this.createNode(sf);
    if (node) {
      this.graph.add(node);
      this.nodeMap.set(sf.id, node);
    }
  }

  removeNode(sfId: string): void {
    const node = this.nodeMap.get(sfId);
    if (!node) return;
    if (this.graph) this.graph.remove(node);
    this.nodeMap.delete(sfId);
  }

  removeLink(sfLink: ScriptFrameLink): void {
    const source = this.nodeMap.get(sfLink.sourceNodeId);
    const target = this.nodeMap.get(sfLink.targetNodeId);
    if (!source || !target) return;
    const outputIndex = source.outputs.findIndex((o) => o.name === sfLink.sourceOutputName);
    const inputIndex = target.inputs.findIndex((i) => i.name === sfLink.targetInputName);
    if (inputIndex >= 0) {
      target.disconnectInput(inputIndex, true);
    }
    if (outputIndex >= 0) {
      try { source.disconnectOutput(outputIndex); } catch { /* ignore */ }
    }
  }

  /** Clear and reload from a workflow model (open / import / new). */
  loadWorkflow(workflow: ScriptFrameWorkflow): void {
    if (!this.graph) return;
    this.suppressUiEvents = true;
    try {
      this.graph.clear();
      this.nodeMap.clear();
      this.detached.clear();
    } finally {
      this.suppressUiEvents = false;
    }
    this.syncFromWorkflow(workflow);
  }

  setZoomRange(min: number, max: number): void {
    const lc = this.canvas;
    if (!lc || !lc.ds) return;
    lc.ds.max_scale = max;
    lc.ds.min_scale = min;
  }

  /** Zooms the current canvas by a factor around the canvas center. */
  zoomBy(factor: number): void {
    const lc = this.canvas;
    if (!lc || !lc.ds) return;
    try {
      lc.setZoom(lc.ds.scale * factor, [lc.canvas.width / 2, lc.canvas.height / 2]);
    } catch {
      /* ignore */
    }
    lc.setDirty(true, true);
  }

  /** Resets the viewport to identity (scale 1, no offset). */
  resetView(): void {
    const lc = this.canvas;
    if (!lc || !lc.ds) return;
    lc.ds.offset[0] = 0;
    lc.ds.offset[1] = 0;
    lc.ds.scale = 1;
    lc.setDirty(true, true);
  }

  /** Exposes the current viewport (scale + offset) so host components can map drop coordinates. */
  getCanvasState(): { scale: number; offset: [number, number] } {
    const ds = this.canvas?.ds;
    return { scale: ds?.scale ?? 1, offset: ds ? [ds.offset[0], ds.offset[1]] : [0, 0] };
  }

  centerOnAll(): void {
    try { this.canvas?.draw(true, true); } catch { /* ignore */ }
  }

  clearSelection(): void {
    const lc = this.canvas;
    if (lc) {
      try { lc.deselectAll?.(); } catch { /* ignore */ }
    }
    this.selection.set({ node: null, link: null });
  }

  private buildOutputs(node: LGraphNode, sf: ScriptFrameNode): void {
    for (const out of [...(node.outputs || [])]) {
      node.removeOutput(node.outputs.indexOf(out));
    }
    const colors = NODE_COLORS[sf.type];
    for (const out of sf.outputs || []) {
      node.addOutput(out.name, (out.type as any) || '*', {
        color: colors.box,
        color_off: colors.box,
        color_on: colors.box,
      } as any);
    }
  }

  private buildInputs(node: LGraphNode, sf: ScriptFrameNode): void {
    for (const input of [...(node.inputs || [])]) {
      node.removeInput(node.inputs.indexOf(input));
    }
    const colors = NODE_COLORS[sf.type];
    for (const input of sf.inputs || []) {
      node.addInput(input.name, (input.type as any) || '*', {
        color: colors.box,
        color_off: colors.box,
        color_on: colors.box,
      } as any);
    }
  }

  private applyNodeState(node: LGraphNode, sf: ScriptFrameNode): void {
    node.title = sf.title || sf.type;
    // No mandatory nodes (start/end were removed); all nodes can be deleted.
    node.block_delete = false;
    const prevOutputs = node.outputs?.length ?? 0;
    const prevInputs = node.inputs?.length ?? 0;
    this.buildInputs(node, sf);
    this.buildOutputs(node, sf);
    const didSlotChange = prevInputs !== (node.inputs?.length ?? 0) || prevOutputs !== (node.outputs?.length ?? 0);
    if (didSlotChange || !(node as any)._sfSized) {
      const height = nodeBodyHeight(sf.type, sf.data);
      node.size = [220, 28 + height];
      (node as any)._sfSized = true;
    }
  }

  /** Update a single node (used by property panel data changes). */
  updateNode(sf: ScriptFrameNode): void {
    const node = this.nodeMap.get(sf.id);
    if (!node) return;
    (node as any).meta.data = sf;
    this.applyNodeState(node, sf);
  }

  private rebuildLinks(links: ScriptFrameLink[]): void {
    for (const node of this.nodeMap.values()) {
      for (const input of node.inputs || []) {
        if (input.link != null) {
          try { node.disconnectInput(node.inputs.indexOf(input), true); } catch { /* ignore */ }
        }
      }
    }
    for (const link of links) {
      this.connect(link);
    }
  }

  /** Push current LiteGraph positions back into the cached model nodes. */
  syncNodePositions(): void {
    for (const n of this.graph?._nodes ?? []) {
      const meta = (n as any).meta as SfNodeMeta | undefined;
      if (!meta) continue;
      meta.data = {
        ...meta.data,
        position: { x: Math.round(n.pos[0]), y: Math.round(n.pos[1]) },
      };
    }
  }

  private connect(link: ScriptFrameLink): void {
    const source = this.nodeMap.get(link.sourceNodeId);
    const target = this.nodeMap.get(link.targetNodeId);
    if (!source || !target) return;
    const outputIndex = source.outputs.findIndex((o) => o.name === link.sourceOutputName);
    const inputIndex = target.inputs.findIndex((i) => i.name === link.targetInputName);
    if (outputIndex < 0 || inputIndex < 0) return;
    try {
      source.connect(outputIndex, target, inputIndex);
    } catch { /* ignore */ }
  }

  /** Snapshot the current graph into ScriptFrame node/link model shape. */
  getSnapshot(workflow: ScriptFrameWorkflow): { nodes: ScriptFrameNode[]; links: ScriptFrameLink[] } {
    const nodes: ScriptFrameNode[] = [];
    const links: ScriptFrameLink[] = [];

    for (const sf of this.detached.values()) {
      nodes.push(sf);
    }

    for (const n of this.graph?._nodes ?? []) {
      const meta = (n as any).meta as SfNodeMeta | undefined;
      if (!meta) continue;
      const base = meta.data;
      const node: ScriptFrameNode = {
        id: base.id,
        type: base.type,
        title: (n as any).title ?? base.title,
        position: { x: Math.round(n.pos[0]), y: Math.round(n.pos[1]) },
        inputs: (n.inputs || []).map((inp: any) => {
          const original = (base.inputs || []).find((i) => i.name === inp.name);
          const out: ComfyUINodeInput = {
            name: inp.name,
            type: inp.type || original?.type || '*',
            link: inp.link ?? null,
          };
          if (inp.link != null) {
            const link = this.graph?._links?.get(inp.link);
            const srcNode = link ? this.graph?._nodes_by_id[String(link.origin_id)] : undefined;
            const srcOutput = srcNode?.outputs?.[(link as any).origin_slot as number];
            const srcBase = (srcNode as any)?.meta?.data as ScriptFrameNode | undefined;
            out.linkedNodeId = srcBase?.id ?? null;
            out.linkedOutputName = srcOutput?.name ?? null;
          }
          return out;
        }),
        outputs: (n.outputs || []).map((outp: any) => ({
          name: outp.name,
          type: outp.type || '*',
          links: (outp.links || []).slice() as number[],
        })),
        data: base.data ? { ...base.data } : undefined,
      };
      nodes.push(node);
    }

    const sfNodes = new Map(nodes.map((n) => [n.id, n]));
    const usedLinkIds = new Set<number>();
    const graphLinks: any[] = [];
    this.graph?._links?.forEach((l: any) => graphLinks.push(l));

    for (const l of graphLinks) {
      const from = this.graph?._nodes_by_id[String(l.origin_id)];
      const to = this.graph?._nodes_by_id[String(l.target_id)];
      const fromMeta = (from as any)?.meta?.data as ScriptFrameNode | undefined;
      const toMeta = (to as any)?.meta?.data as ScriptFrameNode | undefined;
      if (!fromMeta || !toMeta) continue;
      const fromOut = from?.outputs?.[l.origin_slot as number];
      const toIn = to?.inputs?.[l.target_slot as number];
      if (!fromOut || !toIn) continue;
      const id = typeof l.id === 'number' ? l.id : usedLinkIds.size + 1;
      if (usedLinkIds.has(id)) continue;
      usedLinkIds.add(id);
      const srcSf = sfNodes.get(fromMeta.id);
      const dstSf = sfNodes.get(toMeta.id);
      links.push({
        id,
        sourceNodeId: fromMeta.id,
        sourceOutputName: srcSf?.outputs?.[l.origin_slot as number]?.name ?? fromOut.name,
        targetNodeId: toMeta.id,
        targetInputName: dstSf?.inputs?.[l.target_slot as number]?.name ?? toIn.name,
      });
    }

    return { nodes, links };
  }

  hasNode(sfId: string): boolean {
    return this.nodeMap.has(sfId);
  }

  private handleNodeAdded(node: LGraphNode): void {
    if (this.suppressUiEvents) return;
    const meta = (node as any).meta as SfNodeMeta | undefined;
    if (!meta?.data) return;
    if (!this.nodeMap.has(meta.data.id)) this.nodeMap.set(meta.data.id, node);
    this.notifyGraphChanged();
  }

  private handleNodeRemoved(node: LGraphNode): void {
    if (this.suppressUiEvents) return;
    const meta = (node as any).meta as SfNodeMeta | undefined;
    if (!meta?.data) return;
    this.nodeMap.delete(meta.data.id);
    this.detached.delete(meta.data.id);
    this.notifyGraphChanged();
  }
}
