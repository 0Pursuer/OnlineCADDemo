import { useState, useEffect } from 'react';
import { workerManager } from './logic/WorkerManager';
import CADViewer from './components/CADViewer';

interface ShapeConfig {
    type: string;
    params: Record<string, number>;
    transform?: { x: number; y: number; z: number };
}

type BooleanMode = 'NONE' | 'FUSE' | 'CUT' | 'COMMON';

function App() {
    const [status, setStatus] = useState('Initializing...');
    const [geometry, setGeometry] = useState<any>(null);
    const [boolMode, setBoolMode] = useState<BooleanMode>('NONE');

    // Base Shape State
    const [baseShape, setBaseShape] = useState<ShapeConfig>({
        type: 'box',
        params: { width: 10, height: 10, depth: 10 }
    });

    // Tool Shape State (for Boolean Ops)
    const [toolShape, setToolShape] = useState<ShapeConfig>({
        type: 'sphere',
        params: { radius: 8 },
        transform: { x: 5, y: 5, z: 5 }
    });

    const [isGenerating, setIsGenerating] = useState(false);

    // Debounce Logic
    const [debouncedBase, setDebouncedBase] = useState(baseShape);
    const [debouncedTool, setDebouncedTool] = useState(toolShape);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedBase(baseShape);
            setDebouncedTool(toolShape);
        }, 150);
        return () => clearTimeout(handler);
    }, [baseShape, toolShape]);

    useEffect(() => {
        if (status === 'Ready' || status === 'OCCT Worker Ready' || status.startsWith('Generating')) {
            handleCreateShape();
        }
    }, [debouncedBase, debouncedTool, boolMode]);

    useEffect(() => {
        const init = async () => {
            try {
                setStatus('Loading OCCT Engine...');
                await workerManager.waitForReady();
                await workerManager.execute('PING');
                setStatus('Ready');
            } catch (err) {
                setStatus('Error: ' + err);
            }
        };
        init();
    }, []);

    const handleCreateShape = async () => {
        setIsGenerating(true);
        setStatus('Generating Geometry...');
        try {
            let result;
            if (boolMode === 'NONE') {
                const action = `MAKE_${baseShape.type.toUpperCase()}`;
                result = await workerManager.execute(action, debouncedBase.params);
            } else {
                result = await workerManager.execute('BOOLEAN_OP', {
                    type: boolMode,
                    base: debouncedBase,
                    tool: debouncedTool
                });
            }

            if (result.error) {
                setStatus('Error: ' + result.error);
            } else {
                setGeometry(result);
                setStatus('Ready');
            }
        } catch (err: any) {
            setStatus('Error: ' + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const updateShapeParam = (isBase: boolean, name: string, value: string) => {
        const num = parseFloat(value) || 0;
        const setFn = isBase ? setBaseShape : setToolShape;
        setFn((prev) => ({
            ...prev,
            params: { ...prev.params, [name]: num }
        }));
    };

    const updateTransform = (name: 'x' | 'y' | 'z', value: string) => {
        const num = parseFloat(value) || 0;
        setToolShape((prev) => ({
            ...prev,
            transform: { ...(prev.transform || { x: 0, y: 0, z: 0 }), [name]: num }
        }));
    };

    const handleTypeChange = (isBase: boolean, newType: string) => {
        let newParams: any = {};
        switch (newType) {
            case 'box': newParams = { width: 10, height: 10, depth: 10 }; break;
            case 'cylinder': newParams = { radius: 5, height: 10 }; break;
            case 'sphere': newParams = { radius: 10 }; break;
            case 'cone': newParams = { radius1: 5, radius2: 0, height: 10 }; break;
        }
        const setFn = isBase ? setBaseShape : setToolShape;
        setFn((prev) => ({ ...prev, type: newType, params: newParams }));
    };

    const renderShapeControls = (isBase: boolean) => {
        const shape = isBase ? baseShape : toolShape;
        const paramsMap: Record<string, string[]> = {
            'box': ['width', 'height', 'depth'],
            'cylinder': ['radius', 'height'],
            'sphere': ['radius'],
            'cone': ['radius1', 'radius2', 'height']
        };
        const paramsList = paramsMap[shape.type] || [];

        return (
            <div className="space-y-4">
                <div className="space-y-1">
                    <label className="text-[10px] text-neutral-500 uppercase font-bold">Type</label>
                    <select
                        value={shape.type}
                        onChange={(e) => handleTypeChange(isBase, e.target.value)}
                        className="w-full bg-neutral-900 border border-white/10 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
                    >
                        <option value="box">Box</option>
                        <option value="cylinder">Cylinder</option>
                        <option value="sphere">Sphere</option>
                        <option value="cone">Cone</option>
                    </select>
                </div>

                {paramsList.map((p) => (
                    <div key={p} className="space-y-1">
                        <div className="flex justify-between text-[10px]">
                            <span className="capitalize text-neutral-400">{p}</span>
                            <span className="text-blue-400 font-mono tracking-tighter">{shape.params[p]}</span>
                        </div>
                        <input
                            type="range" min="1" max="50" step="0.5"
                            value={shape.params[p] || 0}
                            onChange={(e) => updateShapeParam(isBase, p, e.target.value)}
                            className="w-full accent-blue-600 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                ))}

                {!isBase && (
                    <div className="pt-2 border-t border-white/5 space-y-3">
                        <label className="text-[10px] text-neutral-500 uppercase font-bold">Position (Tool)</label>
                        {(['x', 'y', 'z'] as const).map((axis) => (
                            <div key={axis} className="flex items-center gap-2">
                                <span className="text-[10px] uppercase text-neutral-500 w-3 font-bold">{axis}</span>
                                <input
                                    type="range" min="-30" max="30" step="0.5"
                                    value={shape.transform?.[axis] || 0}
                                    onChange={(e) => updateTransform(axis, e.target.value)}
                                    className="flex-1 accent-purple-500 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col h-screen bg-neutral-900 text-white font-sans overflow-hidden select-none">
            {/* Header */}
            <header className="h-14 flex items-center justify-between px-6 border-b border-white/10 bg-black/40 backdrop-blur-md z-10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center font-black text-sm shadow-lg shadow-blue-500/20">C</div>
                    <h1 className="text-base font-bold tracking-tight uppercase border-b-2 border-blue-500 pb-0.5">Online CAD</h1>
                </div>
                <div className="flex items-center gap-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border shadow-sm ${status === 'Ready' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                        status.includes('Error') ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                            'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        }`}>
                        {status}
                    </span>
                    {isGenerating && (
                        <div className="animate-spin rounded-full h-3 w-3 border-2 border-white/20 border-t-white"></div>
                    )}
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <aside className="w-72 border-r border-white/10 bg-neutral-900 flex flex-col overflow-y-auto custom-scrollbar">
                    {/* Boolean Options */}
                    <div className="p-5 border-b border-white/5 bg-black/10">
                        <label className="text-[10px] text-neutral-500 uppercase font-black block mb-3 tracking-widest">Boolean Operation</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(['NONE', 'FUSE', 'CUT', 'COMMON'] as BooleanMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    onClick={() => setBoolMode(mode)}
                                    className={`px-2 py-1.5 rounded text-[10px] font-bold transition-all border ${boolMode === mode
                                        ? 'bg-blue-600 border-blue-400 text-white shadow-lg'
                                        : 'bg-neutral-800 border-white/5 text-neutral-500 hover:border-white/10'
                                        }`}
                                >
                                    {mode}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-6 space-y-10 flex-1">
                        <section>
                            <h2 className="text-[11px] font-black text-blue-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Base Shape
                            </h2>
                            {renderShapeControls(true)}
                        </section>

                        {boolMode !== 'NONE' && (
                            <section className="animate-in fade-in slide-in-from-left-4 duration-500">
                                <h2 className="text-[11px] font-black text-purple-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"></span> Tool Shape
                                </h2>
                                {renderShapeControls(false)}
                            </section>
                        )}
                    </div>

                    <div className="p-4 text-[9px] text-neutral-500 border-t border-white/5 flex justify-between bg-black/30 font-mono tracking-tighter">
                        <span>{geometry?.created ? `${geometry.positions.length / 3} TRIANGLES` : 'NO MESH DATA'}</span>
                        <span className="opacity-50">OCCT 7.8</span>
                    </div>
                </aside>

                {/* Viewer Window */}
                <div className="flex-1 relative bg-black">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_#1a1a1a_0%,_#000000_100%)] opacity-50 pointer-events-none"></div>
                    <CADViewer geometry={geometry} />

                    {/* Scene HUD */}
                    <div className="absolute top-6 right-6 p-4 bg-neutral-900/60 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl pointer-events-none transition-all">
                        <div className="text-[9px] text-neutral-500 uppercase font-black tracking-[0.2em] mb-1">Active Geometry</div>
                        <div className="text-sm font-medium text-white/90 tracking-tight">
                            {boolMode === 'NONE' ? baseShape.type.toUpperCase() : `BOO:${boolMode}`}
                        </div>
                    </div>

                    {/* View Controls */}
                    <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                        <button className="w-10 h-10 bg-neutral-800/80 hover:bg-neutral-700 text-lg rounded-lg border border-white/10 backdrop-blur-md shadow-xl transition-all active:scale-95" title="Reset Camera">
                            🏠
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
