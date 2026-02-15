// cad-worker.js
// This worker handles all OCCT geometry calculations.
// It imports the WASM module and communicates via postMessage.

import {
    initOpenCascade,
    ocCore,
    ocModelingAlgorithms,
    ocMainWasm
} from 'opencascade.js';

// Global OCCT instance
let occt = null;
let loaded = false;

// Global Shape Cache (nodeId -> { shape, maker })
const shapeCache = new Map();

const findAnywhere = (obj, name, visited = new Set()) => {
    if (!obj || visited.has(obj)) return null;
    visited.add(obj);

    // Check own properties
    if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
    if (obj[name] !== undefined) return obj[name];

    if (obj.opencascade) {
        const res = findAnywhere(obj.opencascade, name, visited);
        if (res) return res;
    }

    return null;
};

const checkSymbols = (stagename) => {
    const symbols = {
        gp_Pnt: !!findAnywhere(occt, 'gp_Pnt'),
        BRepPrimAPI_MakeBox: !!findAnywhere(occt, 'BRepPrimAPI_MakeBox'),
        TopoDS_Shape: !!findAnywhere(occt, 'TopoDS_Shape'),
        BRepAlgoAPI_Cut: !!findAnywhere(occt, 'BRepAlgoAPI_Cut')
    };
    console.log(`OCCT Symbols [${stagename}]:`, symbols);
    return symbols;
};

// Initialize the WASM module
const initializeEngine = async () => {
    console.log("CAD Worker: Starting sequential initialization...");
    try {
        // 1. Initialize Base
        occt = await initOpenCascade({
            mainWasm: ocMainWasm,
            module: {
                print: (text) => console.log("OCCT:", text),
                printErr: (text) => console.error("OCCT Error:", text),
            }
        });
        console.log("Step 1: Base loaded");
        checkSymbols("Base");

        // 2. Load Core
        console.log("Step 2: Loading Core...");
        await occt.loadDynamicLibrary(ocCore, { loadAsync: true, global: true, nodelete: true, allowUndefined: false });
        console.log("Step 2: Core loaded");
        checkSymbols("Core");

        // 3. Load Modeling
        console.log("Step 3: Loading Modeling...");
        await occt.loadDynamicLibrary(ocModelingAlgorithms, { loadAsync: true, global: true, nodelete: true, allowUndefined: false });
        console.log("Step 3: Modeling loaded");
        const finalSymbols = checkSymbols("Final");

        if (!finalSymbols.BRepPrimAPI_MakeBox) {
            console.log("Deep scan for ANY uppercase property in occt:");
            const allProps = Object.getOwnPropertyNames(occt);
            const ucProps = allProps.filter(p => /^[A-Z]/.test(p));
            console.log(`Found ${ucProps.length} uppercase properties. First 50:`, ucProps.slice(0, 50));

            if (occt.opencascade) {
                const subProps = Object.getOwnPropertyNames(occt.opencascade);
                const subUcProps = subProps.filter(p => /^[A-Z]/.test(p));
                console.log(`Found ${subUcProps.length} uppercase properties in occt.opencascade. First 50:`, subUcProps.slice(0, 50));
            }
        }

        loaded = true;
        self.postMessage({ type: 'STATUS', payload: 'READY' });
    } catch (error) {
        console.error("CAD Worker: Initialization failed at some step", error);
        self.postMessage({ type: 'STATUS', payload: 'ERROR', error: error.toString() });
    }
};

// Start initialization immediately
initializeEngine();

// Message Handler
self.onmessage = async (event) => {
    const { id, action, payload } = event.data;

    // Reject all requests if not loaded yet
    if (!loaded) {
        self.postMessage({ id, status: 'error', error: 'Engine not loaded' });
        return;
    }

    try {
        let result;
        // Dispatch actions
        switch (action) {
            case 'PING':
                result = 'PONG';
                break;
            case 'MAKE_BOX':
                result = makeBox(payload);
                break;
            case 'MAKE_CYLINDER':
                result = makeCylinder(payload);
                break;
            case 'MAKE_SPHERE':
                result = makeSphere(payload);
                break;
            case 'MAKE_CONE':
                result = makeCone(payload);
                break;
            case 'BOOLEAN_OP':
                result = executeBooleanOp(payload);
                break;
            case 'RECOMPUTE':
                result = await recomputeHistory(payload);
                break;
            default:
                throw new Error(`Unknown action: ${action}`);
        }

        // Collect all ArrayBuffers for zero-copy transfer
        const transferList = getTransferables(result);

        // Send back successful result with shared ownership transfer
        self.postMessage({ id, status: 'success', result }, transferList);

    } catch (error) {
        console.error(`CAD Worker Error [${action}]:`, error);
        self.postMessage({ id, status: 'error', error: error.message });
    }
};

