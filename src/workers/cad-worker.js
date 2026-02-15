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
        TopoDS_Shape: !!findAnywhere(occt, 'TopoDS_Shape')
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
            default:
                throw new Error(`Unknown action: ${action}`);
        }

        // Send back successful result
        // Note: For large geometry data, consider using Transferables for performance
        self.postMessage({ id, status: 'success', result });

    } catch (error) {
        console.error(`CAD Worker Error [${action}]:`, error);
        self.postMessage({ id, status: 'error', error: error.message });
    }
};

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


function makeBox({ width, height, depth }) {
    // The `loaded` check is already done in the onmessage handler, so no need to duplicate here.

    console.log(`CAD Worker: Creating box with dims: ${width}, ${height}, ${depth}`);

    try {
        // In OCCT 2.0-beta, overloaded constructors are often exported with suffix _N
        // BRepPrimAPI_MakeBox_2(dx, dy, dz) is the 3-parameter constructor.
        const Ctor = findAnywhere(occt, 'BRepPrimAPI_MakeBox_2') || findAnywhere(occt, 'BRepPrimAPI_MakeBox');

        if (!Ctor) {
            throw new Error("Could not find BRepPrimAPI_MakeBox constructor");
        }

        const mkBox = new Ctor(width, height, depth);
        const shape = mkBox.Shape();

        // Use helper to generate mesh data (handles triangulation and extraction)
        const meshData = getMeshData(shape);

        // Cleanup
        shape.delete();
        mkBox.delete();

        return {
            created: true,
            type: 'box',
            dims: [width, height, depth],
            positions: meshData.positions,
            normals: meshData.normals
        };
    } catch (err) {
        console.error("CAD Worker: makeBox failed", err);
        return { error: err.toString() };
    }
}
