import type { GraphNode, GraphEdge, ValidationError } from "./event-graph";
import type { EventGraph } from "./event-graph";
import type { EventRouter, HandlerFn } from "./event-router";

export interface PluginRegistration {
  /** Unique plugin ID, e.g. "openp41ge-extension-explorer" */
  id: string;
  /** Handler node IDs this plugin provides */
  nodes: string[];
  /** Graph edges this plugin registers */
  edges: Omit<GraphEdge, "id">[];
  /** Handler functions keyed by node ID */
  handlers: Record<string, HandlerFn>;
  /** Factory for the plugin's UI component */
  component?: () => HTMLElement;
}

export interface PluginRegistrationResult {
  success: boolean;
  errors: ValidationError[];
}

/**
 * Plugin registry — manages registration of plugin modules.
 *
 * Built-in plugins (explorer, git repo, file editor, etc.) register
 * through this same API. External plugins would use it too.
 */
export class PluginRegistry {
  private _plugins: Map<string, PluginRegistration> = new Map();
  private _graph?: EventGraph;
  private _router?: EventRouter;

  /** Connect to the core event system. Called during bootstrap. */
  connect(graph: EventGraph, router: EventRouter): void {
    this._graph = graph;
    this._router = router;
  }

  /** Register a plugin. Validates and extends the graph. */
  register(plugin: PluginRegistration): PluginRegistrationResult {
    if (this._plugins.has(plugin.id)) {
      return {
        success: false,
        errors: [
          { type: "duplicate-node" as const, message: `Plugin "${plugin.id}" already registered.` },
        ],
      };
    }

    const errors: ValidationError[] = [];

    // Build graph nodes
    const nodes: GraphNode[] = plugin.nodes.map((id) => ({ id }));

    // Build graph edges (generate IDs)
    const edges: GraphEdge[] = plugin.edges.map((e, i) => ({
      id: `${plugin.id}-edge-${i}`,
      from: e.from,
      when: e.when ?? null,
      to: e.to,
    }));

    // Extend the graph
    if (this._graph) {
      const graphErrors = this._graph.extend(nodes, edges);
      errors.push(...graphErrors);
    }

    // Register handlers
    if (this._router) {
      for (const [handlerId, fn] of Object.entries(plugin.handlers)) {
        this._router.registerHandler(handlerId, fn);
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    this._plugins.set(plugin.id, plugin);
    return { success: true, errors: [] };
  }

  /** Get all registered plugins. */
  getAll(): PluginRegistration[] {
    return Array.from(this._plugins.values());
  }

  /** Get a specific plugin by ID. */
  get(id: string): PluginRegistration | undefined {
    return this._plugins.get(id);
  }
}
