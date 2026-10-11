export interface GraphNode {
  id: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  when: Record<string, unknown> | null;
  to: string[];
}

export interface GraphData {
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphPatch =
  | { op: "addNode"; node: GraphNode }
  | { op: "addEdge"; edge: GraphEdge }
  | { op: "removeEdge"; edgeId: string }
  | { op: "removeNode"; nodeId: string };

export interface ValidationError {
  type:
    | "node-not-found"
    | "duplicate-node"
    | "duplicate-edge"
    | "missing-from"
    | "missing-to"
    | "invalid-when";
  message: string;
}

/**
 * Event graph store.
 *
 * Loads a base graph from JSON (core routes). Plugin extensions add nodes
 * and edges at bootstrap time. The graph is read-only at runtime — changes
 * are made by editing the JSON file and rebuilding.
 */
export class EventGraph {
  private _graph!: GraphData;
  private _initialHash = "";

  /** Load base graph from parsed JSON data. */
  load(graphData: GraphData): ValidationError[] {
    const errors = this._validate(graphData);
    if (errors.length > 0) return errors;

    this._graph = {
      version: graphData.version,
      nodes: [...graphData.nodes],
      edges: [...graphData.edges],
    };
    this._initialHash = this._computeHash();
    return [];
  }

  /** Extend the graph with plugin nodes and edges (called at bootstrap). */
  extend(nodes: GraphNode[], edges: GraphEdge[]): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const node of nodes) {
      if (this._graph.nodes.some((n) => n.id === node.id)) {
        errors.push({ type: "duplicate-node", message: `Node "${node.id}" already exists.` });
        continue;
      }
      this._graph.nodes.push(node);
    }
    for (const edge of edges) {
      // Validate target nodes exist
      for (const targetId of edge.to) {
        if (!this._graph.nodes.some((n) => n.id === targetId)) {
          errors.push({
            type: "node-not-found",
            message: `Edge "${edge.id}" targets unknown node "${targetId}".`,
          });
        }
      }
      // edge.from is an event type, not a node ID — no validation needed
      if (this._graph.edges.some((e) => e.id === edge.id)) {
        errors.push({ type: "duplicate-edge", message: `Edge "${edge.id}" already exists.` });
      }
      if (errors.length > 0) continue;
      this._graph.edges.push(edge);
    }
    return errors;
  }

  /** Find edges matching an event type, in registration order. */
  findEdges(eventType: string): GraphEdge[] {
    if (!this._graph) return [];
    return this._graph.edges.filter((e) => e.from === eventType);
  }

  /** All nodes. */
  get nodes(): GraphNode[] {
    if (!this._graph) return [];
    return [...this._graph.nodes];
  }

  /** All edges. */
  get edges(): GraphEdge[] {
    if (!this._graph) return [];
    return [...this._graph.edges];
  }

  /** Current graph hash. */
  hash(): string {
    return this._graph ? this._computeHash() : this._initialHash;
  }

  private _computeHash(): string {
    // Simple hash based on JSON content — good enough for change detection
    const str = JSON.stringify(this._graph);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return `graph:${Math.abs(hash).toString(16)}`;
  }

  private _validate(graphData: GraphData): ValidationError[] {
    const errors: ValidationError[] = [];
    const nodeIds = new Set(graphData.nodes.map((n) => n.id));

    if (!graphData.version) {
      errors.push({ type: "invalid-when", message: "Graph data must have a version field." });
    }

    // Check for duplicate node IDs
    const seenNodes = new Set<string>();
    for (const node of graphData.nodes) {
      if (seenNodes.has(node.id)) {
        errors.push({ type: "duplicate-node", message: `Duplicate node "${node.id}".` });
      }
      seenNodes.add(node.id);
    }

    // Validate edges
    const seenEdges = new Set<string>();
    for (const edge of graphData.edges) {
      if (seenEdges.has(edge.id)) {
        errors.push({ type: "duplicate-edge", message: `Duplicate edge "${edge.id}".` });
      }
      seenEdges.add(edge.id);

      if (!edge.from) {
        errors.push({ type: "missing-from", message: `Edge "${edge.id}" has no "from" field.` });
      }
      if (!edge.to || edge.to.length === 0) {
        errors.push({ type: "missing-to", message: `Edge "${edge.id}" has no "to" field.` });
      }
      // edge.from is an event type (e.g. "window-focus", "sidebar-click-right"),
      // not a node ID. Only edge.to targets need to be registered nodes.
      for (const targetId of edge.to) {
        if (!nodeIds.has(targetId)) {
          errors.push({
            type: "node-not-found",
            message: `Edge "${edge.id}" targets unknown node "${targetId}".`,
          });
        }
      }
    }

    return errors;
  }
}
