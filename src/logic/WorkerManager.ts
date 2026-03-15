/**
 * WorkerManager
 * Handles communication with the CAD Web Worker via a Promise-based API.
 * Supports granular status reporting for engine initialization stages.
 */

type StatusListener = (status: string) => void;

export class WorkerManager {
    private worker: Worker;
    private messageQueue: Map<string, { resolve: (value: any) => void, reject: (reason?: any) => void }>;
    private isReady: boolean = false;
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;
    private readyReject!: (reason: any) => void;
    private statusListeners: StatusListener[] = [];

    constructor() {
        // Initialize the worker using standard Vite pattern
        this.worker = new Worker(new URL('../workers/cad-worker.js', import.meta.url), {
            type: 'module',
            name: 'CAD_ENGINE_WORKER'
        });

        this.messageQueue = new Map();
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });

        // Setup listener
        this.worker.onmessage = this.handleMessage.bind(this);

        // Detailed Error listener
        this.worker.onerror = (err) => {
            console.error("[WorkerManager] Worker Error Event:", err);
            if (err instanceof ErrorEvent) {
                console.error(`[WorkerManager] Detail: ${err.message} at ${err.filename}:${err.lineno}:${err.colno}`);
                this.readyReject(new Error(`Worker script error: ${err.message}`));
            } else {
                this.readyReject(new Error('Worker failed to load (check console for details)'));
            }
        };
    }

    /**
     * Register a listener for engine status updates during initialization.
     */
    public onStatus(listener: StatusListener): () => void {
        this.statusListeners.push(listener);
        return () => {
            this.statusListeners = this.statusListeners.filter(l => l !== listener);
        };
    }

    private notifyStatus(status: string) {
        this.statusListeners.forEach(l => l(status));
    }

    /**
     * Handles incoming messages from the worker.
     */
    private handleMessage(event: MessageEvent) {
        const { id, type, payload, status, result, error } = event.data;

        // Handle System Messages
        if (type === 'STATUS') {
            switch (payload) {
                case 'LOADING_OCCT':
                    this.notifyStatus('Loading OCCT Core...');
                    console.log("[WorkerManager] Engine status: Loading OCCT Core");
                    break;
                case 'LOADING_REPLICAD':
                    this.notifyStatus('Initializing RepliCAD...');
                    console.log("[WorkerManager] Engine status: Initializing RepliCAD");
                    break;
                case 'READY':
                    this.isReady = true;
                    this.notifyStatus('Ready');
                    this.readyResolve();
                    console.log("[WorkerManager] ✓ Worker is ready");
                    break;
                case 'ERROR':
                    this.notifyStatus('Error: ' + (error || 'Unknown'));
                    this.readyReject(new Error(error || 'Worker initialization failed'));
                    console.error("[WorkerManager] ✗ Worker failed:", error);
                    break;
                default:
                    console.log("[WorkerManager] Unknown status:", payload);
            }
            return;
        }

        // Handle Request Responses
        if (id && this.messageQueue.has(id)) {
            const { resolve, reject } = this.messageQueue.get(id)!;

            if (status === 'success') {
                resolve(result);
            } else {
                reject(new Error(error || 'Unknown worker error'));
            }

            this.messageQueue.delete(id);
        }
    }

    /**
     * Sends a command to the worker and awaits the result.
     */
    public execute(action: string, payload: any = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();

            this.messageQueue.set(id, { resolve, reject });

            this.worker.postMessage({
                id,
                action,
                payload
            });
        });
    }

    /**
     * Terminate the worker instance
     */
    public terminate() {
        this.worker.terminate();
        this.messageQueue.clear();
        this.isReady = false;
    }

    /**
     * Wait for the worker to be ready
     */
    public waitForReady(): Promise<void> {
        return this.readyPromise;
    }
}

// Export a singleton instance
export const workerManager = new WorkerManager();
