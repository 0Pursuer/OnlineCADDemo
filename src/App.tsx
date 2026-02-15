import { useState, useEffect } from 'react';
import { workerManager } from './logic/WorkerManager';
import CADViewer from './components/CADViewer';

function App() {
    const [status, setStatus] = useState('Initializing...');
    const [geometry, setGeometry] = useState<any>(null);
    const [shapeType, setShapeType] = useState<string>('box');
    const [params, setParams] = useState<any>({ width: 10, height: 10, depth: 10 });
    const [isGenerating, setIsGenerating] = useState(false);

    // Debounce Logic
    const [debouncedParams, setDebouncedParams] = useState(params);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedParams(params);
        }, 200); // 200ms debounce
        return () => clearTimeout(handler);
    }, [params]);

    useEffect(() => {
        if (status === 'Ready' || status === 'OCCT Worker Ready') {
            handleCreateShape();
        }
    }, [debouncedParams, shapeType]);

    useEffect(() => {
        const init = async () => {
            try {
                setStatus('Loading OCCT Engine...');
                await workerManager.waitForReady();
                await workerManager.execute('PING');
                setStatus('OCCT Worker Ready');
                // Initial generation triggered by useEffect above
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
            let action = 'MAKE_BOX';
            switch (shapeType) {
                case 'box': action = 'MAKE_BOX'; break;
                case 'cylinder': action = 'MAKE_CYLINDER'; break;
                case 'sphere': action = 'MAKE_SPHERE'; break;
                case 'cone': action = 'MAKE_CONE'; break;
            }

            const result = await workerManager.execute(action, debouncedParams);
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
        const num = parseFloat(value) || 0.1;
        setParams((prev: any) => ({ ...prev, [name]: num }));
    };

    const handleShapeChange = (newShape: string) => {
        setShapeType(newShape);
        // Set default params for new shape
        let newParams = {};
        switch (newShape) {
            case 'box': newParams = { width: 10, height: 10, depth: 10 }; break;
            case 'cylinder': newParams = { radius: 5, height: 10 }; break;
            case 'sphere': newParams = { radius: 10 }; break;
            case 'cone': newParams = { radius1: 5, radius2: 0, height: 10 }; break;
        }
        setParams(newParams);
        setDebouncedParams(newParams); // Sync immediately to avoid generation with stale params
    };

    const renderInputs = () => {
        let currentParams: string[] = [];
        switch (shapeType) {
            case 'box': currentParams = ['width', 'height', 'depth']; break;
            case 'cylinder': currentParams = ['radius', 'height']; break;
            case 'sphere': currentParams = ['radius']; break;
            case 'cone': currentParams = ['radius1', 'radius2', 'height']; break;
        }

        return currentParams.map((dim) => (
            <div key={dim} className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                    <label className="capitalize font-medium text-neutral-300">{dim}</label>
                    <span className="text-blue-400 tabular-nums">{params[dim]} mm</span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="50"
                    step="0.5"
                    value={params[dim] || 0}
                    onChange={(e) => updateParam(dim, e.target.value)}
                    className="w-full accent-blue-600 h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                />
                <input
                    type="number"
                    value={params[dim] || 0}
                    onChange={(e) => updateParam(dim, e.target.value)}
                    className="w-full bg-neutral-900 border border-white/5 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
            </div>
        ));
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
                        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest mb-6">Primitive Type</h2>
                        <select
                            value={shapeType}
                            onChange={(e) => handleShapeChange(e.target.value)}
                            className="w-full bg-neutral-900 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors mb-6"
                        >
                            <option value="box">Box</option>
                            <option value="cylinder">Cylinder</option>
                            <option value="sphere">Sphere</option>
                            <option value="cone">Cone</option>
                        </select>

                        <div className="space-y-6">
                            {renderInputs()}
                        </div>
                    </section>

                    <section className="flex-1">
                        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest mb-4">Object Tree</h2>
                        <div className="bg-black/20 rounded-lg p-3 border border-white/5">
                            <div className="flex items-center gap-2 text-sm text-neutral-300">
                                <span className="opacity-50">📦</span>
                                <span className="capitalize">{shapeType}_001</span>
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