/**
 * Recursively find all Transferable objects (ArrayBuffers) in a result object.
 */
function getTransferables(obj) {
    const transferables = [];
    if (!obj) return transferables;

    function search(item) {
        if (!item) return;
        if (item instanceof ArrayBuffer) {
            transferables.push(item);
        } else if (ArrayBuffer.isView(item)) {
            // e.g., Float32Array, Int32Array
            transferables.push(item.buffer);
        } else if (typeof item === 'object') {
            for (const key in item) {
                // Avoid infinite recursion or circular refs if any
                if (Object.prototype.hasOwnProperty.call(item, key)) {
                    search(item[key]);
                }
            }
        }
    }
    search(obj);
    return transferables;
}

/**
 * Recomputes the entire modeling history.
 * @param {Array} history Array of HistoryNode objects.
 */
/**
 * Recomputes the entire modeling history using a linear stack model.
 */
async function recomputeHistory({ history, activeNodeId, isEditing }) {
    console.log(`CAD Worker: Recomputing linear stack (${history.length} nodes)`);

    // 1. Cleanup orphaned cache entries
    const historyIds = new Set(history.map(n => n.id));
    for (const [id, data] of shapeCache.entries()) {
        if (!historyIds.has(id)) {
            data.shape.delete();
            if (data.maker) data.maker.delete();
            shapeCache.delete(id);
        }
    }

    let currentResult = null;
    let currentIsTemp = false; // Track if currentResult can be safely deleted
    let activeShape = null;
    let needsCascade = false;

    // 2. Process stack
    for (let i = 0; i < history.length; i++) {
        const node = history[i];
        const isDirty = node.dirty || (activeNodeId && node.id === activeNodeId && isEditing);

        // If THIS node or any PREVIOUS node is dirty, we can't use the cache for the accumulation
        if (!isDirty && !needsCascade && shapeCache.has(node.id)) {
            const cached = shapeCache.get(node.id);
            currentResult = cached.shape;
            currentIsTemp = false; // It's owned by the cache
            console.log(`Using cache for node ${node.id}`);

            // If we are editing this node, we still need its raw shape for preview
            if (node.id === activeNodeId && isEditing) {
                const shapeData = await executeNode(node);
                activeShape = shapeData.shape;
            }
            continue;
        }

        // We are recomputing this step or cascading
        needsCascade = true;
        console.log(`Recomputing node ${node.id} (Dirty: ${isDirty}, Cascade: ${needsCascade})`);

        // 1. Generate the primitive for THIS node
        const shapeData = await executeNode(node);
        if (shapeData.error) throw new Error(shapeData.error);
        const primitive = shapeData.shape;

        if (node.id === activeNodeId && isEditing) {
            // Store a copy for preview (must be independent of currentResult)
            activeShape = applyTransform(primitive, { x: 0, y: 0, z: 0 }); // Null transform to copy
        }

        // 2. Combine with previous result
        if (!currentResult) {
            currentResult = primitive;
            currentIsTemp = true;
        } else {
            const opResult = applyBooleanOperator(currentResult, primitive, node.booleanOp);
            if (opResult.error) throw new Error(opResult.error);

            // Cleanup: only delete if currentResult was a temporary accumulation
            // Don't delete if it came directly from the cache
            if (currentIsTemp) currentResult.delete();
            primitive.delete(); // Primitives from executeNode are always new objects

            currentResult = opResult.shape;
            currentIsTemp = true; // Results of boolean ops are selalu temporary until cached
        }

        // Cache the result of THIS step
        if (shapeCache.has(node.id)) {
            const old = shapeCache.get(node.id);
            if (old.shape !== currentResult) old.shape.delete();
            if (old.maker && old.maker !== shapeData.maker) old.maker.delete();
        }
        shapeCache.set(node.id, {
            shape: currentResult,
            maker: shapeData.maker // Store the maker to keep the shape valid
        });
        currentIsTemp = false; // Now it's owned by the cache
    }

    // 3. Extract results
    if (!currentResult) return { error: 'No shapes generated' };

    const finalMeshData = getMeshData(currentResult);
    let activeMeshData = null;

    if (activeShape) {
        activeMeshData = getMeshData(activeShape);
        activeShape.delete(); // Cleanup preview copy
    }

    return {
        mesh: {
            positions: finalMeshData.positions,
            normals: finalMeshData.normals
        },
        activeMesh: activeMeshData ? {
            positions: activeMeshData.positions,
            normals: activeMeshData.normals
        } : null
    };
}

