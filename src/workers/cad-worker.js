// cad-worker.js
// This worker handles all OCCT geometry operations via replicad + opencascade.js.
//
// Strategy: Import the raw Emscripten factory function directly (not the index.js
// which re-exports all WASM modules). Then use locateFile to redirect WASM requests
// to the public/ directory, and loadDynamicLibrary for additional OCCT modules.

// Import the raw Emscripten factory (this is just JS, no WASM imports)
// Import the raw Emscripten factory (this is just JS, no WASM imports)
import opencascadeFactory from 'opencascade.js/dist/opencascade.js';
// Import the locally vendored and patched version of replicad to bypass node_modules caching
import { setOC, makeBaseBox, Solid, downcast, getOC } from '../vendor/replicad.js';

console.log("[CAD Worker] Using vendored replicad from src/vendor/replicad.js");

// Global state
let occt = null;
let loaded = false;

/**
 * Initialize the OCCT engine and replicad library.
 * Posts STATUS messages back to the main thread for UI feedback.
 */
const initializeEngine = async () => {
    console.log("[CAD Worker] Starting initialization...");

    try {
        // Step 1: Load OpenCascade.js core via the raw Emscripten factory
        self.postMessage({ type: 'STATUS', payload: 'LOADING_OCCT' });
        console.log("[CAD Worker] Step 1: Loading OCCT Core...");

        // Call the Emscripten factory with locateFile to redirect all WASM
        // requests to the public/ directory (Vite serves public/ files at root)
        occt = await new opencascadeFactory({
            locateFile: (path) => {
                if (path.endsWith('.wasm')) {
                    const filename = path.split('/').pop();
                    const target = '/' + filename;
                    console.log(`[CAD Worker] locateFile: ${path} -> ${target}`);
                    return target;
                }
                return path;
            },
            print: (text) => console.log("[OCJS]", text),
            printErr: (text) => console.warn("[OCJS Error]", text),
        });

        console.log("[CAD Worker] Step 1a: OCCT Core loaded, loading dynamic libraries...");

        // Load additional OCCT dynamic libraries from public/ directory.
        // ORDER MATTERS! These follow the exact dependency order from
        // opencascade.js/dist/index.js. Each module may depend on symbols
        // from modules listed before it.
        const neededLibs = [
            // Foundation
            '/module.TKMath.wasm',
            '/module.TKG2d.wasm',
            '/module.TKG3d.wasm',
            '/module.TKService.wasm',    // Required by TKGeomBase and others
            '/module.TKGeomBase.wasm',
            '/module.TKBRep.wasm',
            // Algorithms
            '/module.TKGeomAlgo.wasm',
            '/module.TKTopAlgo.wasm',
            '/module.TKHLR.wasm',        // Required by TKShHealing
            '/module.TKShHealing.wasm',  // Shape healing (ShapeUpgrade_UnifySameDomain etc.)
            // Meshing
            '/module.TKMesh.wasm',
            // Data framework (needed by some replicad operations)
            '/module.TKCDF.wasm',
            '/module.TKLCAF.wasm',
            // Primitives & booleans
            '/module.TKPrim.wasm',
            '/module.TKBO.wasm',
            '/module.TKBool.wasm',
            // Advanced modeling
            '/module.TKFillet.wasm',
            '/module.TKOffset.wasm',
            '/module.TKFeat.wasm',
        ];

        for (const lib of neededLibs) {
            console.log(`[CAD Worker] Loading dynamic lib: ${lib}`);
            await occt.loadDynamicLibrary(lib, {
                loadAsync: true,
                global: true,
                nodelete: true,
                allowUndefined: false,
            });
        }

        console.log("[CAD Worker] Step 1 COMPLETE: All OCCT modules loaded.");

        // Step 2: Initialize replicad with the OCCT instance
        self.postMessage({ type: 'STATUS', payload: 'LOADING_REPLICAD' });
        console.log("[CAD Worker] Step 2: Initializing RepliCAD...");

        setOC(occt);

        console.log("[CAD Worker] Step 2 COMPLETE: RepliCAD initialized.");

        // All done
        loaded = true;
        self.postMessage({ type: 'STATUS', payload: 'READY', loaded: true });
        console.log("[CAD Worker] ===== ENGINE READY =====");

    } catch (error) {
        console.error("[CAD Worker] Initialization FAILED:", error);
        self.postMessage({
            type: 'STATUS',
            payload: 'ERROR',
            error: error.toString(),
            stack: error.stack
        });
    }
};

// Start initialization
initializeEngine();

