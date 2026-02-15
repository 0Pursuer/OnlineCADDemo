import { useState, useEffect } from 'react';
import { workerManager } from './logic/WorkerManager';
import CADViewer from './components/CADViewer';
import { useHistoryStore } from './store/historyStore';
import { OperationType, BooleanOperator } from './types/history';

interface ShapeConfig {
    type: string;
    params: Record<string, number>;
    transform?: { x: number; y: number; z: number };
}

type BooleanMode = 'NONE' | 'FUSE' | 'CUT' | 'COMMON';

function App() {
    const {
        nodes,
        activeNodeId,
        isEditing,
        setActiveNode,
        addNode,
        updateNode,
        confirmEdit,
        cancelEdit,
        viewResult,
        isComputing,
        recompute
    } = useHistoryStore();

    const [status, setStatus] = useState('Initializing...');
    const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
    const [menuNodeId, setMenuNodeId] = useState<string | null>(null);

    const handleContextMenu = (e: React.MouseEvent, nodeId: string) => {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
        setMenuNodeId(nodeId);
    };

    const closeMenu = () => {
        setMenuPos(null);
        setMenuNodeId(null);
    };

    useEffect(() => {
        const handleClick = () => closeMenu();
        window.addEventListener('click', handleClick);
        window.addEventListener('scroll', handleClick, true);
        return () => {
            window.removeEventListener('click', handleClick);
            window.removeEventListener('scroll', handleClick, true);
        };
    }, []);

    // Initial Initialization
    useEffect(() => {
        const init = async () => {
            try {
                setStatus('Loading OCCT Engine...');
                await workerManager.waitForReady();
                await workerManager.execute('PING');
                setStatus('Ready');

                // Initialize History if empty
                if (useHistoryStore.getState().nodes.length === 0) {
                    addNode({
                        label: 'Base Box',
                        operation: OperationType.MAKE_BOX,
                        params: { width: 15, height: 15, depth: 15 },
                        booleanOp: BooleanOperator.NONE,
                        visible: true,
                        enabled: true
                    });
                }
            } catch (err) {
                setStatus('Error: ' + err);
            }
        };
        init();
    }, []);

    // Trigger Recompute when nodes change
    useEffect(() => {
        const dirty = nodes.some(n => n.dirty);
        const countChanged = nodes.length !== (window as any)._prevNodeCount;
        const selectionChanged = activeNodeId !== (window as any)._prevActiveNodeId
            || isEditing !== (window as any)._prevIsEditing;

        if ((dirty || countChanged || selectionChanged) && status === 'Ready') {
            if (!isComputing) {
                // Update trackers and trigger
                (window as any)._prevNodeCount = nodes.length;
                (window as any)._prevActiveNodeId = activeNodeId;
                (window as any)._prevIsEditing = isEditing;
                recompute();
            }
            // If isComputing is true, the store's queuing mechanism will handle it,
            // or the effect will re-run when isComputing flips to false.
        }
    }, [nodes, nodes.length, isComputing, status, activeNodeId, isEditing]);

    const activeNode = nodes.find(n => n.id === activeNodeId);

    const updateNodeParam = (id: string, name: string, value: string) => {
        const num = parseFloat(value) || 0;
        const node = nodes.find(n => n.id === id);
        if (node) {
            updateNode(id, {
                params: { ...node.params, [name]: num }
            });
        }
    };

    const updateNodeTransform = (id: string, name: 'x' | 'y' | 'z', value: string) => {
        const num = parseFloat(value) || 0;
        const node = nodes.find(n => n.id === id);
        if (node) {
            const transform = { ...(node.params.transform || { x: 0, y: 0, z: 0 }), [name]: num };
            updateNode(id, {
                params: { ...node.params, transform }
            });
        }
    };

    const handleBooleanChange = (id: string, op: BooleanOperator) => {
        updateNode(id, { booleanOp: op });
    };

    const handleNodeOperationChange = (id: string, newType: string) => {
        let newParams: any = {};
        switch (newType) {
            case 'box': newParams = { width: 10, height: 10, depth: 10 }; break;
            case 'cylinder': newParams = { radius: 5, height: 10 }; break;
            case 'sphere': newParams = { radius: 10 }; break;
            case 'cone': newParams = { radius1: 5, radius2: 0, height: 10 }; break;
        }
        updateNode(id, {
            operation: `MAKE_${newType.toUpperCase()}` as OperationType,
            params: newParams
        });
    };

    const renderPropertyEditor = () => {
        if (!activeNode || !isEditing) return null;

        const type = activeNode.operation.replace('MAKE_', '').toLowerCase();
        const paramsMap: Record<string, string[]> = {
            'box': ['width', 'height', 'depth'],
            'cylinder': ['radius', 'height'],
            'sphere': ['radius'],
            'cone': ['radius1', 'radius2', 'height']
        };
        const paramsList = paramsMap[type] || [];
        const isPrimitive = ['box', 'cylinder', 'sphere', 'cone'].includes(type);

        return (
            <div className="flex flex-col h-full">
                <div className="flex-1 space-y-6">
                    <section>
                        <h2 className="text-[11px] font-black text-blue-400 uppercase tracking-[0.2rem] mb-6 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span> Editing: {activeNode.label}
                        </h2>

                        <div className="space-y-5">
                            {/* Boolean Mode Selector */}
                            {nodes[0]?.id !== activeNode.id && (
                                <div className="space-y-2">
                                    <label className="text-[10px] text-neutral-500 uppercase font-black tracking-widest">Operation Mode</label>
                                    <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 gap-1">
                                        {(['FUSE', 'CUT', 'COMMON'] as const).map((op) => (
                                            <button
                                                key={op}
                                                onClick={() => handleBooleanChange(activeNode.id, op as BooleanOperator)}
                                                className={`flex-1 py-1 px-2 rounded-md text-[9px] font-black transition-all ${activeNode.booleanOp === op
                                                    ? 'bg-blue-600 text-white shadow-lg'
                                                    : 'text-neutral-500 hover:text-neutral-300'
                                                    }`}
                                            >
                                                {op}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Shape Selector */}
                            <div className="space-y-2">
                                <label className="text-[10px] text-neutral-500 uppercase font-black tracking-widest">Shape Type</label>
                                <select
                                    value={type}
                                    onChange={(e) => handleNodeOperationChange(activeNode.id, e.target.value)}
                                    className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-xs focus:border-blue-500 outline-none transition-all hover:bg-neutral-800"
                                >
                                    <option value="box">Box</option>
                                    <option value="cylinder">Cylinder</option>
                                    <option value="sphere">Sphere</option>
                                    <option value="cone">Cone</option>
                                </select>
                            </div>

                            {/* Dimensions */}
                            <div className="space-y-4 pt-2">
                                <label className="text-[10px] text-neutral-500 uppercase font-black tracking-widest">Dimensions</label>
                                {paramsList.map((p) => (
                                    <div key={p} className="group">
                                        <div className="flex justify-between text-[10px] mb-2 px-1">
                                            <span className="capitalize text-neutral-400 group-hover:text-blue-400 transition-colors">{p}</span>
                                            <span className="text-blue-400 font-mono font-bold">{activeNode.params[p]}</span>
                                        </div>
                                        <input
                                            type="range" min="1" max="50" step="0.5"
                                            value={activeNode.params[p] || 0}
                                            onChange={(e) => updateNodeParam(activeNode.id, p, e.target.value)}
                                            className="w-full accent-blue-600 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer hover:bg-neutral-700 transition-colors"
                                        />
                                    </div>
                                ))}
                            </div>

                            {/* Transform */}
                            {activeNode.id !== nodes[0]?.id && (
                                <div className="space-y-4 pt-4 border-t border-white/5 mt-4">
                                    <label className="text-[10px] text-neutral-500 uppercase font-black tracking-widest">Position</label>
                                    {(['x', 'y', 'z'] as const).map((axis) => (
                                        <div key={axis} className="flex items-center gap-4 group">
                                            <span className="text-[10px] font-black uppercase text-neutral-500 w-3 group-hover:text-purple-400 transition-colors">{axis}</span>
                                            <input
                                                type="range" min="-30" max="30" step="0.5"
                                                value={activeNode.params.transform?.[axis] || 0}
                                                onChange={(e) => updateNodeTransform(activeNode.id, axis, e.target.value)}
                                                className="flex-1 accent-purple-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer hover:bg-neutral-700 transition-colors"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Confirm/Cancel Footer */}
                <div className="pt-6 border-t border-white/10 mt-6 flex gap-2">
                    <button
                        onClick={() => confirmEdit()}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-blue-600/20 active:scale-95"
                    >
                        Confirm
                    </button>
                    <button
                        onClick={() => cancelEdit()}
                        className="px-4 bg-neutral-800 hover:bg-neutral-700 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider text-neutral-400 border border-white/5 transition-all"
                    >
                        ×
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-screen bg-black text-white font-sans overflow-hidden select-none selection:bg-blue-500/30">
            {/* Header */}
            <header className="h-14 flex items-center justify-between px-6 border-b border-white/10 bg-black/80 backdrop-blur-xl z-20 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-blue-700 flex items-center justify-center font-black text-lg shadow-xl shadow-blue-500/20 ring-1 ring-white/20">C</div>
                    <div>
                        <h1 className="text-xs font-black tracking-widest uppercase text-white/90">Online CAD <span className="text-blue-500 ml-1">Pro</span></h1>
                        <p className="text-[9px] text-neutral-500 font-bold uppercase tracking-tighter -mt-0.5">Parametric Design Engine</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${status === 'Ready' ? 'text-green-500' : status.includes('Error') ? 'text-red-500' : 'text-blue-400'}`}>
                            {isComputing ? 'Computing Engine...' : status}
                        </span>
                        <span className="text-[8px] text-neutral-600 font-mono tracking-widest">WASM // OCCT_CORE_7.8</span>
                    </div>
                    {isComputing && (
                        <div className="relative w-4 h-4">
                            <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin"></div>
                        </div>
                    )}
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <aside className="w-80 border-r border-white/10 bg-[#0c0c0c] flex flex-col z-10">
                    {/* Add Shape Toolbar */}
                    {!isEditing && (
                        <div className="p-6 border-b border-white/5 bg-black/40">
                            <label className="text-[10px] text-neutral-500 uppercase font-black block mb-4 tracking-widest">Feature Library</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => addNode({
                                        label: `Feature ${nodes.length + 1}`,
                                        operation: OperationType.MAKE_BOX,
                                        params: { width: 10, height: 10, depth: 10 },
                                        booleanOp: BooleanOperator.FUSE, // Default Boolean
                                        visible: true,
                                        enabled: true
                                    })}
                                    className="group flex flex-col items-center justify-center aspect-square rounded-xl bg-neutral-900 border border-white/5 hover:border-blue-500/50 hover:bg-blue-600/5 transition-all gap-2"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-neutral-800 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">+</div>
                                    <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 group-hover:text-blue-400">Add shape</span>
                                </button>
                                <div className="flex flex-col gap-2">
                                    <div className="flex-1 bg-black/30 rounded-xl border border-white/5 p-3 flex flex-col justify-center items-center">
                                        <span className="text-[14px] font-black text-white/40">{nodes.length}</span>
                                        <span className="text-[8px] font-bold text-neutral-600 uppercase">Features</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
                        {isEditing ? renderPropertyEditor() : (
                            <section>
                                <h2 className="text-[11px] font-black text-neutral-500 uppercase tracking-[0.2em] mb-4">
                                    History Stack
                                </h2>
                                <div className="space-y-1.5 overflow-x-hidden">
                                    {nodes.map((node, index) => (
                                        <div
                                            key={node.id}
                                            onClick={() => setActiveNode(node.id)}
                                            onContextMenu={(e) => handleContextMenu(e, node.id)}
                                            className={`group relative p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${activeNodeId === node.id
                                                ? 'bg-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-500/5'
                                                : 'bg-black/20 border-white/10 hover:border-white/25 hover:bg-white/5'
                                                }`}
                                        >
                                            <div className={`w-1.5 h-1.5 rounded-full ${index === 0 ? 'bg-green-500' : 'bg-neutral-700 group-hover:bg-neutral-500'} transition-colors`}></div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-center text-[10px] mb-0.5">
                                                    <span className={`font-black tracking-tight ${activeNodeId === node.id ? 'text-blue-400' : 'text-neutral-300'}`}>
                                                        {node.label}
                                                    </span>
                                                    <span className="text-[8px] font-bold px-1.5 py-0.5 bg-black/40 text-neutral-500 rounded uppercase tracking-tighter">
                                                        {node.operation.replace('MAKE_', '')}
                                                    </span>
                                                </div>
                                                {node.booleanOp !== 'NONE' && (
                                                    <div className="text-[8px] text-blue-500/60 font-black uppercase tracking-widest">{node.booleanOp}</div>
                                                )}
                                                {node.dirty && <div className="absolute top-2 right-2 flex gap-0.5">
                                                    <div className="w-1 h-1 rounded-full bg-yellow-500 animate-pulse"></div>
                                                </div>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>

                    <div className="p-5 text-[8px] text-neutral-600 border-t border-white/5 flex justify-between bg-black/40 font-black tracking-widest uppercase">
                        <div className="flex gap-4">
                            <span>V:{viewResult.finalMesh?.positions ? (viewResult.finalMesh.positions.length / 3).toLocaleString() : 0}</span>
                            <span>S:{nodes.length}</span>
                        </div>
                        <span className="opacity-40">Ready</span>
                    </div>
                </aside>

                {/* Viewer Window */}
                <div className="flex-1 relative overflow-hidden bg-[#050505]">
                    {/* Perspective Guide */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,_#1a1c22_0%,_#000000_100%)] pointer-events-none"></div>

                    <CADViewer geometry={viewResult} />

                    {/* HUD Overlay */}
                    <div className="absolute top-8 left-8 flex flex-col gap-6 pointer-events-none transition-all duration-700">
                        {isEditing && (
                            <div className="flex items-center gap-3 bg-pink-500/10 border border-pink-500/20 px-4 py-2 rounded-full backdrop-blur-md animate-in fade-in slide-in-from-left-4">
                                <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse"></span>
                                <span className="text-[10px] font-black uppercase tracking-widest text-pink-400">Preview Mode Active</span>
                            </div>
                        )}
                    </div>

                    {/* Active Info HUD */}
                    <div className="absolute top-8 right-8 p-6 bg-black/60 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl pointer-events-none min-w-[180px]">
                        <div className="text-[9px] text-neutral-600 uppercase font-black tracking-[0.25em] mb-2 flex items-center justify-between">
                            Target Entity
                            <div className="w-2 h-2 rounded-full bg-blue-500/50 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
                        </div>
                        <div className="text-sm font-bold text-white/90 tracking-tight">
                            {activeNode?.label || 'SYSTEM ROOT'}
                        </div>
                        <div className="mt-4 pt-4 border-t border-white/5 flex gap-4">
                            <div>
                                <div className="text-[7px] text-neutral-600 font-black uppercase tracking-[0.2rem]">Status</div>
                                <div className="text-[9px] font-bold text-blue-400 uppercase mt-0.5">{isEditing ? 'MODIFYING' : 'READ ONLY'}</div>
                            </div>
                            <div>
                                <div className="text-[7px] text-neutral-600 font-black uppercase tracking-[0.2rem]">History</div>
                                <div className="text-[9px] font-bold text-neutral-400 uppercase mt-0.5">#{nodes.findIndex(n => n.id === activeNodeId) + 1} / {nodes.length}</div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Toolbar */}
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/40 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/10 shadow-2xl transition-transform hover:scale-[1.02]">
                        <div className="flex gap-px rounded-xl overflow-hidden border border-white/5 bg-white/5 grayscale opacity-50">
                            <button className="px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-colors">Orbit</button>
                            <button className="px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-colors">Pan</button>
                            <button className="px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-colors">Zoom</button>
                        </div>
                    </div>

                    {/* Reset Button */}
                    <button className="absolute bottom-8 right-8 w-12 h-12 bg-white/5 hover:bg-white/10 text-xl rounded-2xl border border-white/5 backdrop-blur-md shadow-2xl transition-all active:scale-90 flex items-center justify-center group" title="Reset Camera">
                        <span className="group-hover:rotate-45 transition-transform duration-500">🏠</span>
                    </button>
                </div>
            </main>

            {/* Context Menu */}
            {menuPos && menuNodeId && (
                <div
                    className="fixed z-50 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-1.5 min-w-[140px] animate-in fade-in zoom-in-95"
                    style={{ left: menuPos.x, top: menuPos.y }}
                >
                    <button
                        onClick={() => {
                            if (menuNodeId !== nodes[0]?.id) {
                                useHistoryStore.getState().deleteNode(menuNodeId);
                            }
                            closeMenu();
                        }}
                        disabled={menuNodeId === nodes[0]?.id}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-[11px] font-bold transition-all ${menuNodeId === nodes[0]?.id
                            ? 'text-neutral-600 cursor-not-allowed'
                            : 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                            }`}
                    >
                        <span>🗑</span> Delete Feature
                    </button>
                    <button
                        onClick={closeMenu}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-[11px] font-bold text-neutral-400 hover:bg-white/5 transition-all"
                    >
                        <span>×</span> Cancel
                    </button>
                </div>
            )}
        </div>
    );
}

export default App;
