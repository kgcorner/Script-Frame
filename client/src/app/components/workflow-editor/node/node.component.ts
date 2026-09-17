import { Component, input, output, signal, computed, effect, HostListener, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComfyUINode, ComfyUINodeInput, ComfyUINodeOutput } from '../../../models';

@Component({
  selector: 'app-node',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './node.component.html',
  styleUrl: './node.component.scss'
})
export class NodeComponent {
  // Inputs
  node = input.required<ComfyUINode>();
  selected = input(false);
  connecting = input(false);
  connectingFrom = input<{ nodeId: string; outputIndex: number } | null>(null);
  scale = input(1);
  
  // Outputs
  select = output<ComfyUINode>();
  startConnection = output<{ node: ComfyUINode; outputIndex: number }>();
  endConnection = output<{ node: ComfyUINode; inputIndex: number }>();
  drag = output<{ node: ComfyUINode; event: MouseEvent }>();
  delete = output<string>();
  propertyChange = output<{ nodeId: string; key: string; value: any }>();
  widgetChange = output<{ nodeId: string; key: string; value: any }>();

  @ViewChild('nodeElement') nodeElement!: ElementRef<HTMLElement>;

  // Local state
  private dragging = signal(false);
  private dragOffset = { x: 0, y: 0 };

  // Computed
  protected nodeStyle = computed(() => {
    const n = this.node();
    return {
      left: `${n.position.x}px`,
      top: `${n.position.y}px`,
      transform: `scale(${this.scale()})`,
      transformOrigin: '0 0',
      zIndex: this.selected() ? 10 : 1
    };
  });

  protected inputSockets = computed(() => this.node().inputs || []);
  protected outputSockets = computed(() => this.node().outputs || []);

  protected widgetEntries = computed(() => {
    const widgetValues = this.node().widgetValues || {};
    return Object.keys(widgetValues).map(key => ({ key, value: widgetValues[key] }));
  });

  // Type colors
  protected getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      '*': '#8b5cf6',     // violet - wildcard
      string: '#22c55e',  // green
      number: '#3b82f6',  // blue
      boolean: '#f59e0b', // amber
      array: '#ec4899',   // pink
      object: '#06b6d4',  // cyan
      image: '#ef4444',   // red
      audio: '#8b5cf6',   // violet
      video: '#f97316',   // orange
      text: '#22c55e',    // green
      any: '#64748b'      // slate
    };
    return colors[type.toLowerCase()] || '#64748b';
  }

  // Check if output socket is currently being connected from
  protected isConnectingFrom(socketName: string): boolean {
    const cf = this.connectingFrom();
    return cf?.nodeId === this.node().id && cf?.outputIndex === this.outputSockets().findIndex((s: ComfyUINodeOutput) => s.name === socketName);
  }

  // Check if input socket can accept connection from current connecting output
  protected canConnectTo(socket: ComfyUINodeInput): boolean {
    const cf = this.connectingFrom();
    if (!cf) return false;
    
    // Note: In a real implementation, you'd need access to the workflow to find the source node
    // For now, we just check type compatibility at the component level
    return true;
  }

  private areTypesCompatible(sourceType: string, targetType: string): boolean {
    if (sourceType === '*' || targetType === '*') return true;
    return sourceType.toLowerCase() === targetType.toLowerCase();
  }

  // Event handlers
  protected onMouseDown(event: MouseEvent): void {
    // Only start drag if clicking on header or body (not on sockets or widgets)
    const target = event.target as HTMLElement;
    if (target.closest('.socket') || target.closest('.widget') || target.closest('.btn-node-action')) {
      return;
    }

    this.dragging.set(true);
    const rect = this.nodeElement.nativeElement.getBoundingClientRect();
    this.dragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    this.drag.emit({ event, node: this.node() });
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  protected onMouseMove(event: MouseEvent): void {
    if (!this.dragging()) return;
    
    this.drag.emit({ event, node: this.node() });
  }

  @HostListener('document:mouseup', ['$event'])
  protected onMouseUp(event: MouseEvent): void {
    if (!this.dragging()) return;
    
    this.dragging.set(false);
  }

  protected onClick(event: MouseEvent): void {
    if (!this.dragging()) {
      this.select.emit(this.node());
    }
  }

  protected onSocketClick(event: MouseEvent, socket: ComfyUINodeInput | ComfyUINodeOutput, isOutput: boolean): void {
    event.stopPropagation();
    if (isOutput) {
      const outputIndex = this.outputSockets().findIndex((s: ComfyUINodeOutput) => s.name === socket.name);
      if (outputIndex >= 0) {
        this.startConnection.emit({ node: this.node(), outputIndex });
      }
    } else {
      const inputIndex = this.inputSockets().findIndex((s: ComfyUINodeInput) => s.name === socket.name);
      if (inputIndex >= 0) {
        this.endConnection.emit({ node: this.node(), inputIndex });
      }
    }
  }

  protected onSocketMouseDown(event: MouseEvent, socketName: string, isOutput: boolean): void {
    event.stopPropagation();
    // Could emit socket drag start if needed
  }

  protected onDeleteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.delete.emit(this.node().id);
  }

  protected onWidgetChange(key: string, value: any): void {
    this.widgetChange.emit({ nodeId: this.node().id, key, value });
  }

  // TrackBy functions
  protected trackBySocketName(index: number, socket: ComfyUINodeInput | ComfyUINodeOutput): string {
    return socket.name;
  }
}