// ─── Message Handler ─────────────────────────────────────────────────────────
self.onmessage = async (event) => {
    const { id, action, payload } = event.data;

    if (!loaded) {
        self.postMessage({ id, status: 'error', error: 'Engine not ready yet.' });
        return;
    }

    try {
        let result;
        switch (action) {
            case 'PING':
                result = 'PONG';
                break;
            case 'MAKE_BOX':
                result = handleMakeBox(payload);
                break;
            case 'RECOMPUTE':
                result = handleRecompute(payload);
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }
        self.postMessage({ id, status: 'success', result });
    } catch (err) {
        console.error(`[CAD Worker] Error in action '${action}':`, err);
        self.postMessage({ id, status: 'error', error: err.toString() });
    }
};

// ─── Geometry Operations ─────────────────────────────────────────────────────

function handleMakeBox({ width, height, depth }) {
    console.log(`[CAD Worker] makeBox(${width}, ${height}, ${depth})`);
    const shape = makeBaseBox(width, height, depth);
    const mesh = shape.mesh({ tolerance: 0.1, angularTolerance: 30 });
    shape.delete();
    return {
        created: true,
        type: 'box',
        vertices: mesh.vertices,
        normals: mesh.normals,
        triangles: mesh.triangles
    };
}

/**
 * Create a cylinder primitive using OCCT BRepPrimAPI_MakeCylinder.
 * Returns a replicad Solid object.
 */
function makeCylinderShape(radius, height) {
    const oc = getOC();
    const builder = new oc.BRepPrimAPI_MakeCylinder_1(radius, height);
    const shape = new Solid(downcast(builder.Shape()));
    builder.delete();
    return shape;
}

/**
 * Create a sphere primitive using OCCT BRepPrimAPI_MakeSphere.
 * Returns a replicad Solid object.
 */
function makeSphereShape(radius) {
    const oc = getOC();
    const builder = new oc.BRepPrimAPI_MakeSphere_1(radius);
    const shape = new Solid(downcast(builder.Shape()));
    builder.delete();
    return shape;
}

/**
 * Create a cone primitive using OCCT BRepPrimAPI_MakeCone.
 * Returns a replicad Solid object.
 */
function makeConeShape(r1, r2, height) {
    const oc = getOC();
    const builder = new oc.BRepPrimAPI_MakeCone_1(r1, r2, height);
    const shape = new Solid(downcast(builder.Shape()));
    builder.delete();
    return shape;
}

/**
 * Handle the RECOMPUTE action from the history store.
 */