/**
 * Executes a single geometry node (Primitives).
 */
async function executeNode(node) {
    const { operation, params } = node;
    let result;

    switch (operation) {
        case 'MAKE_BOX':
            result = makeBox(params, true);
            break;
        case 'MAKE_CYLINDER':
            result = makeCylinder(params, true);
            break;
        case 'MAKE_SPHERE':
            result = makeSphere(params, true);
            break;
        case 'MAKE_CONE':
            result = makeCone(params, true);
            break;
        default:
            return { error: `Unsupported operation: ${operation}` };
    }

    if (result.error) return result;

    // Apply transformation
    const untransformedShape = result.shape;
    const transformed = applyTransform(untransformedShape, params.transform || { x: 0, y: 0, z: 0 });

    // Explicitly delete the intermediate untransformed shape
    untransformedShape.delete();

    // Result object needs to contain the final shape
    return {
        shape: transformed,
        maker: result.maker
    };
}

/**
 * Applies a Boolean operator between a base shape and a tool shape.
 */
function applyBooleanOperator(baseShape, toolShape, operator) {
    if (operator === 'NONE') return { shape: baseShape };

    let boolOp;
    try {
        switch (operator) {
            case 'FUSE':
                boolOp = new occt.BRepAlgoAPI_Fuse_3(baseShape, toolShape);
                break;
            case 'CUT':
                boolOp = new occt.BRepAlgoAPI_Cut_3(baseShape, toolShape);
                break;
            case 'COMMON':
                boolOp = new occt.BRepAlgoAPI_Common_3(baseShape, toolShape);
                break;
            default:
                return { error: `Unknown operator: ${operator}` };
        }

        boolOp.Build();
        if (!boolOp.IsDone()) throw new Error(`Boolean ${operator} failed`);

        return {
            shape: boolOp.Shape(),
            maker: boolOp
        };
    } catch (err) {
        return { error: err.message };
    }
}

/**
 * Executes a Boolean operation between two shapes.
 */
function executeBooleanOp({ type, base, tool }) {
    console.log(`CAD Worker: Executing Boolean Operation [${type}]`);
    let baseRaw, toolRaw, transformedTool, boolOp, finalShape;

    try {
        // 1. Generate Base Shape
        baseRaw = createShapeFromConfig(base);
        if (baseRaw.error) throw new Error(`Base Shape creation failed: ${baseRaw.error}`);

        // 2. Generate Tool Shape
        toolRaw = createShapeFromConfig(tool);
        if (toolRaw.error) throw new Error(`Tool Shape creation failed: ${toolRaw.error}`);

        // 3. Apply Transform to Tool Shape
        transformedTool = applyTransform(toolRaw.shape, tool.transform || { x: 0, y: 0, z: 0 });

        // 4. Extract Tool Mesh for preview
        const toolMeshData = getMeshData(transformedTool);

        // 5. Perform Boolean Operation
        switch (type) {
            case 'FUSE':
                boolOp = new occt.BRepAlgoAPI_Fuse_3(baseRaw.shape, transformedTool);
                break;
            case 'CUT':
                boolOp = new occt.BRepAlgoAPI_Cut_3(baseRaw.shape, transformedTool);
                break;
            case 'COMMON':
                boolOp = new occt.BRepAlgoAPI_Common_3(baseRaw.shape, transformedTool);
                break;
            default:
                throw new Error(`Unsupported Boolean operation: ${type}`);
        }

        boolOp.Build();
        if (!boolOp.IsDone()) throw new Error("Boolean operation failed in OCCT");

        finalShape = boolOp.Shape();
        const resultMeshData = getMeshData(finalShape);

        return {
            created: true,
            type: `boolean_${type.toLowerCase()}`,
            positions: resultMeshData.positions,
            normals: resultMeshData.normals,
            // Include tool mesh for "ghost" preview
            toolMesh: {
                positions: toolMeshData.positions,
                normals: toolMeshData.normals
            }
        };

    } catch (err) {
        console.error("CAD Worker: executeBooleanOp failed", err);
        return { error: err.toString() };
    } finally {
        // Careful cleanup
        if (baseRaw) { baseRaw.shape.delete(); baseRaw.maker.delete(); }
        if (toolRaw) { toolRaw.shape.delete(); toolRaw.maker.delete(); }
        if (transformedTool) transformedTool.delete();
        if (boolOp) boolOp.delete();
        if (finalShape) finalShape.delete();
    }
}

