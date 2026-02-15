/**
 * WorkerManager
 * Handles communication with the CAD Web Worker via a Promise-based API.
 */
export class WorkerManager {
    private worker: Worker;
    private messageQueue: Map<string, { resolve: (value: any) => void, reject: (reason?: any) => void }>;
    private isReady: boolean = false;
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;
    private readyReject!: (reason: any) => void;

    constructor() {
        // Initialize the worker.
        // Vite's `?worker` suffix or `new URL(..., import.meta.url)` syntax is standard.
        this.worker = new Worker(new URL('../workers/cad-worker.js', import.meta.url), {
            type: 'module'
        });

        this.messageQueue = new Map();
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });

        // Setup listener
        this.worker.onmessage = this.handleMessage.bind(this);

        // Optional: Error listener
        this.worker.onerror = (err) => {
            console.error("Worker Error:", err);
        };
    }

    /**
     * Handles incoming messages from the worker.
     */
    private handleMessage(event: MessageEvent) {
        const { id, type, payload, status, result, error } = event.data;

        // Handle System Messages
        if (type === 'STATUS') {
            if (payload === 'READY') {
                this.isReady = true;
                this.readyResolve();
                console.log("WorkerManager: Worker is ready");
            } else if (payload === 'ERROR') {
                this.readyReject(new Error(error || 'Worker initialization failed'));
                console.error("WorkerManager: Worker failed to initialize", error);
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
     * @param action The action name (e.g., 'MAKE_BOX')
     * @param payload The data to send
     * @returns Promise resolving to the result
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

            // Optional: Timeout logic could be added here
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

// Export a singleton instance if preferred, or the class
export const workerManager = new WorkerManager();