function handleRecompute({ history, activeNodeId, isEditing }) {
    console.log(`[CAD Worker] RECOMPUTE: ${history.length} nodes, active=${activeNodeId}`);

    let currentShape = null;
    const errors = {};

    try {
        for (const node of history) {
            // CRITICAL: When editing, we MUST exclude the active node and all subsequent nodes
            // from the background 'finalMesh'. Otherwise, we get severe Z-fighting.
            // Use loose equality (==) because activeNodeId might be a string from the UI
            if (isEditing && activeNodeId && (node.id == activeNodeId || !node.id)) {
                break;
            }
            try {
                let newShape = null;

                switch (node.operation) {
                    case 'MAKE_BOX':
                        newShape = makeBaseBox(
                            node.params.width || 10,
                            node.params.height || 10,
                            node.params.depth || 10
                        );
                        break;
                    case 'MAKE_CYLINDER':
                        newShape = makeCylinderShape(
                            node.params.radius || 5,
                            node.params.height || 10
                        );
                        break;
                    case 'MAKE_SPHERE':
                        newShape = makeSphereShape(
                            node.params.radius || 10
                        );
                        break;
                    case 'MAKE_CONE':
                        newShape = makeConeShape(
                            node.params.radius1 || 5,
                            node.params.radius2 != null ? node.params.radius2 : 0,
                            node.params.height || 10
                        );
                        break;
                    default:
                        throw new Error(`Unsupported operation: ${node.operation}`);
                }

                if (node.params.transform) {
                    const { x = 0, y = 0, z = 0 } = node.params.transform;
                    if (x !== 0 || y !== 0 || z !== 0) {
                        newShape = newShape.translate([x, y, z]);
                    }
                }

                if (currentShape && node.booleanOp && node.booleanOp !== 'NONE') {
                    const oldShape = currentShape;
                    switch (node.booleanOp) {
                        case 'FUSE':
                            currentShape = currentShape.fuse(newShape);
                            break;
                        case 'CUT':
                            currentShape = currentShape.cut(newShape);
                            break;
                        case 'COMMON':
                            currentShape = currentShape.intersect(newShape);
                            break;
                        default:
                            currentShape = newShape;
                    }
                    if (oldShape !== currentShape) oldShape.delete();
                    if (newShape !== currentShape) newShape.delete();
                } else {
                    if (currentShape) currentShape.delete();
                    currentShape = newShape;
                }

            } catch (nodeErr) {
                console.error(`[CAD Worker] Error in node ${node.id}:`, nodeErr);
                errors[node.id] = nodeErr.toString();
            }
        }

        if (currentShape) {
            const mesh = currentShape.mesh({ tolerance: 0.1, angularTolerance: 30 });

            // Build faceIds attribute for main mesh
            const faceIds = new Float32Array(mesh.vertices.length / 3);
            if (mesh.faceGroups) {
                mesh.faceGroups.forEach(group => {
                    // In replicad, vertices for each face are added sequentially
                    // The groups tell us the triangle ranges, but we need vertex ranges.
                    // Actually, looking at replicad source, faceGroups contains faceId.
                    // We can map vertices to faces by calculating the min/max index used in triangles.
                    const usedVertices = new Set();
                    for (let i = group.start; i < group.start + group.count; i++) {
                        usedVertices.add(mesh.triangles[i]);
                    }
                    usedVertices.forEach(vIdx => {
                        faceIds[vIdx] = group.faceId;
                    });
                });
            }

            // Extract topological edges
            let edgeData = null;
            try {
                const eMesh = currentShape.meshEdges({ tolerance: 0.1, angularTolerance: 30 });
                const ePositions = new Float32Array(eMesh.lines);
                const eIds = new Float32Array(eMesh.lines.length / 3);

                eMesh.edgeGroups.forEach(group => {
                    for (let i = group.start; i < group.start + group.count; i++) {
                        eIds[i] = group.edgeId;
                    }
                });

                edgeData = {
                    positions: Array.from(ePositions),
                    edgeIds: Array.from(eIds)
                };
            } catch (eErr) {
                console.warn('[CAD Worker] Edge meshing failed:', eErr);
            }

            // Defer currentShape.delete() to the end of the handleRecompute
            // to ensure any sub-operations (like active preview) are safe.

            // If editing, compute the active node's shape separately for preview
            let activeMeshData = null;
            if (isEditing && activeNodeId) {
                try {
                    const activeNode = history.find(n => n.id === activeNodeId);
                    if (activeNode) {
                        let activeShape = null;
                        switch (activeNode.operation) {
                            case 'MAKE_BOX':
                                activeShape = makeBaseBox(activeNode.params.width || 10, activeNode.params.height || 10, activeNode.params.depth || 10);
                                break;
                            case 'MAKE_CYLINDER':
                                activeShape = makeCylinderShape(activeNode.params.radius || 5, activeNode.params.height || 10);
                                break;
                            case 'MAKE_SPHERE':
                                activeShape = makeSphereShape(activeNode.params.radius || 10);
                                break;
                            case 'MAKE_CONE':
                                activeShape = makeConeShape(activeNode.params.radius1 || 5, activeNode.params.radius2 != null ? activeNode.params.radius2 : 0, activeNode.params.height || 10);
                                break;
                        }
                        if (activeShape) {
                            if (activeNode.params.transform) {
                                const { x = 0, y = 0, z = 0 } = activeNode.params.transform;
                                const tx = Number(x);
                                const ty = Number(y);
                                const tz = Number(z);
                                if (!isNaN(tx) && !isNaN(ty) && !isNaN(tz) && (tx !== 0 || ty !== 0 || tz !== 0)) {
                                    const translated = activeShape.translate([tx, ty, tz]);
                                    // Do NOT delete activeShape here. 
                                    // In some bindings, translated and activeShape might share C++ resources.
                                    // We delete the final activeShape at the end of the block.
                                    activeShape = translated;
                                }
                            }
                            const aMesh = activeShape.mesh({ tolerance: 0.1, angularTolerance: 30 });

                            const aFaceIds = new Float32Array(aMesh.vertices.length / 3);
                            if (aMesh.faceGroups) {
                                aMesh.faceGroups.forEach(group => {
                                    const usedVertices = new Set();
                                    for (let i = group.start; i < group.start + group.count; i++) {
                                        usedVertices.add(aMesh.triangles[i]);
                                    }
                                    usedVertices.forEach(vIdx => {
                                        aFaceIds[vIdx] = group.faceId;
                                    });
                                });
                            }

                            activeMeshData = {
                                positions: aMesh.vertices,
                                normals: aMesh.normals,
                                indices: aMesh.triangles,
                                faceIds: Array.from(aFaceIds)
                            };
                            activeShape.delete();
                        }
                    }
                } catch (previewErr) {
                    console.warn('[CAD Worker] Active mesh preview failed:', previewErr);
                }
            }

            if (currentShape) currentShape.delete();

            return {
                mesh: {
                    positions: mesh.vertices,
                    normals: mesh.normals,
                    indices: mesh.triangles,
                    faceIds: Array.from(faceIds)
                },
                edges: edgeData,
                activeMesh: activeMeshData,
                errors: Object.keys(errors).length > 0 ? errors : null
            };
        }

        return { mesh: null, activeMesh: null, errors };

    } catch (err) {
        console.error("[CAD Worker] RECOMPUTE failed:", err);
        return { error: err.toString(), mesh: null, activeMesh: null, errors };
    }
}
