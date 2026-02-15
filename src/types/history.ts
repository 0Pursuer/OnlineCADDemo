/**
 * Boolean Operation Type
 */
export enum BooleanOperator {
    FUSE = 'FUSE',
    CUT = 'CUT',
    COMMON = 'COMMON',
    NONE = 'NONE',
}

/**
 * OperationType Enum
 */
export enum OperationType {
    MAKE_BOX = 'MAKE_BOX',
    MAKE_CYLINDER = 'MAKE_CYLINDER',
    MAKE_SPHERE = 'MAKE_SPHERE',
    MAKE_CONE = 'MAKE_CONE',
    MAKE_TORUS = 'MAKE_TORUS',
    FILLET = 'FILLET',
    CHAMFER = 'CHAMFER',
    TRANSFORM = 'TRANSFORM',
}

/**
 * Reference to another node (mostly internal now)
 */
export interface ShapeReference {
    nodeId: string;
}

/**
 * Mesh Data structure for Three.js rendering
 */
export interface MeshData {
    positions: Float32Array | number[];
    normals: Float32Array | number[];
}

/**
 * Composite View Data for the Frontend
 */
export interface ViewResult {
    finalMesh: MeshData | null;
    activeMesh?: MeshData | null; // For pink highlight preview
}

/**
 * A single node in the modeling history
 */
export interface HistoryNode {
    id: string;
    label: string;
    operation: OperationType;
    params: Record<string, any>;
    booleanOp: BooleanOperator;

    // Status
    dirty: boolean;
    error: string | null;

    // UI/Visibility
    visible: boolean;
    enabled: boolean;
}

/**
 * The state of the history tree
 */
export interface HistoryTreeState {
    nodes: HistoryNode[];
    activeNodeId: string | null;
    isEditing: boolean; // Controls the "Confirm" flow and pink highlight
    viewResult: ViewResult;
    isComputing: boolean;
}
