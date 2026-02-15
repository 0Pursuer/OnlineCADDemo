import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { HistoryNode, HistoryTreeState, OperationType, BooleanOperator, ViewResult } from '../types/history';
import { workerManager } from '../logic/WorkerManager';

interface HistoryStore extends HistoryTreeState {
    // Actions
    addNode: (node: Omit<HistoryNode, 'id' | 'dirty' | 'error'>) => void;
    updateNode: (id: string, updates: Partial<HistoryNode>) => void;
    deleteNode: (id: string) => void;
    setActiveNode: (id: string | null) => void;

    // View/Edit Actions
    confirmEdit: () => void;
    cancelEdit: () => void;

    // Internal Logic
    markDirty: (nodeId: string) => void;
    recompute: () => Promise<void>;
}

export const useHistoryStore = create<HistoryStore>()(
    immer((set, get) => ({
        // Initial State
        nodes: [],
        activeNodeId: null,
        isEditing: false,
        viewResult: { finalMesh: null, activeMesh: null },
        isComputing: false,

        addNode: (nodeData) => set((state) => {
            const newNode: HistoryNode = {
                ...nodeData,
                id: crypto.randomUUID(),
                dirty: true,
                error: null,
            };
            state.nodes.push(newNode);
            state.activeNodeId = newNode.id;
            state.isEditing = true; // Enter preview mode immediately
        }),

        updateNode: (id, updates) => set((state) => {
            const index = state.nodes.findIndex(n => n.id === id);
            if (index !== -1) {
                const node = state.nodes[index];
                Object.assign(node, updates);
                if (updates.params || updates.booleanOp || updates.enabled !== undefined) {
                    // Mark this and ALL subsequent nodes as dirty for a linear stack
                    for (let i = index; i < state.nodes.length; i++) {
                        state.nodes[i].dirty = true;
                    }
                }
            }
        }),

        deleteNode: (id) => set((state) => {
            const index = state.nodes.findIndex(n => n.id === id);
            if (index !== -1) {
                state.nodes.splice(index, 1);
                if (state.activeNodeId === id) {
                    state.activeNodeId = null;
                    state.isEditing = false;
                }
                // Mark all subsequent nodes as dirty
                for (let i = index; i < state.nodes.length; i++) {
                    state.nodes[i].dirty = true;
                }

                // If no nodes left or if we deleted the last node, 
                // we might need a special flag to trigger recompute 
                // if the App.tsx effect only looks at node.dirty.
                // However, since we use Immer.
            }
        }),

        setActiveNode: (id) => set((state) => {
            state.activeNodeId = id;
            if (id !== null) state.isEditing = true; // Selection triggers editor/preview
        }),

        confirmEdit: () => set((state) => {
            state.isEditing = false;
            if (state.viewResult) {
                state.viewResult.activeMesh = null;
            }
        }),

        cancelEdit: () => set((state) => {
            state.isEditing = false;
            if (state.viewResult) {
                state.activeNodeId = null; // Also clear selection on cancel
                state.viewResult.activeMesh = null;
            }
        }),

        markDirty: (nodeId) => set((state) => {
            const index = state.nodes.findIndex(n => n.id === nodeId);
            if (index !== -1) {
                // In a linear stack, any change to a node marks it and ALL following nodes dirty
                for (let i = index; i < state.nodes.length; i++) {
                    state.nodes[i].dirty = true;
                }
            }
        }),

        recompute: async () => {
            const { nodes, isComputing, activeNodeId, isEditing } = get();

            // If already computing, just flag that we need another run afterwards
            if (isComputing) {
                (get() as any)._recomputePending = true;
                return;
            }

            if (nodes.length === 0) return;

            set({ isComputing: true });
            (get() as any)._recomputePending = false;

            try {
                const historyData = nodes.filter(n => n.enabled);
                const result = await workerManager.execute('RECOMPUTE', {
                    history: historyData,
                    activeNodeId,
                    isEditing
                });

                if (result.error) {
                    console.error("Recompute failed:", result.error);
                } else {
                    set((state) => {
                        state.viewResult = {
                            finalMesh: result.mesh,
                            activeMesh: result.activeMesh
                        };
                        // Clear dirty flags
                        state.nodes.forEach(n => n.dirty = false);

                        // Update error states
                        state.nodes.forEach(n => {
                            if (result.errors && result.errors[n.id]) {
                                n.error = result.errors[n.id];
                            } else {
                                n.error = null;
                            }
                        });
                    });
                }
            } catch (err) {
                console.error("Recompute error:", err);
            } finally {
                set({ isComputing: false });

                // If another recompute was requested while this one was running, run it now
                if ((get() as any)._recomputePending) {
                    get().recompute();
                }
            }
        },
    }))
);
