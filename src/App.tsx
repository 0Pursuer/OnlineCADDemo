import { useState, useEffect } from 'react';
import { workerManager } from './logic/WorkerManager';
import CADViewer from './components/CADViewer';

function App() {
    const [status, setStatus] = useState('Initializing...');
    const [geometry, setGeometry] = useState<any>(null);
    const [params, setParams] = useState({ width: 10, height: 10, depth: 10 });
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        const init = async () => {
            try {
                setStatus('Loading OCCT Engine...');
                await workerManager.waitForReady();
                await workerManager.execute('PING');
                setStatus('OCCT Worker Ready');
                // Create initial box
                handleCreateBox(10, 10, 10);
            } catch (err) {
                setStatus('Error: ' + err);
            }
        };
        init();
    }, []);

    const handleCreateBox = async (w: number, h: number, d: number) => {
        setIsGenerating(true);
        setStatus('Generating Geometry...');
        try {
            const result = await workerManager.execute('MAKE_BOX', { width: w, height: h, depth: d });
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

    const updateParam = (name: string, value: string) => {
        const num = parseFloat(value) || 1;
        const newParams = { ...params, [name]: num };
        setParams(newParams);
        handleCreateBox(newParams.width, newParams.height, newParams.depth);
    };

    return (
        <div className="flex flex-col h-screen bg-neutral-900 text-white font-sans overflow-hidden">
            {/* Header */}
            <header className="h-16 flex items-center justify-between px-6 border-b border-white/10 bg-black/20 backdrop-blur-md z-10">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-lg">C</div>
                    <h1 className="text-xl font-semibold tracking-tight">Web CAD Prototype</h1>
                </div>
                <div className="flex items-center gap-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${status === 'Ready' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                            status.includes('Error') ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        }`}>
                        {status}
                    </span>
                    {isGenerating && (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/20 border-t-white"></div>
                    )}
                </div>
            </header>

            <main className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <aside className="w-80 border-r border-white/10 bg-neutral-800/50 flex flex-col p-6 space-y-8">
                    <section>
                        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest mb-6">Primitive: Box</h2>

                        <div className="space-y-6">
                            {(['width', 'height', 'depth'] as const).map((dim) => (
                                <div key={dim} className="space-y-2">
                                    <div className="flex justify-between items-center text-sm">
                                        <label className="capitalize font-medium text-neutral-300">{dim}</label>
                                        <span className="text-blue-400 tabular-nums">{params[dim]} mm</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="1"
                                        max="50"
                                        step="1"
                                        value={params[dim]}
                                        onChange={(e) => updateParam(dim, e.target.value)}
                                        className="w-full accent-blue-600 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <input
                                        type="number"
                                        value={params[dim]}
                                        onChange={(e) => updateParam(dim, e.target.value)}
                                        className="w-full bg-neutral-900 border border-white/5 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="flex-1">
                        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest mb-4">Object Tree</h2>
                        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                            <div className="flex items-center gap-2 text-sm text-neutral-300">
                                <span className="opacity-50">📦</span>
                                <span>Box_001</span>
                            </div>
                        </div>
                    </section>

                    <div className="text-[10px] text-neutral-500 border-t border-white/5 pt-4">
                        Powered by OpenCascade.js & Three.js
                    </div>
                </aside>

                {/* Main View */}
                <div className="flex-1 relative bg-black">
                    <CADViewer geometryData={geometry} />

                    {/* Floating Controls Overlay */}
                    <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                        <button className="bg-neutral-800/80 hover:bg-neutral-700 p-2 rounded-lg border border-white/10 backdrop-blur-sm transition-all" title="Reset View">
                            🏠
                        </button>
                        <button className="bg-neutral-800/80 hover:bg-neutral-700 p-2 rounded-lg border border-white/10 backdrop-blur-sm transition-all" title="Wireframe Toggle">
                            🕸️
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