/**
 * Helper to create a raw TopoDS_Shape from a configuration object.
 */
function createShapeFromConfig(config) {
    const { type, params } = config;
    switch (type) {
        case 'box': return makeBox(params, true);
        case 'cylinder': return makeCylinder(params, true);
        case 'sphere': return makeSphere(params, true);
        case 'cone': return makeCone(params, true);
        default: return { error: `Unsupported shape type: ${type}` };
    }
}

// --- Geometry Functions ---

/**
 * Extracts mesh data (positions and normals) from a given OCCT shape.
 * @param {TopoDS_Shape} shape The OCCT shape to triangulate and extract mesh from.
 * @returns {{positions: Float32Array, normals: Float32Array}} Mesh data.
 */
function getMeshData(shape) {
    const positions = [];
    const normals = [];

    const deflection = 0.5; // Adjust for desired mesh quality
    new occt.BRepMesh_IncrementalMesh_2(shape, deflection, false, 0.5, false);

    const explorer = new occt.TopExp_Explorer_2(shape, occt.TopAbs_ShapeEnum.TopAbs_FACE, occt.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let count = 0;
    while (explorer.More()) {
        const face = occt.TopoDS.Face_1(explorer.Current());
        const loc = new occt.TopLoc_Location_1();
        const triangulation = occt.BRep_Tool.Triangulation(face, loc);

        if (!triangulation.IsNull()) {
            const tr = triangulation.get();
            const nodes = tr.Nodes();
            const triangles = tr.Triangles();

            for (let i = 1; i <= tr.NbTriangles(); i++) {
                const tri = triangles.Value(i);
                const i1 = tri.Value(1);
                const i2 = tri.Value(2);
                const i3 = tri.Value(3);

                const p1 = nodes.Value(i1).Transformed(loc.Transformation());
                const p2 = nodes.Value(i2).Transformed(loc.Transformation());
                const p3 = nodes.Value(i3).Transformed(loc.Transformation());

                positions.push(p1.X(), p1.Y(), p1.Z());
                positions.push(p2.X(), p2.Y(), p2.Z());
                positions.push(p3.X(), p3.Y(), p3.Z());

                // Calculate normal
                const v1 = new occt.gp_Vec_5(p1, p2);
                const v2 = new occt.gp_Vec_5(p1, p3);
                const normal = v1.Crossed(v2);
                if (normal.SquareMagnitude() > 1e-7) {
                    normal.Normalize();
                }
                for (let j = 0; j < 3; j++) {
                    normals.push(normal.X(), normal.Y(), normal.Z());
                }

                v1.delete();
                v2.delete();
                normal.delete();
                p1.delete();
                p2.delete();
            }
        }
        loc.delete();
        explorer.Next();
        count++;
    }
    explorer.delete();
    console.log(`Mesh data extracted: ${positions.length / 3} vertices from ${count} faces.`);
    // Note: p1, p2, p3, vec1, vec2, n, face, loc, triangulation, tr, nodes, triangles, transformation are temporary and will be garbage collected by JS.
    // OCCT objects created with `new` need explicit `.delete()` if not managed by smart pointers or returned.

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals)
    };
}


function makeBox({ width, height, depth }, returnRawShape = false) {
    console.log(`CAD Worker: Creating box with dims: ${width}, ${height}, ${depth}`);
    try {
        const Ctor = findAnywhere(occt, 'BRepPrimAPI_MakeBox_2') || findAnywhere(occt, 'BRepPrimAPI_MakeBox');
        if (!Ctor) throw new Error("Could not find BRepPrimAPI_MakeBox constructor");

        const mkBox = new Ctor(width, height, depth);
        const shape = mkBox.Shape();

        if (returnRawShape) {
            // Keep shape and constructor alive, caller must cleanup
            return { shape, maker: mkBox };
        }

        const meshData = getMeshData(shape);
        shape.delete();
        mkBox.delete();

        return { created: true, type: 'box', dims: [width, height, depth], positions: meshData.positions, normals: meshData.normals };
    } catch (err) {
        console.error("CAD Worker: makeBox failed", err);
        return { error: err.toString() };
    }
}

function makeCylinder({ radius, height }, returnRawShape = false) {
    console.log(`CAD Worker: Creating cylinder with r=${radius}, h=${height}`);
    try {
        const Ctor = findAnywhere(occt, 'BRepPrimAPI_MakeCylinder_1') || findAnywhere(occt, 'BRepPrimAPI_MakeCylinder');
        if (!Ctor) throw new Error("Could not find BRepPrimAPI_MakeCylinder constructor");

        const mkCyl = new Ctor(radius, height);
        const shape = mkCyl.Shape();

        if (returnRawShape) return { shape, maker: mkCyl };

        const meshData = getMeshData(shape);
        shape.delete();
        mkCyl.delete();

        return { created: true, type: 'cylinder', dims: [radius, height], positions: meshData.positions, normals: meshData.normals };
    } catch (err) {
        console.error("CAD Worker: makeCylinder failed", err);
        return { error: err.toString() };
    }
}

function makeSphere({ radius }, returnRawShape = false) {
    console.log(`CAD Worker: Creating sphere with r=${radius}`);
    try {
        const Ctor = findAnywhere(occt, 'BRepPrimAPI_MakeSphere_1') || findAnywhere(occt, 'BRepPrimAPI_MakeSphere');
        if (!Ctor) throw new Error("Could not find BRepPrimAPI_MakeSphere constructor");

        const mkSphere = new Ctor(radius);
        const shape = mkSphere.Shape();

        if (returnRawShape) return { shape, maker: mkSphere };

        const meshData = getMeshData(shape);
        shape.delete();
        mkSphere.delete();

        return { created: true, type: 'sphere', dims: [radius], positions: meshData.positions, normals: meshData.normals };
    } catch (err) {
        console.error("CAD Worker: makeSphere failed", err);
        return { error: err.toString() };
    }
}

function makeCone({ radius1, radius2, height }, returnRawShape = false) {
    console.log(`CAD Worker: Creating cone with r1=${radius1}, r2=${radius2}, h=${height}`);
    try {
        const Ctor = findAnywhere(occt, 'BRepPrimAPI_MakeCone_1') || findAnywhere(occt, 'BRepPrimAPI_MakeCone');
        if (!Ctor) throw new Error("Could not find BRepPrimAPI_MakeCone constructor");

        const mkCone = new Ctor(radius1, radius2, height);
        const shape = mkCone.Shape();

        if (returnRawShape) return { shape, maker: mkCone };

        const meshData = getMeshData(shape);
        shape.delete();
        mkCone.delete();

        return { created: true, type: 'cone', dims: [radius1, radius2, height], positions: meshData.positions, normals: meshData.normals };
    } catch (err) {
        console.error("CAD Worker: makeCone failed", err);
        return { error: err.toString() };
    }
}

/**
 * Applies translation to a shape.
 */
function applyTransform(shape, { x, y, z }) {
    const trsf = new occt.gp_Trsf_1();
    const vec = new occt.gp_Vec_4(x || 0, y || 0, z || 0);
    trsf.SetTranslation_1(vec);
    const loc = new occt.TopLoc_Location_2(trsf);
    const transformedShape = shape.Moved(loc);

    trsf.delete();
    vec.delete();
    loc.delete();

    return transformedShape; // Caller manages this
}
